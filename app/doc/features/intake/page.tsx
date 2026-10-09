import { IntakeConsole } from "@/components/features/intake/intake-console";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/card";
import { MetaRow, PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { getFeature } from "@/lib/data/features";
import { intakeSamples, intakeStats } from "@/lib/data/intake";
import { getItem } from "@/lib/data/inventory";
import { formatPct } from "@/lib/format";
import type { IntakeSample, ResolvedItemSummary } from "@/lib/types";

const pipeline: { step: string; service: string; detail: string }[] = [
  {
    step: "Read the upload",
    service: "Microsoft Foundry · multimodal",
    detail:
      "One call takes the photograph and the Hindi audio together. Nothing is transcribed by a separate service first.",
  },
  {
    step: "Contract to fields",
    service: "Foundry response schema",
    detail:
      "The reply is constrained to a typed shape, so every field arrives with its own confidence and its source.",
  },
  {
    step: "Price it",
    service: "EcoEPR rate card",
    detail:
      "Material fractions are matched against a closed list and priced on the server. The model never states a rupee figure.",
  },
  {
    step: "Gate it",
    service: "Reject rules R-01 to R-04",
    detail:
      "The same pass returns verified, held for review or rejected, naming the rule that fired and why.",
  },
];

function resolvedEntry(sample: IntakeSample): [string, ResolvedItemSummary] {
  const item = getItem(sample.resolvedItemId);
  return [
    sample.id,
    {
      id: item.id,
      label: item.label,
      category: item.category,
      brand: item.brand,
      condition: item.condition,
      massGrams: item.massGrams,
      netToCollector: item.valuation.netToCollector,
      creditNote: item.valuation.eprCreditNote,
      verdict: item.gatekeeper.verdict,
    },
  ];
}

export default function IntakePage() {
  const feature = getFeature("intake");
  const resolved = Object.fromEntries(intakeSamples.map(resolvedEntry));

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        feature={feature}
        lede="A collector points a phone at a scrap board, or simply says what it is in Hindi. That upload becomes structured item data with a confidence on every field."
        meta={
          <MetaRow label="Today">
            <Badge tone="copper">{intakeStats.today} intakes</Badge>
            <Badge tone="neutral">
              {formatPct(intakeStats.voiceShare)} arrive as voice
            </Badge>
            <Badge tone="neutral">
              median {intakeStats.medianTurnaroundSeconds} s to fields
            </Badge>
          </MetaRow>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Intakes today"
          value={String(intakeStats.today)}
          unit="uploads"
          note="Across the Mumbai and Pune pilot zones."
        />
        <Stat
          label="Voice first"
          value={formatPct(intakeStats.voiceShare)}
          emphasis
          note="Spoken descriptions, not typed text. This is the channel the work already uses."
        />
        <Stat
          label="Languages live"
          value={String(intakeStats.languages.length)}
          unit="languages"
          note="Adding one is a prompt and a model choice, not a new screen."
        />
        <Stat
          label="Median turnaround"
          value={String(intakeStats.medianTurnaroundSeconds)}
          unit="seconds"
          note="From upload to a field the collector can be shown."
        />
      </StatGrid>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <IntakeConsole samples={intakeSamples} resolved={resolved} />

        <aside className="flex flex-col gap-6 lg:sticky lg:top-16 lg:self-start">
          <Panel eyebrow="Coverage" title="Languages in the pilot">
            <ul className="flex flex-wrap gap-1.5">
              {intakeStats.languages.map((language) => (
                <li key={language}>
                  <Badge tone="copper">{language}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Stop at Hindi and you lose most of the country. The pipeline takes a
              language as configuration, so coverage grows without a rewrite.
            </p>
          </Panel>

          <Panel eyebrow="What does the work" title="Intake pipeline">
            <ol className="flex flex-col gap-4">
              {pipeline.map((entry, index) => (
                <li key={entry.step} className="border-t border-rule pt-3 first:border-t-0 first:pt-0">
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-copper">
                    Step {String(index + 1).padStart(2, "0")}
                  </p>
                  <p className="mt-1 text-sm font-medium text-ink">{entry.step}</p>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                    {entry.service}
                  </p>
                  <p className="mt-1.5 text-[12px] leading-snug text-ink-soft">
                    {entry.detail}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel eyebrow="Why voice" title="Speech is the intake channel">
            <SectionHeader
              title="Described, not filled in"
              note="1.5 million informal collectors work by describing what is in their hand. A form asks them to translate that into somebody else's categories."
            />
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              The transcript above is the same sentence a collector would say at the
              doorstep. Everything downstream — assay, price, credit — is derived from
              it, which is why this screen is rank 02 and not an afterthought.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
