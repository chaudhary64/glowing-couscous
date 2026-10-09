import Link from "next/link";
import { LiveAnalysis } from "@/components/features/ai/live-analysis";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { Field, FieldList } from "@/components/ui/field-list";
import { MeterRow } from "@/components/ui/meter";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Receipt, type ReceiptLine } from "@/components/ui/receipt";
import { Stamp, VerdictMark } from "@/components/ui/stamp";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { focusItemId, getItem, items } from "@/lib/data/inventory";
import { formatInr, formatMass, formatRate, lineValue } from "@/lib/format";
import {
  conditionTone,
  materialLabel,
  materialTone,
  verdictLabel,
  verdictTone,
} from "@/lib/tone";

export const instant = false;

/**
 * Queue totals, derived from the fixture so they cannot drift from the rows.
 *
 * Only cleared items carry money: a rejected or held item keeps its assay for the
 * audit trail but promises nothing, so payable and EPR totals are summed over the
 * cleared set rather than over the whole queue.
 */
const grossTotal = items.reduce((sum, item) => sum + item.valuation.grossValue, 0);
const cleared = items.filter(
  (item) => item.gatekeeper.verdict === "verified",
);
const payableTotal = cleared.reduce(
  (sum, item) => sum + item.valuation.netToCollector,
  0,
);
const eprTotal = cleared.reduce((sum, item) => sum + item.valuation.eprCreditInr, 0);

export default async function ValuationsPage() {
  await requireAccess("/valuation");

  const openItem = getItem(focusItemId);

  const receiptLines: ReceiptLine[] = openItem.materials.map((line) => {
    const value = lineValue(line.massGrams, line.ratePerKg);
    return {
      label: `${line.name} (${line.symbol})`,
      detail:
        value > 0
          ? `${formatMass(line.massGrams)} @ ${formatRate(line.ratePerKg)}`
          : line.handling,
      value: value > 0 ? formatInr(value) : "—",
      muted: value === 0,
    };
  });

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Operations · Valuation"
        title="Valuations"
        lede={`Every item that has been assayed and priced. ${formatInr(payableTotal)} is payable to collectors and ${formatInr(eprTotal)} of brand EPR credit is created across the ${cleared.length} items the gatekeeper cleared; the rest keep their assay but promise nothing.`}
        actions={
          <>
            <ButtonLink href="/intake">New intake</ButtonLink>
            <ButtonLink href="/pickups" variant="secondary">
              Route the open item
            </ButtonLink>
          </>
        }
      />

      <LiveAnalysis mode="valuation" />

      <StatGrid columns={4}>
        <Stat
          label="Items priced"
          value={String(items.length)}
          unit="in the queue"
          note={`${cleared.length} cleared by the gatekeeper, ${items.length - cleared.length} blocked or held.`}
        />
        <Stat
          label="Gross material value"
          value={formatInr(grossTotal)}
          note="Sum of every assay line across the queue, at posted rates."
        />
        <Stat
          label="Net payable to collectors"
          value={formatInr(payableTotal)}
          emphasis
          note="Cleared items only, after handling and licensed-line fees. Rejected and held items are excluded."
        />
        <Stat
          label="Brand EPR credit"
          value={formatInr(eprTotal)}
          note="Cleared items only. A compliance asset for brands, never paid to the collector."
        />
      </StatGrid>

      <section>
        <SectionHeader
          eyebrow="Queue"
          title="Priced items"
          note="Ordered as the intake stream produced them. The open row is the one priced in the workspace below."
        />

        <Surface className="mt-4">
          <Table>
            <THead>
              <TR>
                <TH className="w-16">Open</TH>
                <TH>Item</TH>
                <TH>Condition</TH>
                <TH>Clearance</TH>
                <TH numeric>Mass</TH>
                <TH numeric>Net to collector</TH>
                <TH className="hidden lg:table-cell">EPR note</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((item) => {
                const isOpen = item.id === focusItemId;
                return (
                  <TR
                    key={item.id}
                    className={isOpen ? "bg-copper-tint/50" : undefined}
                  >
                    <TD>
                      {isOpen ? <Badge tone="copper">Open</Badge> : null}
                    </TD>
                    <TD>
                      <span className="font-medium">{item.label}</span>
                      <p className="mt-1 font-mono text-[11px] text-ink-muted">
                        {item.id} · {item.category} · {item.brand}
                      </p>
                    </TD>
                    <TD>
                      <Badge tone={conditionTone(item.condition)}>
                        {item.condition}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge tone={verdictTone(item.gatekeeper.verdict)}>
                        {verdictLabel(item.gatekeeper.verdict)}
                      </Badge>
                    </TD>
                    <TD numeric mono>
                      {formatMass(item.massGrams)}
                    </TD>
                    <TD numeric mono>
                      {item.gatekeeper.verdict === "verified"
                        ? formatInr(item.valuation.netToCollector)
                        : "—"}
                    </TD>
                    <TD mono className="hidden text-[12px] lg:table-cell">
                      {item.valuation.eprCreditNote}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <p className="border-t border-rule px-3 py-3 text-[12px] leading-relaxed text-ink-muted">
            A rejected item stays in the queue for the audit trail but shows no
            payable figure, because no credit was minted for it. Held items show a
            dash until a human decides them in the{" "}
            <Link
              href="/validation"
              className="underline decoration-rule underline-offset-2 hover:decoration-copper"
            >
              validation queue
            </Link>
            .
          </p>
        </Surface>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-8">
          <section>
            <SectionHeader
              eyebrow={`Open item · ${openItem.id}`}
              title={openItem.label}
              note="Priced from a single upload: the assay sets the money, and the gatekeeper decides whether any of it is promised."
            />
            <Surface className="mt-4 p-4">
              <FieldList columns={3}>
                <Field label="Category" value={openItem.category} />
                <Field label="Brand read" value={openItem.brand} mono />
                <Field label="Condition" value={openItem.condition} tone="muted" />
                <Field label="Mass" value={formatMass(openItem.massGrams)} mono />
                <Field label="Pickup city" value={openItem.city} />
                <Field
                  label="Rate basis"
                  value={openItem.valuation.rateBasis}
                  tone="muted"
                />
              </FieldList>

              <div className="mt-5 border-t border-rule pt-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                  Hazards the recycler must be told about
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {openItem.hazards.map((hazard) => (
                    <li key={hazard}>
                      <Badge tone="hazard">{hazard}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </Surface>
          </section>

          <section>
            <SectionHeader
              eyebrow="Assay"
              title="Metal breakdown"
              note="Hazardous and inert lines are worth nothing because they carry a disposal cost, not a payout."
            />
            <Surface className="mt-4">
              <Table>
                <THead>
                  <TR>
                    <TH>Material</TH>
                    <TH>Class</TH>
                    <TH numeric>Mass</TH>
                    <TH numeric>Rate</TH>
                    <TH numeric>Value</TH>
                  </TR>
                </THead>
                <TBody>
                  {openItem.materials.map((line) => {
                    const value = lineValue(line.massGrams, line.ratePerKg);
                    return (
                      <TR key={line.id} muted={value === 0}>
                        <TD>
                          <span className="font-medium">{line.name}</span>
                          <span className="ml-2 font-mono text-[11px] text-ink-muted">
                            {line.symbol}
                          </span>
                          <p className="mt-1 text-[11px] leading-snug text-ink-muted">
                            {line.handling}
                          </p>
                        </TD>
                        <TD>
                          <Badge tone={materialTone(line.category)}>
                            {materialLabel(line.category)}
                          </Badge>
                        </TD>
                        <TD numeric mono>
                          {formatMass(line.massGrams)}
                        </TD>
                        <TD numeric mono>
                          {line.ratePerKg > 0 ? formatRate(line.ratePerKg) : "—"}
                        </TD>
                        <TD numeric mono>
                          {value > 0 ? formatInr(value) : "—"}
                        </TD>
                      </TR>
                    );
                  })}
                  <TR className="border-t-2 border-ink bg-paper">
                    <TD className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                      Gross
                    </TD>
                    <TD />
                    <TD numeric mono>
                      {formatMass(openItem.massGrams)}
                    </TD>
                    <TD />
                    <TD numeric mono className="font-semibold">
                      {formatInr(openItem.valuation.grossValue)}
                    </TD>
                  </TR>
                </TBody>
              </Table>
            </Surface>
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionHeader
                eyebrow="Clearance"
                title="Gatekeeper decision"
                note="No credit is promised to the collector unless this reads Verified."
              />
              <VerdictMark verdict={openItem.gatekeeper.verdict} />
            </div>

            <Panel className="mt-4">
              <p className="text-sm leading-relaxed text-ink-soft">
                {openItem.gatekeeper.reason}
              </p>

              <div className="mt-4 border-t border-rule pt-3">
                <MeterRow
                  label="Model confidence"
                  value={openItem.gatekeeper.confidence}
                  display={`${Math.round(openItem.gatekeeper.confidence * 100)}% on ${openItem.gatekeeper.matchedClass}`}
                  tone={verdictTone(openItem.gatekeeper.verdict)}
                />
              </div>

              <FieldList columns={2} className="mt-4">
                {openItem.gatekeeper.signals.map((signal) => (
                  <Field
                    key={signal.label}
                    label={signal.label}
                    value={signal.value}
                    mono
                  />
                ))}
              </FieldList>

              <p className="mt-5 border-t border-rule pt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                {openItem.gatekeeper.modelVersion} · checked{" "}
                {openItem.gatekeeper.checkedAt} ·{" "}
                <Link
                  href="/validation"
                  className="underline decoration-rule underline-offset-2 hover:decoration-copper"
                >
                  Full validation log
                </Link>
              </p>
            </Panel>
          </section>
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-16 lg:self-start">
          <Receipt
            title="Scrap rate receipt"
            reference={openItem.id}
            issuedAt="Issued 09 Oct 2026, 14:25 IST"
            lines={receiptLines}
            adjustments={[
              {
                label: "Handling & licensed line fee",
                value: `−${formatInr(openItem.valuation.handlingFee)}`,
              },
            ]}
            total={{
              label: "Net to collector",
              value: formatInr(openItem.valuation.netToCollector),
              sub: `Valid until ${openItem.valuation.validUntil}`,
            }}
            note={`${openItem.valuation.rateBasis}. Simulated credits — this prototype issues no real payout.`}
            stamp={<Stamp verdict={openItem.gatekeeper.verdict} />}
          />

          <Panel eyebrow="Compliance" title="Brand EPR credit">
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-ink-soft">
                Diverting this unit formally creates a brand liability offset against
                the CPCB EPR mandate. It is a compliance asset, not a payment to the
                collector — the two instruments ride on the same load but go to
                different parties.
              </p>
              <FieldList columns={1}>
                <Field
                  label="Credit value"
                  value={formatInr(openItem.valuation.eprCreditInr)}
                  mono
                  tone="copper"
                />
                <Field
                  label="Credit note"
                  value={openItem.valuation.eprCreditNote}
                  mono
                />
                <Field
                  label="Basis"
                  value="CPCB category sheet, brand plate read from the upload"
                />
              </FieldList>
              <p className="flex items-center gap-2">
                <Badge tone={verdictTone(openItem.gatekeeper.verdict)}>
                  {verdictLabel(openItem.gatekeeper.verdict)}
                </Badge>
                <span className="text-[12px] text-ink-muted">
                  Credit is withheld unless this reads Verified.
                </span>
              </p>
            </div>
          </Panel>

          <Panel eyebrow="Next step" title="Route the item">
            <p className="text-sm leading-relaxed text-ink-soft">
              {openItem.hazards.length > 0
                ? "Hazard declared, so this can only go to a recycler licensed for that stream."
                : "No hazard declared, so this can take the standard board line."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink href="/pickups">Open pickups</ButtonLink>
              <ButtonLink href="/recyclers" variant="secondary">
                Destinations
              </ButtonLink>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
