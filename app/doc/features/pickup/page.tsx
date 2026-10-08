import Link from "next/link";
import { CreditNote } from "@/components/features/pickup/credit-note";
import { PickupTimeline } from "@/components/features/pickup/pickup-timeline";
import { RecyclerTable } from "@/components/features/pickup/recycler-table";
import { Badge } from "@/components/ui/badge";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { Field, FieldList } from "@/components/ui/field-list";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { getFeature } from "@/lib/data/features";
import { getItem } from "@/lib/data/inventory";
import {
  collectors,
  logisticsStats,
  pickups,
  recyclers,
} from "@/lib/data/operations";
import { formatInr, formatMass, formatPct } from "@/lib/format";
import { pickupLabel, pickupTone } from "@/lib/tone";
import type { Collector, EwasteItem, Recycler } from "@/lib/types";

function collectorOf(id: string): Collector {
  const found = collectors.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Unknown collector ${id}`);
  }
  return found;
}

function recyclerOf(id: string): Recycler {
  const found = recyclers.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Unknown recycler ${id}`);
  }
  return found;
}

function routeText(distanceKm: number, etaMinutes: number): string {
  return etaMinutes > 0
    ? `${distanceKm} km · ${etaMinutes} min`
    : `${distanceKm} km · closed`;
}

export default function PickupPage() {
  const feature = getFeature("pickup");

  const focusPickup = pickups.find((entry) => entry.id === "PU-8841") ?? pickups[0];
  const reusePickup = pickups.find((entry) => entry.id === "PU-8836") ?? pickups[0];
  const settledPickup =
    pickups.find((entry) => entry.status === "settled" && entry.settledInr > 0) ??
    pickups[0];

  const focusRecycler = recyclerOf(focusPickup.recyclerId);
  const focusItem: EwasteItem = getItem(focusPickup.itemId);
  const reuseItem: EwasteItem = getItem(reusePickup.itemId);
  const settledItem: EwasteItem = getItem(settledPickup.itemId);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        feature={feature}
        lede="Hazardous loads go to a licensed line, and the collector walks away holding a receipt for the exact weight that was paid."
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone="ink">Mumbai + Pune pilot</Badge>
            <Badge tone="hazard">
              {formatPct(logisticsStats.hazardousShare)} hazardous
            </Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {recyclers.length} authorised destinations on file
            </span>
          </div>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Open pickups"
          value={String(logisticsStats.openPickups)}
          unit="loads"
          note="Requested, assigned or moving right now across both cities."
        />
        <Stat
          label="Hazardous share"
          value={formatPct(logisticsStats.hazardousShare)}
          note={`Batteries, leaded glass and capacitor banks. ${logisticsStats.unlicensedDisposalsBlocked} unlicensed disposals blocked this month.`}
        />
        <Stat
          label="Median settlement"
          value={logisticsStats.medianSettleHours.toFixed(1)}
          unit="hours"
          note="From valuation accepted to credit note issued."
        />
        <Stat
          label="Credits issued"
          value={formatInr(logisticsStats.creditsIssuedInr)}
          emphasis
          note={`Across ${logisticsStats.notesIssued} credit notes. Simulated amounts.`}
        />
      </StatGrid>

      <section>
        <SectionHeader
          eyebrow="Live board"
          title="Shipments"
          note="Hazardous loads are marked in the left margin, because that flag is what restricts which recycler will accept the load."
        />
        <Surface className="mt-4">
          <Table>
            <THead>
              <TR>
                <TH>Pickup</TH>
                <TH>Collector</TH>
                <TH>Item</TH>
                <TH>Recycler</TH>
                <TH className="hidden lg:table-cell">Route</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Credit note</TH>
                <TH numeric>Settled</TH>
              </TR>
            </THead>
            <TBody>
              {pickups.map((pickup) => {
                const collector = collectorOf(pickup.collectorId);
                const recycler = recyclerOf(pickup.recyclerId);
                const item = getItem(pickup.itemId);

                return (
                  <TR
                    key={pickup.id}
                    className={
                      pickup.hazardous ? "border-l-4 border-l-hazard" : undefined
                    }
                  >
                    <TD mono>
                      <span className="font-medium">{pickup.id}</span>
                      {pickup.hazardous ? (
                        <p className="mt-1">
                          <Badge tone="hazard">Hazard</Badge>
                        </p>
                      ) : null}
                    </TD>
                    <TD>
                      <span className="font-medium">{collector.name}</span>
                      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                        {collector.city} · {collector.tier}
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
                        {item.id} · {formatMass(item.massGrams)}
                      </p>
                    </TD>
                    <TD>
                      <span className="font-medium">{recycler.name}</span>
                      <p className="mt-1 font-mono text-[11px] text-ink-muted">
                        {recycler.cpcbId}
                      </p>
                    </TD>
                    <TD className="hidden font-mono text-[12px] text-ink-muted lg:table-cell">
                      {routeText(pickup.distanceKm, pickup.etaMinutes)}
                    </TD>
                    <TD>
                      <Badge tone={pickupTone(pickup.status)}>
                        {pickupLabel(pickup.status)}
                      </Badge>
                    </TD>
                    <TD mono className="hidden text-[12px] md:table-cell">
                      {pickup.creditNote}
                    </TD>
                    <TD numeric mono>
                      {pickup.settledInr > 0 ? formatInr(pickup.settledInr) : "—"}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <p className="border-t border-rule px-3 py-3 text-[12px] leading-relaxed text-ink-muted">
            The board shows {pickups.length} fixtures of {logisticsStats.openPickups}{" "}
            open loads. A settled row means the credit note was issued against weight
            verified at the recycler gate; a withheld row means a rule blocked the
            payout.
          </p>
        </Surface>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-8">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionHeader
                eyebrow="Audit trail"
                title={`${focusPickup.id} in transit`}
                note="This is what makes the EPR claim checkable rather than asserted."
              />
              <Badge tone={pickupTone(focusPickup.status)}>
                {pickupLabel(focusPickup.status)}
              </Badge>
            </div>

            <Panel className="mt-4" bodyClassName="p-4">
              <FieldList columns={2} className="mb-5">
                <Field label="Collector" value={collectorOf(focusPickup.collectorId).name} />
                <Field
                  label="Destination"
                  value={focusRecycler.name}
                  tone="muted"
                />
                <Field
                  label="Pickup id"
                  value={focusPickup.id}
                  mono
                  tone="copper"
                />
                <Field label="Load" value={focusItem.label} />
              </FieldList>

              <PickupTimeline pickup={focusPickup} recyclerName={focusRecycler.name} />
            </Panel>
          </section>

          <section>
            <SectionHeader
              eyebrow="Rejected payout"
              title="Working device, so no scrap credit"
              note="The gatekeeper withheld money here, and the load still left the street."
            />
            <Panel className="mt-4" bodyClassName="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="hazard">Rule R-03</Badge>
                <Badge tone="lead">Rerouted to reuse</Badge>
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                  {reusePickup.id} · {reusePickup.creditNote}
                </span>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                {reuseItem.label} powered on and cleared the refurbishment screen, so
                the valuation of {formatInr(reuseItem.valuation.grossValue)} was never
                paid as scrap. The handset went to{" "}
                {recyclerOf(reusePickup.recyclerId).name}, where reuse revenue is
                shared instead of shredded material value.
              </p>

              <FieldList columns={2} className="mt-4">
                <Field label="Collector" value={collectorOf(reusePickup.collectorId).name} />
                <Field label="Destination" value={recyclerOf(reusePickup.recyclerId).name} tone="muted" />
                <Field label="Scrap credit" value={formatInr(0)} mono tone="hazard" />
                <Field
                  label="Reuse share"
                  value="Pending data wipe sign-off"
                  tone="muted"
                />
              </FieldList>

              <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">
                Shredding a working phone destroys more value than it recovers, and the
                rule costs the collector nothing in good faith — the load is accepted
                either way.
              </p>
            </Panel>
          </section>
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-16 lg:self-start">
          <div>
            <SectionHeader
              eyebrow="Payout"
              title="What the collector holds"
              note={`Settled example: ${settledPickup.id}, a clean non-hazardous load.`}
            />
            <CreditNote
              className="mt-4"
              collector={collectorOf(settledPickup.collectorId)}
              item={settledItem}
              recycler={recyclerOf(settledPickup.recyclerId)}
              reference={settledPickup.creditNote}
              amount={settledPickup.settledInr}
            />
          </div>

          <Panel eyebrow="Why it matters" title="Verifiable, not asserted">
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-ink-soft">
                A brand can only claim EPR compliance if it can show the unit reached a
                registered line. Each load carries a collector, a destination licence, a
                hazard declaration, a verified weight and a credit note reference — all
                of which the heat map reads back as geotagged evidence.
              </p>
              <ul className="flex flex-col gap-2">
                <li className="flex gap-2 text-[12px] leading-relaxed text-ink-soft">
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 bg-copper" />
                  <span>
                    Hazardous loads can only be assigned to a recycler licensed for that
                    stream.
                  </span>
                </li>
                <li className="flex gap-2 text-[12px] leading-relaxed text-ink-soft">
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 bg-copper" />
                  <span>
                    The scrap payout and the brand EPR note are separate instruments on
                    the same load.
                  </span>
                </li>
                <li className="flex gap-2 text-[12px] leading-relaxed text-ink-soft">
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 bg-copper" />
                  <span>
                    Every route and settle step is timestamped, so a load cannot quietly
                    change hands.
                  </span>
                </li>
              </ul>
            </div>
          </Panel>
        </aside>
      </div>

      <section>
        <SectionHeader
          eyebrow="Authorised destinations"
          title="Recyclers on file"
          note="Capacity and SLA decide whether a load can be promised today."
        />
        <RecyclerTable recyclers={recyclers} className="mt-4" />
      </section>

      <section>
        <Panel eyebrow="Next" title="Where this data goes next">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            Each pickup writes a geotagged record. Clustering those points is what turns
            this shipment board into ward-level pressure for a municipal officer — see
            the heat map, which is a supporting capability rather than part of the core
            loop. The gatekeeper log explains why a load was accepted or blocked before
            it ever reached this screen.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/map"
              className="border-2 border-ink px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink transition-colors hover:bg-ink hover:text-paper"
            >
              Open spatial heatmap
            </Link>
            <Link
              href="/validation"
              className="border-2 border-ink px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink transition-colors hover:bg-ink hover:text-paper"
            >
              Read the validation log
            </Link>
          </div>
        </Panel>
      </section>
    </div>
  );
}
