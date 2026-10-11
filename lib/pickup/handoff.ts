import { listLoads } from "@/lib/pickup/directory";
import { readHandoffLoad, type HandoffLoad } from "@/lib/pickup/load";
import type { PickupView } from "@/lib/pickup/types";

/**
 * What the handoff screens need: the load on the phone, and the loads the service holds.
 *
 * Two reads that are deliberately kept apart, because they answer two different
 * questions. The load is the newest cleared item from the priced record — the thing the
 * button will route. The board is what the smart-pickup service is already holding.
 * Neither stands in for the other: the phone routes a load this app resolved, and the
 * panel beside it names the newest open row the service has, and a screen never lets one
 * read look like the other.
 *
 * Same rules as every other read in this codebase: an unconfigured integration is not an
 * error, a failed read is a sentence rather than a thrown page, and nothing is invented.
 */
export interface HandoffContext {
  /** False when there is no `DATABASE_URL`: nothing can be resolved to hand over. */
  loadConfigured: boolean;
  /** Set when the records database was configured and the read failed. */
  loadError: string | null;
  /** Why there is no load, when there is none. */
  loadReason: string | null;
  /** The load the phone hands over, or null when nothing is cleared to route. */
  load: HandoffLoad | null;

  /** False when `PICKUP_API_URL` is unset: the board cannot be read. */
  configured: boolean;
  /** Set when the pickup service was configured and the read failed. */
  error: string | null;
  /** Loads the service has routed and not yet settled. */
  openCount: number;
  /** The most recently requested of them, or null when none is open. */
  newest: PickupView | null;
}

export async function readHandoffContext(): Promise<HandoffContext> {
  const [board, load] = await Promise.all([listLoads(25), readHandoffLoad()]);

  const fromLoad = {
    loadConfigured: load.configured,
    loadError: load.error,
    loadReason: load.reason,
    load: load.load,
  };

  if (!board.configured) {
    return { ...fromLoad, configured: false, error: null, openCount: 0, newest: null };
  }
  if (board.error) {
    return { ...fromLoad, configured: true, error: board.error, openCount: 0, newest: null };
  }

  const open = board.rows.filter((entry) => entry.status !== "settled");
  const newest = open.reduce<PickupView | null>(
    (latest, entry) => (!latest || entry.requestedAt > latest.requestedAt ? entry : latest),
    null,
  );

  return { ...fromLoad, configured: true, error: null, openCount: open.length, newest };
}
