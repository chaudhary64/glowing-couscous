import { LiveAnalysis } from "@/components/features/ai/live-analysis";
import { IntakeConsole } from "@/components/features/intake/intake-console";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { mayOpen, RoleLink } from "@/components/ui/role-link";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { scopeForUser } from "@/lib/records/scope";
import { listCollectorOptions } from "@/lib/records/users";
import { formatConfidence, formatInr, formatMass, formatPct, formatTimestamp } from "@/lib/format";
import { listRecentIntakes, storedCounts } from "@/lib/records/queues";
import { conditionTone, verdictLabel, verdictTone } from "@/lib/tone";

export const instant = false;

/**
 * The intake screen, counted and read rather than authored.
 *
 * Every panel here is a row: the tallies from `storedCounts`, the capture console from
 * `listRecentIntakes`, and the record table below from the same read. There is no fixture
 * left on the screen — the console shows the submissions this database actually holds,
 * so a live capture appears in it as soon as it is priced and written.
 */
export default async function IntakePage() {
  const user = await requireAccess("/intake");
  const scope = await scopeForUser(user);
  const canValue = mayOpen(user.role, "/valuation");

  const [tallies, log] = await Promise.all([storedCounts(scope), listRecentIntakes(8)]);
  const collectors = await listCollectorOptions();
  const counts = tallies.counts;
  const readError = tallies.error ?? log.error;

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Operations · Intake"
        title="New intake"
        lede="Point a phone at the item or say what it is in Hindi. The upload comes back as a priced item with a confidence on every field, and nothing is promised to the collector until it clears the gatekeeper. Every figure below is counted from the submissions this database holds."
        actions={
          canValue ? (
            <ButtonLink href="/valuation" variant="secondary">
              Open valuations
            </ButtonLink>
          ) : undefined
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
              <span className="text-[12px] leading-snug text-hazard-ink">{readError}</span>
            ) : null}
          </div>
        }
      />

      <LiveAnalysis mode="intake" collectors={collectors} />

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

      <IntakeConsole intakes={log.rows} canValue={canValue} />

      <section>
        <SectionHeader
          eyebrow="Recorded"
          title="Intakes captured"
          note="The most recent submissions on file, each with the item it was priced as and the fields the model read out of it."
        />

        <Surface className="mt-4">
          {!log.configured ? (
            <p className="px-4 py-4 text-sm leading-relaxed text-ink-soft">
              <Badge tone="hazard">No database</Badge> — this deployment has no records
              database, so nothing is recorded and there is nothing to list. The capture
              panel above still analyses and prices; the result simply is not kept.
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
                            <RoleLink
                              role={user.role}
                              href={`/valuation?item=${encodeURIComponent(row.item.id)}`}
                              className="underline decoration-rule decoration-1 underline-offset-2 hover:decoration-copper"
                            >
                              {row.item.label}
                            </RoleLink>
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
                          <RoleLink
                            role={user.role}
                            href={`/valuation?item=${encodeURIComponent(row.item.id)}`}
                            hide
                            className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
                          >
                            Open →
                          </RoleLink>
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
