import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { authorizeUser } from "@/lib/ai/http";
import { SESSION_COOKIE } from "@/lib/auth/token";

/**
 * How the app reaches the smart-pickup API (`aws/pickup/`), and nothing else.
 *
 * One mode: `PICKUP_API_URL` is the HTTP API Gateway that `scripts/pickup-setup.sh`
 * provisioned. The session cookie *is* the Cognito ID token, and the API's JWT
 * authorizer accepts exactly that token, so it is forwarded as the bearer: the API sees
 * the same identity and the same `eco-*` groups the page did, and there is no service
 * credential to hold.
 *
 * A laptop reads the same service a deployment does, and that is the point: the loads,
 * the PINs and the credit notes are the rows in the deployed tables, not a private copy
 * of them that can drift from what the pilot shows. There is deliberately no in-process
 * or in-memory mode — a handoff that "succeeds" against nothing would be a demo that
 * proves nothing — so an unset `PICKUP_API_URL` is a 503 that says so rather than a
 * quiet fallback.
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

/**
 * `true` when the API's address is configured. A caller that means "the API is switched
 * off" rather than "the API failed" asks this first, which is what the page readers do.
 */
export function pickupApiConfigured(): boolean {
  return Boolean(process.env.PICKUP_API_URL);
}

/**
 * The API call itself, with no Next.js in it: the status and the parsed body, or null
 * when the API is not configured at all.
 *
 * `callPickupApi` wraps this for the route handlers; the server-side readers in
 * `lib/pickup/directory.ts` call it directly, and that is the reason to split it out: a
 * second copy of "how this app reaches the smart-pickup API", written for the pages,
 * would be a second place for the two to disagree.
 */
export async function requestPickupApi(
  method: Method,
  path: string,
  { body, query }: { body?: unknown; query?: Record<string, string> } = {},
): Promise<PickupApiResult | null> {
  if (process.env.PICKUP_API_URL) {
    return await invokeRemotely(method, path, body, query);
  }
  return null;
}

/**
 * Refusals that are an expected step of a flow rather than a failure — a wrong, locked or
 * expired PIN at the gate. The browser logs every 4xx response as a console error, even
 * one the screen handles; a route that names these here returns them as 200 with the
 * refusal in the body (`error`), which the screens already read. The Lambda API keeps
 * its status codes; this is only the app's own boundary.
 */
export type ExpectedRefusal = "pin_mismatch" | "pin_locked" | "pin_expired";

export async function callPickupApi(
  method: Method,
  path: string,
  {
    body,
    query,
    expected = [],
  }: { body?: unknown; query?: Record<string, string>; expected?: ExpectedRefusal[] } = {},
): Promise<NextResponse> {
  try {
    const result = await requestPickupApi(method, path, { body, query });

    if (!result) {
      return problem(
        "pickup_api_not_configured",
        "The smart-pickup API is not configured. Set PICKUP_API_URL to the deployed API — `bash scripts/pickup-setup.sh` writes it into .env.local.",
        503,
      );
    }
    const code = (result.body as { error?: { code?: string } } | null)?.error?.code;
    if (result.status >= 400 && code && (expected as string[]).includes(code)) {
      return pickupJson({ ...(result.body as object), refused: true }, 200);
    }
    return pickupJson(result.body, result.status);
  } catch (error) {
    console.error("[pickup] API call failed:", error);
    return problem(
      "pickup_api_unreachable",
      "The smart-pickup API could not be reached.",
      502,
    );
  }
}

/* ------------------------------------------------------------- the API call */

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
