import { authorizePickup, callPickupApi, pickupJson } from "@/lib/pickup/api";
import { readHandoffLoad } from "@/lib/pickup/load";

/**
 * POST /api/pickup/handoff — the collector's "Hand over e-waste" button. Routes the load
 * to a licensed recycler and returns the handoff PIN, once.
 *
 * The body is resolved on the server from the priced record, not sent by the browser:
 * this pilot's phone hands over the newest item the gatekeeper has cleared, and letting
 * the client name the stream or the mass would let it name a different price. The client
 * never sees the payload it cannot alter, and the Lambda validates everything again
 * regardless.
 */
export async function POST(request: Request) {
  const access = await authorizePickup(request, "/handoff");
  if (!access.ok) return access.denied;

  const resolved = await readHandoffLoad();
  const load = resolved.load;

  if (!load) {
    return pickupJson(
      {
        error: {
          code: "no_cleared_load",
          message:
            resolved.error ??
            resolved.reason ??
            "No cleared item is on file, so there is no load to hand over.",
        },
      },
      409,
    );
  }

  return callPickupApi("POST", "/pickups", {
    body: {
      itemCode: load.itemCode,
      collectorId: load.collectorId,
      city: load.city,
      wardCode: load.wardCode,
      stream: load.stream,
      declaredMassG: load.declaredMassG,
      hazardNotes: [...load.hazardNotes],
    },
  });
}
