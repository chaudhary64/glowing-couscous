import { listLoads } from "@/lib/pickup/directory";
import type { PickupView } from "@/lib/pickup/types";

/**
 * What the handoff screens need in order to say whose load is on the phone.
 *
 * The phone has always been demonstrated on `DEMO_LOAD`, and the button has always routed
 * that load — `POST /api/pickup/handoff` builds its body from the same constant, never from
 * the browser. That is a coherent demo, but nothing on the screen said so: it read as
 * "today's load" and left the reader to believe the board held it.
 *
 * So the page reads the board and states both facts side by side — the sample the button
 * routes, and the newest load the service is actually holding. Neither is inferred from the
 * other, and neither is presented as the other.
 *
 * Same rules as the other reads in `lib/pickup/directory.ts`: an unconfigured service is not
 * an error, a failed read is a sentence rather than a thrown page, and nothing is invented.
 */
export interface HandoffContext {
  configured: boolean;
  error: string | null;
  /** Loads the service has routed and not yet settled. */
  openCount: number;
  /** The most recently requested of them, or null when none is open. */
  newest: PickupView | null;
}

export async function readHandoffContext(): Promise<HandoffContext> {
  const board = await listLoads(25);
  if (!board.configured) {
    return { configured: false, error: null, openCount: 0, newest: null };
  }
  if (board.error) {
    return { configured: true, error: board.error, openCount: 0, newest: null };
  }

  const open = board.rows.filter((load) => load.status !== "settled");
  const newest = open.reduce<PickupView | null>(
    (latest, load) => (!latest || load.requestedAt > latest.requestedAt ? load : latest),
    null,
  );

  return { configured: true, error: null, openCount: open.length, newest };
}
