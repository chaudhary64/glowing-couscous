import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { formatMass, formatTimestamp } from "@/lib/format";
import { DEMO_LOAD } from "@/lib/pickup/demo";
import type { HandoffContext } from "@/lib/pickup/handoff";
import { pickupLabel } from "@/lib/tone";

/**
 * Which load is on the phone, and which loads the service is holding.
 *
 * Two rows, because they are two different facts. The top one is the load the handover
 * button routes: the pilot's fixed sample, named as the sample it is. The bottom one is a
 * read of `GET /pickups` — the loads the service actually holds, newest open one named.
 * The screen never lets one stand in for the other.
 */
export function HandoffLoadContext({ context }: { context: HandoffContext }) {
  return (
    <Surface tone="inset" className="divide-y divide-rule-soft">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 p-4">
        <Badge tone="review">Sample load</Badge>
        <span className="font-mono text-[12px] text-ink">
          {DEMO_LOAD.itemCode} · {DEMO_LOAD.label} · {formatMass(DEMO_LOAD.declaredMassG)} ·{" "}
          {DEMO_LOAD.collectorId}
        </span>
        <p className="w-full max-w-3xl text-[12px] leading-snug text-ink-soft">
          The handover button routes this load, and only this one — the server builds the
          request from it, so no button press can route anything else. It is the pilot&rsquo;s
          fixed sample, the same one every take uses, not a row read from the service.
        </p>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 p-4">
        <Badge tone="neutral">On the service</Badge>
        <span className="font-mono text-[12px] text-ink">
          {!context.configured ? (
            "not configured"
          ) : context.error ? (
            "read failed"
          ) : context.newest ? (
            <>
              {context.openCount} open · newest {context.newest.pickupId} ·{" "}
              {context.newest.itemCode} · {context.newest.streamLabel} ·{" "}
              {formatMass(context.newest.declaredMassG)} ·{" "}
              {pickupLabel(context.newest.status)} ·{" "}
              {formatTimestamp(context.newest.requestedAt)}
            </>
          ) : (
            "no load open"
          )}
        </span>
        <p className="w-full max-w-3xl text-[12px] leading-snug text-ink-soft">
          {!context.configured
            ? "The smart-pickup service is not configured, so there is no live board to read."
            : context.error
              ? `The load board could not be read: ${context.error}`
              : context.newest
                ? `Read from the load board. Its PIN and gate are not on this screen, and the phone does not hand this row over — it is what the service holds, not what the button routes.`
                : "Every load the service holds has settled, so nothing is open. The phone still hands over the sample load above."}
        </p>
      </div>
    </Surface>
  );
}
