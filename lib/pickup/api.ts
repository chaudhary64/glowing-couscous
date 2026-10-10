import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { authorizeUser } from "@/lib/ai/http";
import { SESSION_COOKIE, type AuthUser } from "@/lib/auth/token";

/**
 * How the app reaches the smart-pickup API (`aws/pickup/`), and nothing else.
 *
 * Two modes, picked by configuration and never by guesswork:
 *
 *   **Cloud** — `PICKUP_API_URL` is the HTTP API Gateway that `scripts/pickup-setup.sh`
 *   provisioned. The session cookie *is* the Cognito ID token, and the API's JWT
 *   authorizer accepts exactly that token, so it is forwarded as the bearer: the API
 *   sees the same identity and the same `eco-*` groups the page did, and there is no
 *   service credential to hold.
 *
 *   **Local** — `PICKUP_LOCAL=true` runs the Lambda's own `handler` in this process,
 *   against DynamoDB Local (`npm run pickup:local`). The event is shaped like the one
 *   API Gateway sends, with the claims taken from the session this server just
 *   verified. The code under test on a laptop is therefore the code that deploys, not a
 *   mirror of it.
 *
 * Neither set is a 503 that says so. There is no third, in-memory mode: a handoff that
 * "succeeds" against nothing would be a demo that proves nothing.
 */

export interface PickupApiResult {
  status: number;
  body: unknown;
}

const PICKUP_ID = /^PU-\d{4}-\d{4,6}$/;

/** A pickup id from a URL segment, or null — never forwarded unchecked into a path. */
export function pickupIdFrom(value: string): string | null {
  return PICKUP_ID.test(value) ? value : null;
}

export function pickupJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    // A load's state changes under the caller — the phone polls for the flip to paid —
    // and a cached 200 would freeze the screen on the state it first saw.
    headers: { "cache-control": "private, no-store" },
  });
}

const problem = (code: string, message: string, status: number) =>
  pickupJson({ error: { code, message } }, status);

/**
 * The page guard, applied to the API behind it: same origin, a session, and a role that
 * may open `pathname`. The Lambda checks the role again — this check is what keeps a
 * refused request from leaving the server at all.
 */
export async function authorizePickup(request: Request, pathname: "/handoff" | "/gate") {
  return authorizeUser(request, pathname, {
    subject: "Working a handoff",
    signIn: "work a handoff",
    refuse: "move a load",
  });
}

type Method = "GET" | "POST";

export async function callPickupApi(
  user: AuthUser,
  method: Method,
  path: string,
  { body, query }: { body?: unknown; query?: Record<string, string> } = {},
): Promise<NextResponse> {
  try {
    const result = process.env.PICKUP_LOCAL === "true"
      ? await invokeLocally(user, method, path, body, query)
      : process.env.PICKUP_API_URL
        ? await invokeRemotely(method, path, body, query)
        : null;

    if (!result) {
      return problem(
        "pickup_api_not_configured",
        "The smart-pickup API is not configured. Set PICKUP_LOCAL=true and run `npm run pickup:local`, or set PICKUP_API_URL to the deployed API.",
        503,
      );
    }
    return pickupJson(result.body, result.status);
  } catch (error) {
    console.error("[pickup] API call failed:", error);
    return problem(
      "pickup_api_unreachable",
      process.env.PICKUP_LOCAL === "true"
        ? "DynamoDB Local is not answering. Is `npm run pickup:local` running?"
        : "The smart-pickup API could not be reached.",
      502,
    );
  }
}

/* --------------------------------------------------------------------- local */

type LambdaHandler = (event: unknown) => Promise<{ statusCode: number; body?: string }>;

async function invokeLocally(
  user: AuthUser,
  method: Method,
  path: string,
  body: unknown,
  query: Record<string, string> | undefined,
): Promise<PickupApiResult> {
  // Loaded on first use, so a cloud deployment never evaluates the Lambda's modules.
  const { handler } = (await import("@/aws/pickup/index.mjs")) as { handler: LambdaHandler };
  const response = await handler({
    rawPath: path,
    queryStringParameters: query,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      requestId: `local-${crypto.randomUUID()}`,
      http: { method },
      authorizer: {
        jwt: {
          // What API Gateway's JWT authorizer passes through: claims flattened to
          // strings. The groups go as a JSON array, one of the shapes `security.mjs`
          // parses.
          claims: {
            sub: user.sub,
            email: user.email ?? "",
            "cognito:groups": JSON.stringify(user.groups),
          },
        },
      },
    },
  });
  return {
    status: response.statusCode,
    body: response.body ? JSON.parse(response.body) : null,
  };
}

/* -------------------------------------------------------------------- remote */

async function invokeRemotely(
  method: Method,
  path: string,
  body: unknown,
  query: Record<string, string> | undefined,
): Promise<PickupApiResult> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const base = (process.env.PICKUP_API_URL ?? "").replace(/\/+$/, "");
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);

  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token ?? ""}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    // Mumbai to ap-south-1 is fast; a request still waiting after eight seconds is not
    // coming back in time for the person at the gate.
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: { code: "bad_upstream", message: text.slice(0, 200) } };
  }
  return { status: response.status, body: parsed };
}
