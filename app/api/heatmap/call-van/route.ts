import { authorizeUser, jsonResponse, type AccessAction } from "@/lib/ai/http";
import { roleLabel } from "@/lib/auth/roles";
import { callVan, mayCallVan } from "@/lib/heatmap/store";

/**
 * POST /api/heatmap/call-van — ask for a van at the caller's position.
 *
 *   { "latitude": 19.0760, "longitude": 72.8777, "accuracyM": 18 }
 *
 * Answers `{ ok, code, status, areaName, repeated }`: the open site the call created, or
 * the one it refreshed when this cell had already called. Held to `/map`, which every role
 * opens, and then to `VAN_CALLERS`, because the map is read-only for the seats that are not
 * standing at a pile. The position is filed and reduced to its ~150 m cell before it is
 * stored; the exact fix is never kept.
 */

const CALLING: AccessAction = {
  subject: "Calling a van",
  signIn: "call a van",
  refuse: "call a van",
};

/** A fix this loose cannot say which lane the pile is in. */
const MAX_ACCURACY_M = 500;

const inRange = (value: unknown, limit: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;

export async function POST(request: Request) {
  const access = await authorizeUser(request, "/map", CALLING);
  if (!access.ok) return access.denied;
  if (!mayCallVan(access.user.role)) {
    return jsonResponse(
      {
        error: "forbidden",
        message: `Calling a van is limited to Collector or Admin; this account is ${roleLabel(access.user.role)}.`,
      },
      403,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "bad_request", message: "Body must be JSON." }, 400);
  }

  const { latitude, longitude, accuracyM } = body;
  if (!inRange(latitude, 90) || !inRange(longitude, 180)) {
    return jsonResponse({ error: "bad_request", message: "Send a latitude and a longitude in degrees." }, 400);
  }
  if (typeof accuracyM === "number" && accuracyM > MAX_ACCURACY_M) {
    return jsonResponse(
      {
        error: "imprecise",
        message: `The device placed you only within ${Math.round(accuracyM)} m. Step outside or wait for a better fix, then call again.`,
      },
      422,
    );
  }

  const outcome = await callVan(latitude, longitude);
  if (!outcome.ok) return jsonResponse({ error: "not_called", message: outcome.message }, outcome.status);
  return jsonResponse(outcome);
}
