import { Surface } from "@/components/ui/card";
import { Stamp } from "@/components/ui/stamp";
import { whatsappVerdict } from "@/lib/data/channels";

/**
 * The deferral, stated as the loudest thing on the page. An ink block against
 * paper, with the stamp struck on a paper slip so the ink mark stays legible.
 */
export function WhatsAppVerdict() {
  return (
    <Surface tone="ink">
      <div aria-hidden className="h-1.5 bg-copper" />

      <div className="flex flex-wrap items-start justify-between gap-6 px-5 py-5">
        <div className="min-w-0 max-w-2xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-copper">
            Decision · rank 06 of 06
          </p>
          <h2 className="mt-2 font-display text-3xl uppercase leading-none tracking-tight text-paper sm:text-4xl">
            {whatsappVerdict.decision}
          </h2>
          <p className="mt-3 text-base leading-relaxed text-paper/85">
            {whatsappVerdict.headline}
          </p>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-paper/55">
            WhatsApp voice-note intake · deferred by choice, not by omission
          </p>
        </div>

        <div className="border border-paper/40 bg-paper-raised px-5 py-4">
          <Stamp label="Deferred" tone="ink" angle={-8} />
        </div>
      </div>

      <div className="border-t border-paper/25 px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/55">
          The line to give a judge
        </p>
        <p className="mt-2 border-l-2 border-copper pl-4 text-sm leading-relaxed text-paper">
          {whatsappVerdict.demoLine}
        </p>
      </div>

      <div className="grid border-t border-paper/25 sm:grid-cols-2">
        <div className="border-b border-paper/25 px-5 py-4 sm:border-b-0 sm:border-r">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/55">
            What building it costs
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-paper/90">
            {whatsappVerdict.costOfBuilding}
          </p>
        </div>
        <div className="px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/55">
            What skipping it costs
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-paper/90">
            {whatsappVerdict.costOfSkipping}
          </p>
        </div>
      </div>
    </Surface>
  );
}
