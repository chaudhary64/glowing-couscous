import { NextResponse } from "next/server";

/**
 * Helpers shared by the auth route handlers.
 *
 * The forms are plain HTML `POST`s, so the whole flow works with JavaScript
 * disabled, is server-rendered, and can be driven end to end with `curl`. Errors
 * come back as a short code in the query string and are turned into words by the
 * page — a raw message in a URL gets logged, shared and indexed.
 */

export type Field = string;

export const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/**
 * Like `field`, but without trimming. A password may legitimately begin or end with
 * a space, and quietly stripping it would turn a correct password into a failed one.
 */
export const rawField = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * Cognito sign-in is by email, and email is case-insensitive in practice. Lower-casing
 * on the way in means one account per address rather than one per capitalisation.
 */
export const emailField = (form: FormData): string =>
  field(form, "email").toLowerCase();

/**
 * Where to send someone after they sign in.
 *
 * Only a same-origin path is allowed. `//evil.example.com` is a protocol-relative
 * URL that a browser happily follows off-site, so a leading `//` is rejected too —
 * this is the open-redirect guard, not a formatting preference.
 */
export function safeNext(value: string): string {
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

/**
 * The hosts this request actually arrived on.
 *
 * Not `request.url`: Next normalises that to the server's own origin, so on a machine
 * reached as `127.0.0.1` it still reads `localhost` — and in a deployment it reads an
 * internal host and port. Comparing against it rejected genuine browser posts from the
 * app's own form, which is how this was found: the check has to use the headers the
 * request came with. `x-forwarded-host` is the one a proxy such as Amplify sets, and
 * it is reported alongside `host` rather than instead of it, because which of the two
 * carries the public name depends on the hop.
 */
function requestHosts(request: Request): string[] {
  return [request.headers.get("x-forwarded-host"), request.headers.get("host")]
    .flatMap((value) => (value ? value.split(",") : []))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

/**
 * Whether a request looks like it came from this site.
 *
 * The session cookie is `SameSite=Lax`, which already keeps a cross-site
 * cookie-bearing POST from being sent at all. Sign-in and sign-up have no cookie yet,
 * so without this the two endpoints that hand out a session would be scriptable from
 * any other origin. `Sec-Fetch-Site` is the browser's own answer and cannot be set by
 * page script; `Origin` is the cross-check for clients that send it. A request with
 * neither is not a browser form post — it is curl, or a health check — and is allowed
 * so the flow stays drivable from a terminal.
 *
 * The method is deliberately not part of the test. A cross-site `GET` that carries a
 * session is the same problem as a cross-site `POST` — an `<img>` on someone else's
 * page can spend a signed read just as easily as a script can spend a model call — so
 * `isSameOriginPost` below is this function under the name its original callers know.
 */
export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return requestHosts(request).includes(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
}

/** The same check, under the name the auth form handlers were written against. */
export const isSameOriginPost = isSameOriginRequest;

/**
 * 303 so the browser follows with a GET: the form has been dealt with.
 *
 * The `Location` is a **relative** path, and that is deliberate. `request.url` inside a
 * route handler is not built from the `Host` header — Next normalises it to the
 * server's own origin, so on this machine it reads `http://localhost:3111` no matter
 * what the client sent. A redirect built from it would therefore point at `localhost`
 * in a deployment, and at the wrong port whenever the app is not on 3000. A relative
 * `Location` is resolved by the browser against the address it actually used, which is
 * the only origin that is right in every environment. A framework comparison of this
 * against `NextResponse.redirect(new URL(...))` is what caught it.
 */
export function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

/** Sends the user back to a form with an error code and what they had typed. */
export function backToForm(
  path: string,
  params: Record<string, string | undefined>,
): NextResponse {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const search = query.toString();
  return redirectTo(search ? `${path}?${search}` : path);
}
