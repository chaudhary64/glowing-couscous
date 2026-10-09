import Link from "next/link";
import { Badge, Dot } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { MeterRow } from "@/components/ui/meter";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { activityFeed, activityMeta, needsAttention } from "@/lib/data/activity";
import { intakeStats } from "@/lib/data/intake";
import { collectors, logisticsStats, pickups } from "@/lib/data/operations";
import { hotspots, wards } from "@/lib/data/wards";
import { formatInr, formatPct } from "@/lib/format";
import { activityLabel, activityTone, pickupLabel, pickupTone } from "@/lib/tone";

export const instant = false;

const topCollectors = [...collectors]
  .sort((a, b) => b.creditsInr - a.creditsInr)
  .slice(0, 4);

const pressureWards = [...wards].sort((a, b) => b.density - a.density).slice(0, 4);

/** Loads an operator can still act on today. */
const activePickups = pickups.filter(
  (pickup) => pickup.status !== "settled" && pickup.status !== "received",
);

export default async function DashboardPage() {
  await requireAccess("/");

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Operations · Mumbai + Pune pilot"
        title="Today"
        lede={`${intakeStats.today} intakes priced, ${formatInr(logisticsStats.creditsIssuedInr)} of simulated credits on ${logisticsStats.notesIssued} notes, and 2 hotspots still waiting for a van.`}
        actions={
          <>
            <ButtonLink href="/intake">New intake</ButtonLink>
            <ButtonLink href="/validation" variant="secondary">
              Clear validation queue
            </ButtonLink>
          </>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Intakes today"
          value={String(intakeStats.today)}
          unit="items"
          note={`${formatPct(intakeStats.voiceShare)} arrived as a Hindi voice note.`}
        />
        <Stat
          label="Credits issued"
          value={formatInr(logisticsStats.creditsIssuedInr)}
          emphasis
          note={`${logisticsStats.notesIssued} notes, median ${logisticsStats.medianSettleHours}h to settle.`}
        />
        <Stat
          label="Open pickups"
          value={String(logisticsStats.openPickups)}
          unit="loads"
          note={`${logisticsStats.unlicensedDisposalsBlocked} unlicensed disposals blocked this month.`}
        />
        <Stat
          label="Hazardous share"
          value={formatPct(logisticsStats.hazardousShare)}
          note="Batteries, leaded glass and capacitor banks on a licensed route."
        />
      </StatGrid>

      <section>
        <SectionHeader
          eyebrow="Work queue"
          title="Needs attention"
          note="Ordered the way an operator would work it: judgement calls first, then routing, then paperwork."
        />

        <ul className="mt-5 grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {needsAttention.map((item) => (
            <li key={item.id} className="bg-paper-raised p-4">
              <div className="flex items-start justify-between gap-3">
                <Dot tone={item.tone} />
                <span className="font-display text-2xl leading-none tracking-tight text-copper">
                  {item.count}
                </span>
              </div>
              <h3 className="mt-3 text-sm font-medium leading-snug">
                <Link href={item.href} className="hover:text-copper">
                  {item.label}
                </Link>
              </h3>
              <p className="mt-1.5 text-[12px] leading-snug text-ink-muted">
                {item.detail}
              </p>
              <Link
                href={item.href}
                className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
              >
                Open →
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section>
          <SectionHeader
            eyebrow={activityMeta.window}
            title="Activity"
            note={activityMeta.capturedBy}
          />
          <Surface className="mt-4">
            <Table>
              <THead>
                <TR>
                  <TH className="w-14">Time</TH>
                  <TH>Event</TH>
                  <TH>Kind</TH>
                  <TH className="hidden lg:table-cell">Actor</TH>
                </TR>
              </THead>
              <TBody>
                {activityFeed.map((event) => (
                  <TR key={event.id}>
                    <TD mono className="text-ink-muted">
                      {event.at}
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
          </Surface>
        </section>

        <aside className="flex flex-col gap-6">
          <section>
            <SectionHeader
              eyebrow="Moving now"
              title="Loads in play"
              note="Hazardous loads are marked, because that flag restricts the destination."
            />
            <Surface className="mt-4">
              <Table>
                <THead>
                  <TR>
                    <TH>Pickup</TH>
                    <TH>Status</TH>
                    <TH numeric>Settled</TH>
                  </TR>
                </THead>
                <TBody>
                  {activePickups.map((pickup) => (
                    <TR
                      key={pickup.id}
                      className={pickup.hazardous ? "border-l-4 border-l-hazard" : undefined}
                    >
                      <TD mono>
                        <Link
                          href="/pickups"
                          className="underline decoration-rule underline-offset-2 hover:decoration-copper"
                        >
                          {pickup.id}
                        </Link>
                        <p className="mt-1 text-[11px] text-ink-muted">
                          {pickup.distanceKm} km · {pickup.etaMinutes} min
                        </p>
                      </TD>
                      <TD>
                        <Badge tone={pickupTone(pickup.status)}>
                          {pickupLabel(pickup.status)}
                        </Badge>
                      </TD>
                      <TD numeric mono>
                        {pickup.settledInr > 0 ? formatInr(pickup.settledInr) : "—"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Surface>
          </section>

          <Panel
            eyebrow="Ward pressure"
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
              {pressureWards.map((ward) => (
                <MeterRow
                  key={ward.id}
                  label={`${ward.name} · ${ward.flaggedSites} flagged`}
                  value={ward.density / 100}
                  tone={
                    ward.density >= 80 ? "hazard" : ward.density >= 60 ? "copper" : "lead"
                  }
                  display={`${ward.density}/100`}
                />
              ))}
            </div>
            <p className="mt-3 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
              {hotspots.filter((spot) => spot.status === "open").length} clusters are
              open with no van assigned.
            </p>
          </Panel>

          <Panel
            eyebrow="Collectors"
            title="Leading by credits"
            actions={
              <Link
                href="/collectors"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
              >
                All collectors →
              </Link>
            }
          >
            <ul className="flex flex-col">
              {topCollectors.map((collector) => (
                <li
                  key={collector.id}
                  className="flex items-baseline justify-between gap-3 border-b border-rule-soft py-2 last:border-b-0"
                >
                  <span>
                    <span className="text-sm font-medium">{collector.name}</span>
                    <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                      {collector.tier}
                    </span>
                  </span>
                  <span className="font-mono text-[13px] tabular-nums">
                    {formatInr(collector.creditsInr)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
