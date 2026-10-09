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
import { formatConfidence, formatInr, formatMass, formatPct, formatTimestamp } from "@/lib/format";
import { listRecentIntakes, storedCounts } from "@/lib/records/queues";
import { conditionTone, verdictLabel, verdictTone } from "@/lib/tone";
import type { IntakeSample, ResolvedItemSummary } from "@/lib/types";

export const instant = false;

/**
 * Built on the server so the sample console never reaches into the inventory fixture.
 *
 * This is the one fixture-shaped thing left on the screen besides the language panel:
 * the console walks four fixed submissions on purpose, because those four walk four
 * different verdict paths — credited, hazard-routed, held, refused — and no live stream
 * is guaranteed to contain all four. Everything above and below it is a query.
 */
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
    service: "Microsoft Foundry · multimodal",
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
      "The submission, the fields the model read out of it, the assay, the price and the verdict are all written before the response goes back — so nothing on this screen has to be taken on trust.",
  },
];

export default async function IntakePage() {
  await requireAccess("/intake");

  const [tallies, log] = await Promise.all([storedCounts(), listRecentIntakes(6)]);
  const counts = tallies.counts;
  const resolved = Object.fromEntries(intakeSamples.map(resolvedEntry));
  const readError = tallies.error ?? log.error;

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Operations · Intake"
        title="New intake"
        lede="Point a phone at the item or say what it is in Hindi. The upload comes back as a priced item with a confidence on every field, and nothing is promised to the collector until it clears the gatekeeper. Every figure below is counted from the submissions this database holds."
        actions={
          <ButtonLink href="/valuation" variant="secondary">
            Open valuations
          </ButtonLink>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={tallies.configured ? "verified" : "hazard"}>
              {tallies.configured ? "Recorded" : "No database"}
            </Badge>
            <Badge tone={log.configured ? "neutral" : "hazard"}>
              {log.configured
                ? `${counts?.intakesTotal ?? 0} submissions on file`
                : "Records off"}
            </Badge>
            {readError ? (
              <span className="text-[12px] leading-snug text-hazard">{readError}</span>
            ) : null}
          </div>
        }
      />

      <LiveAnalysis mode="intake" />

      <StatGrid columns={4}>
        <Stat
          label="Intakes today"
          value={String(counts?.intakesToday ?? 0)}
          unit="items"
          note={`${counts?.intakesTotal ?? 0} submissions on file in total.`}
        />
        <Stat
          label="Voice first"
          value={
            counts?.voiceShare === null || counts?.voiceShare === undefined
              ? "—"
              : formatPct(counts.voiceShare)
          }
          emphasis
          note={
            counts?.voiceShare === null || counts?.voiceShare === undefined
              ? "No submission has been recorded today, so there is no share to take."
              : "Spoken descriptions, not typed forms, among today's submissions."
          }
        />
        <Stat
          label="Median turnaround"
          value={
            counts?.medianLatencySeconds === null ||
            counts?.medianLatencySeconds === undefined
              ? "—"
              : String(counts.medianLatencySeconds)
          }
          unit="seconds"
          note="From upload to a field the collector can be shown, across today's submissions."
        />
        <Stat
          label="Items priced"
          value={String(counts?.itemsPriced ?? 0)}
          unit="items"
          note={`${counts?.verified ?? 0} cleared, ${counts?.held ?? 0} held, ${counts?.rejected ?? 0} refused.`}
        />
      </StatGrid>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Sample data</Badge>
            <span className="text-[12px] leading-snug text-ink-muted">
              The console below walks four fixed submissions, because those four cover
              the four verdict paths. The table further down is what this database
              actually holds.
            </span>
          </p>
          <IntakeConsole samples={intakeSamples} resolved={resolved} />
        </div>

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
          eyebrow="Recorded"
          title="Intakes captured"
          note="The most recent submissions this database holds, each joined to the item it was priced as and to the fields the model read out of it."
        />

        <Surface className="mt-4">
          {!log.configured ? (
            <p className="px-4 py-4 text-sm leading-relaxed text-ink-soft">
              <Badge tone="hazard">No database</Badge> — this deployment has no
              <span className="font-mono"> DATABASE_URL</span>, so nothing is recorded
              and there is nothing to list. The capture panel above still analyses and
              prices; the rows simply do not outlive the request.
            </p>
          ) : log.rows.length === 0 ? (
            <p className="px-4 py-4 text-sm leading-relaxed text-ink-soft">
              <Badge tone="neutral">Nothing recorded yet</Badge> — run a capture above
              and the submission appears here with the item it resolved to.
            </p>
          ) : (
            <>
              <Table
                caption={`${log.rows.length} most recent of ${counts?.intakesTotal ?? log.rows.length} submissions on file`}
              >
                <THead>
                  <TR>
                    <TH className="w-32">Submitted</TH>
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
                  {log.rows.map((row) => (
                    <TR key={row.id}>
                      <TD mono className="text-ink-muted">
                        {formatTimestamp(row.submittedAt)}
                      </TD>
                      <TD>
                        <Badge tone={row.mode === "voice" ? "copper" : "neutral"}>
                          {row.mode === "voice" ? "Voice" : "Photo"}
                        </Badge>
                      </TD>
                      <TD>
                        <span className="font-medium">{row.summary ?? "Untitled submission"}</span>
                        <p className="mt-1 font-mono text-[11px] text-ink-muted">
                          {row.id}
                          {row.model ? ` · ${row.model}` : ""}
                          {row.confidence !== null
                            ? ` · ${formatConfidence(row.confidence)} confidence`
                            : ""}
                        </p>
                        <p className="mt-1 text-[11px] leading-snug text-ink-muted">
                          {row.fields.length > 0
                            ? `${row.fields.length} parsed field${row.fields.length === 1 ? "" : "s"} kept`
                            : "No parsed fields kept — this route ran the identification pass only"}
                        </p>
                      </TD>
                      <TD>
                        {row.item ? (
                          <>
                            <Link
                              href={`/valuation?item=${encodeURIComponent(row.item.id)}`}
                              className="underline decoration-rule decoration-1 underline-offset-2 hover:decoration-copper"
                            >
                              {row.item.label}
                            </Link>
                            <p className="mt-1 font-mono text-[11px] text-ink-muted">
                              {row.item.id}
                            </p>
                          </>
                        ) : (
                          <>
                            <span className="text-ink-muted">Not priced</span>
                            <p className="mt-1 text-[11px] leading-snug text-ink-muted">
                              No item row is joined to this submission.
                            </p>
                          </>
                        )}
                      </TD>
                      <TD numeric mono className="hidden sm:table-cell">
                        {row.item ? formatMass(row.item.massGrams) : "—"}
                      </TD>
                      <TD>
                        {row.item?.verdict ? (
                          <>
                            <Badge tone={verdictTone(row.item.verdict)}>
                              {verdictLabel(row.item.verdict)}
                            </Badge>
                            <p className="mt-1">
                              <Badge tone={conditionTone(row.item.condition)}>
                                {row.item.condition}
                              </Badge>
                            </p>
                          </>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </TD>
                      <TD numeric mono className="hidden md:table-cell">
                        {row.item?.netToCollector ? formatInr(row.item.netToCollector) : "—"}
                      </TD>
                      <TD>
                        {row.item ? (
                          <Link
                            href={`/valuation?item=${encodeURIComponent(row.item.id)}`}
                            className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
                          >
                            Open →
                          </Link>
                        ) : null}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              <p className="border-t border-rule px-3 py-3 text-[12px] leading-relaxed text-ink-muted">
                A rejected submission keeps its evidence and is listed here like any
                other; it simply never reaches a payout. A submission written before the
                priced record existed shows as not priced rather than being handed an
                item it never resolved to.
              </p>
            </>
          )}
        </Surface>
      </section>
    </div>
  );
}
