import { authorizeUser, jsonResponse, type AccessAction } from "@/lib/ai/http";
import { recomputeClusters, setClusterStatus, type ClusterStatus } from "@/lib/heatmap/store";

/**
 * POST /api/heatmap/dispatch — act on a live hotspot.
 *
 *   { "code": "HS-te7ud2h", "status": "van_assigned" | "cleared" | "open" }
 *   { "action": "recompute" }      rewrite clusters + detections from the current points
 *
 * Gated at `/map/dispatch` (operator and above, the pickup board's rank): looking at the
 * map is for everyone, sending a van is not.
 */

const DISPATCHING: AccessAction = {
  subject: "Dispatching from the hotspot map",
  signIn: "dispatch from the hotspot map",
  refuse: "dispatch from the hotspot map",
};

const STATUSES: ClusterStatus[] = ["open", "van_assigned", "cleared"];

export async function POST(request: Request) {
  const access = await authorizeUser(request, "/map/dispatch", DISPATCHING);
  if (!access.ok) return access.denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "bad_request", message: "Body must be JSON." }, 400);
  }

  if (body.action === "recompute") {
    const outcome = await recomputeClusters();
    if (!outcome.configured) {
      return jsonResponse({ error: "no_database", message: "No database is configured, so there is nothing to recompute." }, 503);
    }
    if (outcome.error) return jsonResponse({ error: "recompute_failed", message: outcome.error }, 500);
    return jsonResponse(outcome);
  }

  const code = typeof body.code === "string" && /^HS-[0-9b-hjkmnp-z]{7}$/.test(body.code) ? body.code : null;
  const status = STATUSES.find((s) => s === body.status);
  if (!code || !status) {
    return jsonResponse({ error: "bad_request", message: "Send a hotspot code and a status of open, van_assigned or cleared." }, 400);
  }

  const result = await setClusterStatus(code, status);
  if (!result.ok) return jsonResponse({ error: "not_dispatched", message: result.message }, result.status);
  return jsonResponse({ ok: true, code, status });
}
