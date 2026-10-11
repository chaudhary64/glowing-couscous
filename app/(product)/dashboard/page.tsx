import Link from "next/link";
import { Badge, Dot } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { MeterRow } from "@/components/ui/meter";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { SIMULATED_CLAIM } from "@/lib/disclaimer";
import { getHeatmap } from "@/lib/heatmap/store";
import { formatInr, formatPct, formatTimestamp } from "@/lib/format";
import { listCollectorActivity, listLoads } from "@/lib/pickup/directory";
import { listRecentEvents, storedCounts } from "@/lib/records/queues";
import { activityLabel, activityTone, pickupLabel, pickupTone } from "@/lib/tone";

export const instant = false;

/**
 * The dashboard, counted rather than authored.
 *
 * Until the priced record existed there was nothing on this screen a query could back:
 * every figure came from `lib/data`, and the file said so. Now the four tiles, the work
 * queue's judgement calls and the activity feed are read from the rows the pipeline
 * writes — `intakes`, `items`, `valuations`, `gatekeeper_verdicts`, `validation_decisions`
 * — through `lib/records/queues.ts`.
 *
 * What is deliberately *not* counted, and is labelled as sample instead:
 *
 * - **Pickups and credit notes.** Feature 04, Smart Pickup & Digital Credit, routes to a
 *   recycler and mints a credit note, and nothing writes `pickups`, `credit_notes` or
 *   `ledger_entries`. The "Loads in play" board is the sample board from `lib/data`.
 * - **Collector standing.** The roster has no writer yet; the panel says so.
 *
 * Ward pressure and open hotspots *are* counted: they come from the same
 * `getHeatmap()` call `/map` makes, over geotagged intakes.
 *
 * Saying that plainly is the point. A dashboard that mixes counted rows with authored
 * ones and calls them all "today" is a dashboard nobody can trust twice.
 */

export default async function DashboardPage() {
  const user = await requireAccess("/dashboard");

  const [snapshot, events, heat, board, activity] = await Promise.all([
    storedCounts(),
    listRecentEvents(8),
    getHeatmap(),
    listLoads(user, 50),
    listCollectorActivity(user, 25),
  ]);
  // Only collectors with something settled are ranked: a bar at zero is not a standing.
  const topCollectors = activity.rows.filter((row) => row.settledInr > 0).slice(0, 4);
  const loads = board.rows;
  const openLoads = loads.filter((load) => load.status !== "settled");
  const notesIssued = loads.filter((load) => Boolean(load.creditNoteId));
  const notesInr =
    loads.reduce((total, load) => total + Number(load.creditNoteAmountPaise ?? 0), 0) / 100;
  const openSites = heat.clusters.filter((c) => c.status === "open");
  // Across India, by district: the busiest four, each with its state.
  const pressureWards = heat.districts.slice(0, 4);
  const counts = snapshot.counts;
  const configured = snapshot.configured;

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Operations"
        title="Today"
        lede={
          counts
            ? `${counts.intakesToday} intakes today, ${counts.itemsPriced} items priced, and ${counts.awaitingDecision} waiting on a human decision. Every panel here is counted: the tiles, the work queue and the activity feed from the pipeline's own rows, and the load board and collector ranking from the pickup service.`
            : "The pipeline writes its submissions, prices, verdicts and decisions into Postgres, and this screen counts them. With no database configured there is nothing to count, and the panels below say what they could not read."
        }
        actions={
          <>
            <ButtonLink href="/intake">New intake</ButtonLink>
            <ButtonLink href="/validation" variant="secondary">
              Clear validation queue
            </ButtonLink>
          </>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={configured ? "verified" : "hazard"}>
              {configured ? "Counted from the database" : "No database"}
            </Badge>
            {counts ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                {counts.intakesTotal} submissions · {counts.itemsPriced} items priced ·{" "}
                {counts.hazardousItems} hazard-flagged
              </span>
            ) : null}
            {snapshot.error ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-hazard-ink">
                {snapshot.error}
              </span>
            ) : null}
          </div>
        }
      />

      {counts ? (
        <StatGrid columns={4}>
          <Stat
            label="Intakes today"
            value={String(counts.intakesToday)}
            unit="items"
            note={
              counts.voiceShare === null
                ? "Nothing has been captured yet today."
                : `${formatPct(counts.voiceShare)} arrived as a Hindi voice note.${
                    counts.medianLatencySeconds !== null
                      ? ` Median read ${counts.medianLatencySeconds}s.`
                      : ""
                  }`
            }
          />
          <Stat
            label="Items priced"
            value={String(counts.itemsPriced)}
            unit="in the record"
            note={`${counts.verified} cleared by the gatekeeper, ${counts.held} held, ${counts.rejected} refused.`}
          />
          <Stat
            label="Awaiting a decision"
            value={String(counts.awaitingDecision)}
            unit="items"
            emphasis
            note={`${counts.decidedToday} decided today. A held item has no price until an officer answers it.`}
          />
          <Stat
            label="Net promised to collectors"
            value={formatInr(counts.netPayableInr)}
            note={`Cleared items only. ${formatInr(counts.eprCreditInr)} of brand EPR credit beside it. ${SIMULATED_CLAIM}`}
          />
        </StatGrid>
      ) : (
        <Surface tone="inset" className="p-4">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            No <span className="font-mono">DATABASE_URL</span> is configured, so no count
            can be taken: submissions, prices, verdicts and decisions are all written by
            the pipeline but not read back here. The tiles are therefore absent rather
            than showing zeroes, and each panel below says what it could not read instead
            of drawing a plausible number in its place.
          </p>
        </Surface>
      )}

      <section>
        <SectionHeader
          eyebrow="Work queue"
          title="Needs attention"
          note="Every card here is counted: the decisions and hotspots from the pipeline's own rows, the loads from the smart-pickup service's pickups table."
        />

        <ul className="mt-5 grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          <li className="bg-paper-raised p-4">
            <div className="flex items-start justify-between gap-3">
              <Dot tone="review" />
              <span className="font-display text-2xl leading-none tracking-tight text-copper">
                {counts ? counts.awaitingDecision : "—"}
              </span>
            </div>
            <h3 className="mt-3 text-sm font-medium leading-snug">
              <Link href="/validation" className="hover:text-copper">
                Items awaiting a human decision
              </Link>
            </h3>
            <p className="mt-1.5 text-[12px] leading-snug text-ink-muted">
              {counts
                ? `${counts.awaitingDecision} of the ${counts.held} items the gatekeeper held have no live decision on them yet.`
                : "The validation queue counts these itself."}
            </p>
            <p className="mt-3 flex items-center gap-2">
              <Badge tone="verified">Counted</Badge>
            </p>
            <Link
              href="/validation"
              className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
            >
              Open →
            </Link>
          </li>

          <li className="bg-paper-raised p-4">
            <div className="flex items-start justify-between gap-3">
              <Dot tone="hazard" />
              <span className="font-display text-2xl leading-none tracking-tight text-copper">
                {counts ? counts.rejected : "—"}
              </span>
            </div>
            <h3 className="mt-3 text-sm font-medium leading-snug">
              <Link href="/validation" className="hover:text-copper">
                Uploads refused before a credit
              </Link>
            </h3>
            <p className="mt-1.5 text-[12px] leading-snug text-ink-muted">
              Verdicts recorded as rejected, which no human has to look at again unless
              the collector re-uploads.
            </p>
            <p className="mt-3 flex items-center gap-2">
              <Badge tone="verified">Counted</Badge>
            </p>
            <Link
              href="/validation"
              className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
            >
              Open →
            </Link>
          </li>

          <li className="bg-paper-raised p-4">
            <div className="flex items-start justify-between gap-3">
              <Dot tone="hazard" />
              <span className="font-display text-2xl leading-none tracking-tight text-copper">
                {heat.configured ? openSites.length : "—"}
              </span>
            </div>
            <h3 className="mt-3 text-sm font-medium leading-snug">
              <Link href="/map" className="hover:text-copper">
                Hotspots with no van assigned
              </Link>
            </h3>
            <p className="mt-1.5 text-[12px] leading-snug text-ink-muted">
              {openSites.length
                ? `${openSites.slice(0, 2).map((site) => site.label).join(" and ")}${openSites.length > 2 ? ` and ${openSites.length - 2} more` : ""}.`
                : `No site has four geotagged intakes within ~150 m in the last ${heat.rule.windowDays} days.`}
            </p>
            <p className="mt-3 flex items-center gap-2">
              <Badge tone="verified">Counted</Badge>
            </p>
            <Link
              href="/map"
              className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
            >
              Open →
            </Link>
          </li>

          <li className="bg-paper-raised p-4">
            <div className="flex items-start justify-between gap-3">
              <Dot tone="copper" />
              <span className="font-display text-2xl leading-none tracking-tight text-copper">
                {board.configured ? openLoads.length : "—"}
              </span>
            </div>
            <h3 className="mt-3 text-sm font-medium leading-snug">
              <Link href="/pickups" className="hover:text-copper">
                Loads waiting at the gate
              </Link>
            </h3>
            <p className="mt-1.5 text-[12px] leading-snug text-ink-muted">
              {board.configured
                ? `${openLoads.length} of ${loads.length} loads have not settled. A load settles when the recycler types the collector's PIN at the gate.`
                : "The pickup service is not configured, so no load can be read."}
            </p>
            <p className="mt-3 flex items-center gap-2">
              <Badge tone={board.configured ? "verified" : "hazard"}>
                {board.configured ? "Counted" : "No service"}
              </Badge>
            </p>
            <Link
              href="/pickups"
              className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
            >
              Open →
            </Link>
          </li>
        </ul>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section>
          <SectionHeader
            eyebrow={configured ? "From the record" : "Unavailable"}
            title="Activity"
            note="Drawn from the rows themselves — a submission, a verdict and a decision each carry their own timestamp — rather than written beside them."
          />
          <Surface className="mt-4">
            {events.rows.length === 0 ? (
              <p className="p-4 text-sm leading-relaxed text-ink-soft">
                {configured
                  ? "Nothing has been recorded yet. A capture on the intake screen appears here as soon as the model has priced it and the row is written."
                  : "The feed needs a database. Without one there is no submission, verdict or decision to list."}
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH className="w-36">Time</TH>
                    <TH>Event</TH>
                    <TH>Kind</TH>
                    <TH className="hidden lg:table-cell">Actor</TH>
                  </TR>
                </THead>
                <TBody>
                  {events.rows.map((event) => (
                    <TR key={event.id}>
                      <TD mono className="text-[11px] text-ink-muted">
                        {formatTimestamp(event.at)}
                      </TD>
                      <TD>
                        <Link
                          href={event.href}
                          className="font-medium underline decoration-rule decoration-1 underline-offset-2 hover:decoration-copper"
                        >
                          {event.subject}
                        </Link>
                        <p className="mt-1 text-[12px] leading-snug text-ink-muted">
                          {event.detail}
                        </p>
                      </TD>
                      <TD>
                        <Badge tone={activityTone(event.kind)}>
                          {activityLabel(event.kind)}
                        </Badge>
                      </TD>
                      <TD className="hidden text-[12px] text-ink-soft lg:table-cell">
                        {event.actor}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Surface>
        </section>

        <aside className="flex flex-col gap-6">
          <section>
            <SectionHeader
              eyebrow={board.configured ? "From the pickup service" : "Unavailable"}
              title="Loads in play"
              note={`Every load the smart-pickup service has routed, read from its own table. ${notesIssued.length} note${
                notesIssued.length === 1 ? "" : "s"
              } issued so far, ${formatInr(notesInr)} settled. A load leaves this board when the gate settles it against the weighed mass.`}
            />
            <Surface className="mt-4">
              {loads.length === 0 ? (
                <p className="p-4 text-sm leading-relaxed text-ink-soft">
                  {board.configured
                    ? "No load has been routed yet. A route on the collector handoff screen appears here as soon as the service records it."
                    : "This board needs the pickup service. Without it there is no load to list."}
                </p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Pickup</TH>
                      <TH>Status</TH>
                      <TH numeric>Settled</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {loads.slice(0, 6).map((load) => (
                      <TR
                        key={load.pickupId}
                        className={load.hazardous ? "border-l-[5px] border-l-hazard" : undefined}
                      >
                        <TD mono>
                          <Link
                            href="/pickups"
                            className="underline decoration-rule underline-offset-2 hover:decoration-copper"
                          >
                            {load.pickupId}
                          </Link>
                          <p className="mt-1 text-[11px] text-ink-muted">
                            {load.streamLabel} · {load.facilityName}
                          </p>
                        </TD>
                        <TD>
                          <Badge tone={pickupTone(load.status)}>
                            {pickupLabel(load.status)}
                          </Badge>
                        </TD>
                        <TD numeric mono>
                          {load.creditNoteAmountPaise
                            ? formatInr(load.creditNoteAmountPaise / 100)
                            : "—"}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Surface>
          </section>

          <Panel
            eyebrow="District pressure · India"
            title="Where to send the next van"
            actions={
              <Link
                href="/map"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
              >
                Full map →
              </Link>
            }
          >
            <div className="flex flex-col">
              {pressureWards.length === 0 ? (
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  No geotagged intakes in the last {heat.rule.windowDays} days yet.
                </p>
              ) : null}
              {pressureWards.map((ward) => (
                <MeterRow
                  key={ward.code}
                  label={`${ward.name}${ward.state ? `, ${ward.state}` : ""} · ${ward.detections} detection${ward.detections === 1 ? "" : "s"}`}
                  value={ward.pressure / 100}
                  tone={ward.pressure >= 80 ? "hazard" : ward.pressure >= 60 ? "copper" : "lead"}
                  display={`${ward.pressure}/100`}
                />
              ))}
            </div>
            <p className="mt-3 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
              Counted from geotagged intakes across India. Pressure is detections per km²,
              relative to the busiest district. {openSites.length} site{openSites.length === 1 ? " is" : "s are"} open
              with no van assigned.
            </p>
          </Panel>

          <Panel
            eyebrow="From the load board · Collectors"
            title="Leading by settled credits"
            actions={
              <Link
                href="/collectors"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
              >
                All collectors →
              </Link>
            }
          >
            {topCollectors.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-ink-soft">
                No credit note has settled against a collector yet, so there is no standing
                to rank. A list drawn now would be an invented one.
              </p>
            ) : (
              <ul className="flex flex-col">
                {topCollectors.map((collector) => (
                  <li
                    key={collector.collectorId}
                    className="flex items-baseline justify-between gap-3 border-b border-rule-soft py-2 last:border-b-0"
                  >
                    <span>
                      <span className="text-sm font-medium">
                        {collector.collectorId}
                      </span>
                      <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                        {collector.notes} note{collector.notes === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="font-mono text-[13px] tabular-nums">
                      {formatInr(collector.settledInr)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
              Settled credits, counted from the loads the pickup service holds. A collector
              id is all the platform stores — no name and no standing — so this ranks the
              work rather than the worker.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
