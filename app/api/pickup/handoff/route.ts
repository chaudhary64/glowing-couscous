import { authorizePickup, callPickupApi } from "@/lib/pickup/api";
import { DEMO_LOAD } from "@/lib/pickup/demo";

/**
 * POST /api/pickup/handoff — the collector's "Hand over e-waste" button. Routes the load
 * to a licensed recycler and returns the handoff PIN, once.
 *
 * The body is the demo load, not the request's: this pilot's phone has one load to
 * hand over, and letting the browser name the stream or the mass would let it name a
 * different price. The Lambda validates everything again regardless.
 */
export async function POST(request: Request) {
  const access = await authorizePickup(request, "/handoff");
  if (!access.ok) return access.denied;

  return callPickupApi("POST", "/pickups", {
    body: {
      itemCode: DEMO_LOAD.itemCode,
      collectorId: DEMO_LOAD.collectorId,
      city: DEMO_LOAD.city,
      wardCode: DEMO_LOAD.wardCode,
      stream: DEMO_LOAD.stream,
      declaredMassG: DEMO_LOAD.declaredMassG,
      hazardNotes: [...DEMO_LOAD.hazardNotes],
    },
  });
}
