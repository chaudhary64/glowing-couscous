import { authorizePickup, callPickupApi, pickupIdFrom, pickupJson } from "@/lib/pickup/api";

/** GET /api/pickup/[pickupId]/events — the load's audit trail, oldest first. */
export async function GET(request: Request, { params }: RouteContext<"/api/pickup/[pickupId]/events">) {
  const access = await authorizePickup(request, "/gate");
  if (!access.ok) return access.denied;

  const pickupId = pickupIdFrom((await params).pickupId);
  if (!pickupId) {
    return pickupJson({ error: { code: "invalid_request", message: "Pickup ids look like PU-2026-0001." } }, 400);
  }
  return callPickupApi("GET", `/pickups/${pickupId}/events`);
}
