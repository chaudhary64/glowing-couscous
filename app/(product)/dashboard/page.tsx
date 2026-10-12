import Link from "next/link";
import { Badge, Dot } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { MeterRow } from "@/components/ui/meter";
import { mayOpen, RoleLink } from "@/components/ui/role-link";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
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
 * The load board and the collector ranking are counted too, from the smart-pickup service
 * the handoff screens route through (`lib/pickup/directory.ts`) — so nothing on this screen
 * is authored.
 *
 * Ward pressure and open hotspots are counted as well: they come from the same
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
    listLoads(50),
    listCollectorActivity(25),
  ]);
  // Only collectors with something settled are ranked: a bar at zero is not a standing.
  const topCollectors = activity.rows.filter((row) => row.settledInr > 0).slice(0, 4);
  const loads = board.rows;
  const openLoads = loads.filter((load) => load.status !== "settled");
  const notesIssued = loads.filter((load) => Boolean(load.creditNoteId));
  const notesInr =
    loads.reduce((total, load) => total + Number(load.creditNoteAmountPaise ?? 0), 0) / 100;
  const openSites = heat.clusters.filter((c) => c.status === "open");
  // Across India, by district: the busiest four, each with its state. Pressure is relative
  // to the busiest district, so a single detection would score 100/100; a district is
  // ranked only once it has as many detections as a hotspot needs.
  const rankable = heat.districts.filter((district) => district.detections >= heat.rule.minDetections);
  const pressureWards = rankable.slice(0, 4);
  const tooFew = heat.districts.length - rankable.length;
  const counts = snapshot.counts;
  const configured = snapshot.configured;
  const role = user.role;

  /*
    One dashboard, cut to the role reading it. A card, button or link whose screen this
    role cannot open is left out (or kept as plain text where the words still inform),
    so nobody is sent to /no-access from their own home screen. The counts above stay:
    they are information, not a door.
  */
  const attention = [
    {
      href: "/validation",
      dot: "review",
      value: counts ? counts.awaitingDecision : "—",
      title: "Items awaiting a human decision",
      note: counts
        ? `${counts.awaitingDecision} held item${counts.awaitingDecision === 1 ? "" : "s"} still need a decision.`
        : "No validation count is available.",
      counted: true,
    },
    {
      href: "/validation",
      dot: "hazard",
      value: counts ? counts.rejected : "—",
      title: "Uploads refused before a credit",
      note: "Rejected before any credit was issued.",
      counted: true,
    },
    {
      href: "/map",
      dot: "hazard",
      value: heat.configured ? openSites.length : "—",
      title: "Hotspots with no van assigned",
      note: openSites.length
        ? `${openSites.slice(0, 2).map((site) => site.label).join(" and ")}${openSites.length > 2 ? ` and ${openSites.length - 2} more` : ""}.`
        : "No hotspot has enough recent reports to appear here.",
      counted: true,
    },
    {
      href: "/pickups",
      dot: "copper",
      value: board.configured ? openLoads.length : "—",
      title: "Loads waiting at the gate",
      note: board.configured
        ? `${openLoads.length} of ${loads.length} loads still need settlement.`
        : "Pickup data is unavailable.",
      counted: board.configured,
    },
  ] as const;
  const cards = attention.filter((card) => mayOpen(role, card.href));
  const cardGrid = ["", "", "sm:grid-cols-2", "sm:grid-cols-3", "sm:grid-cols-2 lg:grid-cols-4"][cards.length];

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Operations"
        title="Today"
        lede={
          counts
            ? `${counts.intakesToday} intakes today, ${counts.itemsPriced} items priced, and ${counts.awaitingDecision} waiting on a human decision.`
            : "No records are available, so dashboard counts are unavailable."
        }
        actions={
          mayOpen(role, "/intake") || mayOpen(role, "/validation") ? (
            <>
              {mayOpen(role, "/intake") ? <ButtonLink href="/intake">New intake</ButtonLink> : null}
              {mayOpen(role, "/validation") ? (
                <ButtonLink href="/validation" variant="secondary">
                  Clear validation queue
                </ButtonLink>
              ) : null}
            </>
          ) : undefined
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={configured ? "verified" : "hazard"}>
              {configured ? "Records connected" : "Records unavailable"}
            </Badge>
            {counts ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                {counts.intakesTotal} submissions · {counts.itemsPriced} priced ·{" "}
                {counts.hazardousItems} flagged for hazards
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
            unit="items"
            note={`${counts.verified} cleared · ${counts.held} held · ${counts.rejected} refused.`}
          />
          <Stat
            label="Awaiting a decision"
            value={String(counts.awaitingDecision)}
            unit="items"
            emphasis
            note={`${counts.decidedToday} decided today. Held items wait for review.`}
          />
          <Stat
            label="Net promised to collectors"
            value={formatInr(counts.netPayableInr)}
            note={`${formatInr(counts.eprCreditInr)} in simulated brand credit. No payment is made here.`}
          />
        </StatGrid>
      ) : (
        <Surface tone="inset" className="p-4">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            No records are available yet, so the dashboard cannot show counts.
          </p>
        </Surface>
      )}

      {cards.length > 0 ? (
        <section>
          <SectionHeader
            eyebrow="Work queue"
            title="Needs attention"
          note="Items, hotspots and loads that need attention."
          />

          <ul className={`mt-5 grid gap-px border border-rule bg-rule ${cardGrid}`}>
            {cards.map((card) => (
              <li key={card.title} className="bg-paper-raised p-4">
                <div className="flex items-start justify-between gap-3">
                  <Dot tone={card.dot} />
                  <span className="font-display text-2xl leading-none tracking-tight text-copper">
                    {card.value}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-medium leading-snug">
                  <Link href={card.href} className="hover:text-copper">
                    {card.title}
                  </Link>
                </h3>
                <p className="mt-1.5 text-[12px] leading-snug text-ink-muted">{card.note}</p>
                <p className="mt-3 flex items-center gap-2">
                  <Badge tone={card.counted ? "verified" : "hazard"}>
                    {card.counted ? "Available" : "Unavailable"}
                  </Badge>
                </p>
                <Link
                  href={card.href}
                  className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
                >
                  Open →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section>
          <SectionHeader
            eyebrow={configured ? "Recent activity" : "Unavailable"}
            title="Activity"
            note="Recent submissions, verdicts and decisions."
          />
          <Surface className="mt-4">
            {events.rows.length === 0 ? (
              <p className="p-4 text-sm leading-relaxed text-ink-soft">
                {configured
                  ? "No activity yet."
                  : "Activity is unavailable right now."}
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
                        <RoleLink
                          role={role}
                          href={event.href}
                          className="font-medium underline decoration-rule decoration-1 underline-offset-2 hover:decoration-copper"
                          plainClassName="font-medium"
                        >
                          {event.subject}
                        </RoleLink>
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
              eyebrow={board.configured ? "Pickup status" : "Unavailable"}
              title="Loads in play"
              note={`${notesIssued.length} note${
                notesIssued.length === 1 ? "" : "s"
              } issued · ${formatInr(notesInr)} settled.`}
            />
            <Surface className="mt-4">
              {loads.length === 0 ? (
                <p className="p-4 text-sm leading-relaxed text-ink-soft">
                  {board.configured
                    ? "No loads have been routed yet."
                    : "Pickup status is unavailable right now."}
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
                          <RoleLink
                            role={role}
                            href="/pickups"
                            className="underline decoration-rule underline-offset-2 hover:decoration-copper"
                          >
                            {load.pickupId}
                          </RoleLink>
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
            eyebrow="Hotspots"
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
                  {tooFew > 0
                    ? "Not enough reports to rank a district yet."
                    : "No hotspot reports yet."}
                </p>
              ) : null}
              {pressureWards.map((ward) => (
                <MeterRow
                  key={ward.code}
                  label={`${ward.name}${ward.state ? `, ${ward.state}` : ""} · ${ward.detections} report${ward.detections === 1 ? "" : "s"}`}
                  value={ward.pressure / 100}
                  tone={ward.pressure >= 80 ? "hazard" : ward.pressure >= 60 ? "copper" : "lead"}
                  display={`${ward.pressure}/100`}
                />
              ))}
            </div>
            <p className="mt-3 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
              {openSites.length} site{openSites.length === 1 ? " is" : "s are"} open with no van assigned.
            </p>
          </Panel>

          <Panel
            eyebrow="Collector ranking"
            title="Top collectors"
            actions={
              <RoleLink
                role={role}
                href="/collectors"
                hide
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
              >
                All collectors →
              </RoleLink>
            }
          >
            {topCollectors.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-ink-soft">
                No settled credits yet. Collector rankings will appear here after the first settlement.
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
              Ranked by settled credits. IDs are shown instead of names.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
