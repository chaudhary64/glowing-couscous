import { authorizeUser, jsonResponse } from "@/lib/ai/http";
import { setPoolRole } from "@/lib/auth/pool";
import { ROLES, type Role } from "@/lib/auth/roles";

/**
 * POST /api/team/role — put a person in one role group.
 *
 * Guarded as `/team` is, so only an admin reaches the pool. The new role must be one
 * of the five the matrix knows — the Collector is as grantable as the rest; the legacy
 * `eco-owner` group can be cleared by this route but never granted. The change takes
 * effect at the person's next sign-in, because the role travels in their token.
 */

const CHANGING_ROLES = {
  subject: "Changing a member's role",
  signIn: "change a member's role",
  refuse: "change a member's role",
};

const isRole = (value: string): value is Role => Object.prototype.hasOwnProperty.call(ROLES, value);

export async function POST(request: Request) {
  const access = await authorizeUser(request, "/team", CHANGING_ROLES);
  if (!access.ok) return access.denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "bad_request", message: "Body must be JSON." }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return jsonResponse({ error: "bad_request", message: "Body must be a JSON object." }, 400);
  }

  const raw = body as Record<string, unknown>;
  const username = typeof raw.username === "string" ? raw.username.trim() : "";
  const role = typeof raw.role === "string" ? raw.role.trim() : "";

  if (!username) {
    return jsonResponse({ error: "bad_request", message: "A username is required." }, 400);
  }
  if (!isRole(role)) {
    return jsonResponse(
      { error: "bad_request", message: `Role must be one of ${Object.keys(ROLES).join(", ")}.` },
      400,
    );
  }

  const change = await setPoolRole(username, role, access.user.sub);
  if (!change.ok) {
    return jsonResponse({ error: "not_changed", message: change.message }, change.status);
  }
  return jsonResponse({ ok: true, role: change.role }, 200);
}
