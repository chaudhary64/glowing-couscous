import { authorizePickup, callPickupApi, pickupIdFrom, pickupJson } from "@/lib/pickup/api";

/**
 * POST /api/pickup/[pickupId]/pin — a fresh PIN on the phone, after the first expired or
 * was locked by wrong guesses. The old PIN stops working when this returns.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/pickup/[pickupId]/pin">) {
  const access = await authorizePickup(request, "/handoff");
  if (!access.ok) return access.denied;

  const pickupId = pickupIdFrom((await params).pickupId);
  if (!pickupId) {
    return pickupJson({ error: { code: "invalid_request", message: "Pickup ids look like PU-2026-0001." } }, 400);
  }
  return callPickupApi(access.user, "POST", `/pickups/${pickupId}/pin`);
}
