import Link from "next/link";
import { LiveAnalysis } from "@/components/features/ai/live-analysis";
import { IntakeConsole } from "@/components/features/intake/intake-console";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { intakeSamples, intakeStats } from "@/lib/data/intake";
import { getItem } from "@/lib/data/inventory";
import { formatInr, formatMass, formatPct, formatTimeOfDay } from "@/lib/format";
import { conditionTone, verdictLabel, verdictTone } from "@/lib/tone";
import type { IntakeSample, ResolvedItemSummary } from "@/lib/types";

export const instant = false;

/** Built on the server so the console never reaches into the inventory fixture. */
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

/** What each upload sets in motion, in the order it runs. */
const pipeline: { service: string; detail: string }[] = [
  {
    service: "Gemini · multimodal",
    detail: "One call reads the photograph and any Hindi audio together.",
  },
  {
    service: "Rate card",
    detail:
      "Material fractions are priced on the server. The model names materials and masses; it never quotes a rupee figure.",
  },
  {
    service: "Gatekeeper",
    detail:
      "The same pass returns the valid/invalid decision, the rule that fired and why.",
  },
  {
    service: "Audit trail",
    detail:
      "The parsed record is kept before valuation, so nothing is priced off thin air.",
  },
];

export default async function IntakePage() {
  await requireAccess("/intake");

  const resolved = Object.fromEntries(intakeSamples.map(resolvedEntry));

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Operations · Intake"
        title="New intake"
        lede="Point a phone at the item or say what it is in Hindi. The upload comes back as a priced item with a confidence on every field, and nothing is promised to the collector until it clears the gatekeeper."
        actions={
          <ButtonLink href="/valuation" variant="secondary">
            Open valuations
          </ButtonLink>
        }
      />

      <LiveAnalysis mode="intake" />

      <StatGrid columns={4}>
        <Stat
          label="Intakes today"
          value={String(intakeStats.today)}
          unit="items"
          note="Across the Mumbai and Pune pilot zones."
        />
        <Stat
          label="Voice first"
          value={formatPct(intakeStats.voiceShare)}
          emphasis
          note="Spoken descriptions, not typed forms."
        />
        <Stat
          label="Languages live"
          value={String(intakeStats.languages.length)}
          unit="languages"
          note="A language is configuration, not a new screen."
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
              Stop at Hindi and most of the country is out of reach. The pipeline
              takes a language as configuration, so coverage grows without a
              rewrite.
            </p>
          </Panel>

          <Panel eyebrow="Under the hood" title="What runs on capture">
            <ol className="flex flex-col gap-3">
              {pipeline.map((entry) => (
                <li key={entry.service} className="border-t border-rule pt-3 first:border-t-0 first:pt-0">
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
                    {entry.service}
                  </p>
                  <p className="mt-1 text-[12px] leading-snug text-ink-soft">
                    {entry.detail}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel eyebrow="Step back" title="Written up in detail">
            <p className="text-sm leading-relaxed text-ink-soft">
              The ranking, the fraud controls and why vernacular voice matters are
              argued in the feature write-up.
            </p>
            <Link
              href="/doc/features/intake"
              className="mt-4 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
            >
              Read the intake write-up →
            </Link>
          </Panel>
        </aside>
      </div>

      <section>
        <SectionHeader
          eyebrow="Today"
          title="Intakes captured"
          note="Four most recent of the day's uploads, each followed through to the item it priced."
        />

        <Surface className="mt-4">
          <Table caption={`4 most recent of ${intakeStats.today} intakes today`}>
            <THead>
              <TR>
                <TH className="w-20">Time</TH>
                <TH className="w-20">Mode</TH>
                <TH>Intake</TH>
                <TH>Resolved item</TH>
                <TH className="hidden sm:table-cell" numeric>
                  Mass
                </TH>
                <TH>Verdict</TH>
                <TH className="hidden md:table-cell" numeric>
                  Net
                </TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {intakeSamples.map((sample) => {
                const item = getItem(sample.resolvedItemId);
                return (
                  <TR key={sample.id}>
                    <TD mono className="text-ink-muted">
                      {formatTimeOfDay(sample.capturedAt)}
                    </TD>
                    <TD>
                      <Badge tone={sample.mode === "voice" ? "copper" : "neutral"}>
                        {sample.mode === "voice" ? "Voice" : "Photo"}
                      </Badge>
                    </TD>
                    <TD>
                      <span className="font-medium">{sample.subject}</span>
                      <p className="mt-1 font-mono text-[11px] text-ink-muted">
                        {sample.id}
                        {sample.voiceNote
                          ? ` · ${sample.voiceNote.language} · ${sample.voiceNote.durationSeconds}s`
                          : " · single photo"}
                      </p>
                    </TD>
                    <TD>
                      <Link
                        href="/valuation"
                        className="underline decoration-rule decoration-1 underline-offset-2 hover:decoration-copper"
                      >
                        {item.label}
                      </Link>
                      <p className="mt-1 font-mono text-[11px] text-ink-muted">
                        {item.id}
                      </p>
                    </TD>
                    <TD numeric mono className="hidden sm:table-cell">
                      {formatMass(item.massGrams)}
                    </TD>
                    <TD>
                      <Badge tone={verdictTone(item.gatekeeper.verdict)}>
                        {verdictLabel(item.gatekeeper.verdict)}
                      </Badge>
                      <p className="mt-1">
                        <Badge tone={conditionTone(item.condition)}>
                          {item.condition}
                        </Badge>
                      </p>
                    </TD>
                    <TD numeric mono className="hidden md:table-cell">
                      {item.valuation.netToCollector > 0
                        ? formatInr(item.valuation.netToCollector)
                        : "—"}
                    </TD>
                    <TD>
                      <Link
                        href="/valuation"
                        className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
                      >
                        Open →
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>

          <p className="border-t border-rule px-3 py-3 text-[12px] leading-relaxed text-ink-muted">
            A rejected upload never reaches a payout: the bottle at 14:44 was caught
            by rule R-01, and the phone that still powers on went to reuse under
            R-03 instead of the shredding stream.
          </p>
        </Surface>
      </section>
    </div>
  );
}
