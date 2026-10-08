import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { Field, FieldList } from "@/components/ui/field-list";
import { MeterRow } from "@/components/ui/meter";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Receipt, type ReceiptLine } from "@/components/ui/receipt";
import { Stamp, VerdictMark } from "@/components/ui/stamp";
import { Stat, StatGrid } from "@/components/ui/stat";
import { getFeature } from "@/lib/data/features";
import { focusItemId, getItem } from "@/lib/data/inventory";
import {
  formatInr,
  formatMass,
  formatRate,
  lineValue,
} from "@/lib/format";
import {
  conditionTone,
  materialLabel,
  materialTone,
  verdictLabel,
  verdictTone,
} from "@/lib/tone";

export default function ValuationPage() {
  const feature = getFeature("valuation");
  const item = getItem(focusItemId);

  const receiptLines: ReceiptLine[] = item.materials.map((line) => {
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
      <PageHeader
        feature={feature}
        lede="Assay the metals, price the scrap, and mint the brand's EPR credit — in one pass, from a single upload."
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone="ink">{item.id}</Badge>
            <Badge tone={conditionTone(item.condition)}>{item.condition}</Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {item.valuation.rateBasis}
            </span>
          </div>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Gross material value"
          value={formatInr(item.valuation.grossValue)}
          note="Sum of the assay lines below, at posted rates."
        />
        <Stat
          label="Handling deducted"
          value={`−${formatInr(item.valuation.handlingFee)}`}
          note="Hazard containment and licensed line costs."
        />
        <Stat
          label="Net to collector"
          value={formatInr(item.valuation.netToCollector)}
          emphasis
          note="Paid on verified weight at the recycler gate."
        />
        <Stat
          label="Brand EPR credit"
          value={formatInr(item.valuation.eprCreditInr)}
          note="Liability offset for the brand, not paid to the collector."
        />
      </StatGrid>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-8">
          <section>
            <SectionHeader
              eyebrow="Item record"
              title="What was identified"
              note="Read off the upload, not typed by the collector."
            />
            <Surface className="mt-4 p-4">
              <FieldList columns={3}>
                <Field label="Item" value={item.label} />
                <Field label="Category" value={item.category} />
                <Field label="Brand" value={item.brand} mono />
                <Field label="Condition" value={item.condition} tone="muted" />
                <Field label="Mass" value={formatMass(item.massGrams)} mono />
                <Field label="Pickup city" value={item.city} />
              </FieldList>

              <div className="mt-5 border-t border-rule pt-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                  Hazards the recycler must be told about
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {item.hazards.map((hazard) => (
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
              note="Every figure in the receipt is derived from this table, so the two can never disagree."
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
                  {item.materials.map((line) => {
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
                      {formatMass(item.massGrams)}
                    </TD>
                    <TD />
                    <TD numeric mono className="font-semibold">
                      {formatInr(item.valuation.grossValue)}
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
                title="Gatekeeper verdict"
                note="Nothing is promised to the collector until this boolean is true."
              />
              <VerdictMark verdict={item.gatekeeper.verdict} />
            </div>

            <Panel className="mt-4" bodyClassName="p-4">
              <p className="text-sm leading-relaxed text-ink-soft">
                {item.gatekeeper.reason}
              </p>

              <div className="mt-4 border-t border-rule pt-3">
                <MeterRow
                  label="Model confidence"
                  value={item.gatekeeper.confidence}
                  display={`${Math.round(item.gatekeeper.confidence * 100)}% on ${item.gatekeeper.matchedClass}`}
                  tone={verdictTone(item.gatekeeper.verdict)}
                />
              </div>

              <FieldList columns={2} className="mt-4">
                {item.gatekeeper.signals.map((signal) => (
                  <Field
                    key={signal.label}
                    label={signal.label}
                    value={signal.value}
                    mono
                  />
                ))}
              </FieldList>

              <p className="mt-5 border-t border-rule pt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                {item.gatekeeper.modelVersion} · checked {item.gatekeeper.checkedAt} ·{" "}
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
            reference={item.id}
            issuedAt={`Issued 09 Oct 2026, 14:25 IST`}
            lines={receiptLines}
            adjustments={[
              {
                label: "Handling & licensed line fee",
                value: `−${formatInr(item.valuation.handlingFee)}`,
              },
            ]}
            total={{
              label: "Net to collector",
              value: formatInr(item.valuation.netToCollector),
              sub: `Valid until ${item.valuation.validUntil}`,
            }}
            note="Figures are fixed fixtures for this prototype. Rates follow the published IMD benchmark for the Mumbai zone."
            stamp={<Stamp verdict={item.gatekeeper.verdict} />}
          />

          <Panel eyebrow="Compliance" title="Brand EPR credit">
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-ink-soft">
                Diverting this unit formally creates a brand liability offset against
                the CPCB EPR mandate. It is a compliance asset, not a payment to the
                collector.
              </p>
              <FieldList columns={1}>
                <Field
                  label="Credit value"
                  value={formatInr(item.valuation.eprCreditInr)}
                  mono
                  tone="copper"
                />
                <Field
                  label="Credit note"
                  value={item.valuation.eprCreditNote}
                  mono
                />
                <Field
                  label="Basis"
                  value="CPCB category sheet, brand plate read from the upload"
                />
              </FieldList>
              <p className="flex items-center gap-2">
                <Badge tone={verdictTone(item.gatekeeper.verdict)}>
                  {verdictLabel(item.gatekeeper.verdict)}
                </Badge>
                <span className="text-[12px] text-ink-muted">
                  Credit is withheld unless this reads Verified.
                </span>
              </p>
            </div>
          </Panel>

          <Panel eyebrow="Next step" title="Route the item">
            <p className="text-sm leading-relaxed text-ink-soft">
              {item.hazards.length > 0
                ? "Hazard declared, so this can only go to a recycler licensed for that stream."
                : "No hazard declared, so this can take the standard board line."}
            </p>
            <Link
              href="/pickups"
              className="mt-4 inline-block border-2 border-ink bg-ink px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-paper transition-colors hover:bg-paper hover:text-ink"
            >
              Open pickup &amp; credit
            </Link>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
