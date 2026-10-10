import { authorizePickup, callPickupApi, pickupIdFrom, pickupJson } from "@/lib/pickup/api";

/**
 * GET /api/pickup/[pickupId] — one load, its PIN state and its note. The phone polls this
 * for the flip to `payoutStatus: "paid"`; the gate reads it to show what it is settling.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/pickup/[pickupId]">) {
  const access = await authorizePickup(request, "/handoff");
  if (!access.ok) return access.denied;

  const pickupId = pickupIdFrom((await params).pickupId);
  if (!pickupId) {
    return pickupJson({ error: { code: "invalid_request", message: "Pickup ids look like PU-2026-0001." } }, 400);
  }
  return callPickupApi(access.user, "GET", `/pickups/${pickupId}`);
}
