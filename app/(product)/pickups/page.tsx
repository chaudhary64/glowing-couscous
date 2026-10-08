import Link from "next/link";
import { CreditNote } from "@/components/features/pickup/credit-note";
import { PickupTimeline } from "@/components/features/pickup/pickup-timeline";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { Field, FieldList } from "@/components/ui/field-list";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
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

/** The load the board is focused on: the one currently moving. */
const focusPickup = pickups.find((entry) => entry.id === "PU-8841") ?? pickups[0];
/** A settled load, so the operator can see the document that was issued. */
const settledPickup =
  pickups.find((entry) => entry.status === "settled" && entry.settledInr > 0) ??
  pickups[0];
/** The only load where money was withheld. */
const withheldPickup =
  pickups.find((entry) => entry.id === "PU-8836") ?? pickups[0];

const focusRecycler = recyclerOf(focusPickup.recyclerId);
const focusItem: EwasteItem = getItem(focusPickup.itemId);
const settledItem: EwasteItem = getItem(settledPickup.itemId);
const withheldItem: EwasteItem = getItem(withheldPickup.itemId);

/** Loads already placed with each destination, so the link has something to say. */
const loadsByRecycler = recyclers.map((recycler) => ({
  recycler,
  loads: pickups.filter((pickup) => pickup.recyclerId === recycler.id).length,
}));

export default function PickupsPage() {
  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Operations · Pickups"
        title="Pickups"
        lede="Route every load to a licensed line, then settle the note against the weight the recycler actually took. Hazardous loads can only go to a destination authorised for that stream."
        actions={
          <>
            <ButtonLink href="/recyclers" variant="secondary">
              Destinations
            </ButtonLink>
            <ButtonLink href="/map" variant="secondary">
              Hotspot map
            </ButtonLink>
          </>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Open loads"
          value={String(logisticsStats.openPickups)}
          unit="loads"
          note="Requested, assigned or moving across both cities."
        />
        <Stat
          label="Hazardous share"
          value={formatPct(logisticsStats.hazardousShare)}
          note={`${logisticsStats.unlicensedDisposalsBlocked} unlicensed disposals blocked this month.`}
        />
        <Stat
          label="Median to settle"
          value={logisticsStats.medianSettleHours.toFixed(1)}
          unit="hours"
          note="From valuation accepted to credit note issued."
        />
        <Stat
          label="Credits issued"
          value={formatInr(logisticsStats.creditsIssuedInr)}
          emphasis
          note={`Across ${logisticsStats.notesIssued} notes. Simulated amounts.`}
        />
      </StatGrid>

      <section>
        <SectionHeader
          eyebrow="Live board"
          title="All loads"
          note="Hazardous loads carry a mark in the left margin, because that flag is what restricts the destination."
        />

        <Surface className="mt-4">
          <Table>
            <THead>
              <TR>
                <TH>Pickup</TH>
                <TH>Collector</TH>
                <TH>Item</TH>
                <TH>Destination</TH>
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
                      <Link
                        href="/recyclers"
                        className="font-medium underline decoration-rule decoration-1 underline-offset-2 hover:decoration-copper"
                      >
                        {recycler.name}
                      </Link>
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
            Showing {pickups.length} loads of {logisticsStats.openPickups} open on the
            board. A settled row means the note was issued against weight verified at
            the recycler gate; a withheld row means a rule blocked the payout before it
            left the doorstep.
          </p>
        </Surface>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionHeader
              eyebrow="Audit trail"
              title={`${focusPickup.id} in transit`}
              note="Gate weighing sets the payable mass, which is what makes the chain from doorstep to licensed line checkable."
            />
            <Badge tone={pickupTone(focusPickup.status)}>
              {pickupLabel(focusPickup.status)}
            </Badge>
          </div>

          <Panel className="mt-4" bodyClassName="p-4">
            <FieldList columns={2} className="mb-5">
              <Field label="Collector" value={collectorOf(focusPickup.collectorId).name} />
              <Field label="Destination" value={focusRecycler.name} tone="muted" />
              <Field label="Load" value={focusItem.label} />
              <Field
                label="Declared mass"
                value={`${formatMass(focusItem.massGrams)} · ${focusItem.hazards.length} hazard note${focusItem.hazards.length === 1 ? "" : "s"}`}
                mono
              />
              <Field label="Pickup id" value={focusPickup.id} mono tone="copper" />
              <Field
                label="Credit note"
                value={focusPickup.creditNote}
                mono
                tone="muted"
              />
            </FieldList>

            <PickupTimeline pickup={focusPickup} recyclerName={focusRecycler.name} />
          </Panel>
        </section>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-16 lg:self-start">
          <div>
            <SectionHeader
              eyebrow="Payout document"
              title="What the collector holds"
              note={`Settled example ${settledPickup.id}: a clean, non-hazardous load.`}
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

          <Panel
            eyebrow="Withheld payout"
            title="Working device, no scrap credit"
            actions={<Badge tone="hazard">Rule R-03</Badge>}
          >
            <p className="text-sm leading-relaxed text-ink-soft">
              {withheldItem.label} powered on and cleared the refurbishment screen, so
              its gross value of {formatInr(withheldItem.valuation.grossValue)} was
              never paid as scrap. The load still left the street — it went to the
              reuse partner instead of the shredding stream.
            </p>

            <FieldList columns={2} className="mt-4">
              <Field
                label="Collector"
                value={collectorOf(withheldPickup.collectorId).name}
              />
              <Field
                label="Destination"
                value={recyclerOf(withheldPickup.recyclerId).name}
                tone="muted"
              />
              <Field label="Scrap credit" value={formatInr(0)} mono tone="hazard" />
              <Field label="Reuse share" value="Pending data-wipe sign-off" tone="muted" />
            </FieldList>

            <p className="mt-4 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
              The note reference reads {withheldPickup.creditNote}, so the refusal is
              visible in the ledger rather than silently dropped.
            </p>
          </Panel>

          <Panel
            eyebrow="Destinations"
            title="Loads by recycler"
            actions={
              <Link
                href="/recyclers"
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
              >
                All destinations →
              </Link>
            }
          >
            <ul className="flex flex-col">
              {loadsByRecycler.map(({ recycler, loads }) => (
                <li
                  key={recycler.id}
                  className="flex items-baseline justify-between gap-3 border-b border-rule-soft py-2 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="text-sm font-medium">{recycler.name}</span>
                    <span className="mt-0.5 block font-mono text-[11px] text-ink-muted">
                      {recycler.cpcbId}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[13px] tabular-nums">
                    {loads} load{loads === 1 ? "" : "s"}
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
