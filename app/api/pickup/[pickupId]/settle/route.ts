import { authorizePickup, callPickupApi, pickupIdFrom, pickupJson } from "@/lib/pickup/api";

/**
 * POST /api/pickup/[pickupId]/settle — the gate: the PIN from the collector's phone and
 * the mass on the weighbridge. Only those two fields are forwarded; the amount is the
 * Lambda's arithmetic, never the browser's.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/pickup/[pickupId]/settle">) {
  const access = await authorizePickup(request, "/gate");
  if (!access.ok) return access.denied;

  const pickupId = pickupIdFrom((await params).pickupId);
  if (!pickupId) {
    return pickupJson({ error: { code: "invalid_request", message: "Pickup ids look like PU-2026-0001." } }, 400);
  }

  let body: { pin?: unknown; weighedMassG?: unknown };
  try {
    body = await request.json();
  } catch {
    return pickupJson({ error: { code: "invalid_request", message: "Body must be JSON." } }, 400);
  }

  return callPickupApi(access.user, "POST", `/pickups/${pickupId}/settle`, {
    body: {
      pin: body.pin,
      weighedMassG: body.weighedMassG,
      settledVia: "upi",
      issuedBy: access.user.email ?? undefined,
    },
  });
}
