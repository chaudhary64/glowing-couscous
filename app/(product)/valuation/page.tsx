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
import { formatInr, formatIstStamp, formatMass, formatRate, lineValue } from "@/lib/format";
import { getStoredItem, listPricedItems } from "@/lib/records/queues";
import {
  conditionTone,
  materialLabel,
  materialTone,
  verdictLabel,
  verdictTone,
} from "@/lib/tone";
import type { Verdict } from "@/lib/types";

export const instant = false;

/**
 * Valuations.
 *
 * This screen used to render the fixture inventory: a queue that never grew, a receipt
 * for an item nothing had priced, and totals summed over `lib/data`. It now reads the
 * rows the pipeline writes — `items`, `material_lines`, `item_hazards`, `valuations`,
 * `gatekeeper_verdicts` and their signals — through `lib/records/queues.ts`. A live
 * submission priced a moment ago is in this queue because it is a row, not because a
 * fixture was edited to look like one.
 *
 * Two things are deliberately *not* read from the database here.
 *
 * The first is the payout itself. A valuation is a promise, not a payment: no
 * `credit_notes` row exists, the money columns are written but nothing settles them, and
 * the receipt still says so on its face. That half is feature 04 and is not built.
 *
 * The second is the EPR credit note id. It belongs to an `epr_credit_notes` row, which is
 * the same unbuilt money half, so `StoredValuation.eprCreditNote` is null and the screen
 * says the note is not on file rather than printing an id nothing can be looked up by.
 * The credit *value* is stored and shown; the note that carries it is not.
 */

type Search = Record<string, string | string[] | undefined>;

/** The same one-value pick the auth and evidence pages use: a query can repeat a key. */
const pick = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** A stored verdict as a queue badge, or a neutral one when the row carries none. */
function ClearanceBadge({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return <Badge tone="neutral">No verdict</Badge>;
  return <Badge tone={verdictTone(verdict)}>{verdictLabel(verdict)}</Badge>;
}

export default async function ValuationsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireAccess("/valuation");

  const params = await searchParams;
  const requested = pick(params.item)?.trim() ?? "";

  const queue = await listPricedItems(12);
  const rows = queue.rows;

  /*
    The workspace item: the one named in the query string, or the newest row. The second
    read is by `items.code`, which is the id the queue links to and the one every screen
    shows for that valuation — so a bookmarked or pasted link resolves to the same item a
    person was looking at.
  */
  const selectedId = requested || rows[0]?.id || "";
  const selected = selectedId ? await getStoredItem(selectedId) : null;
  const openItem = selected?.rows[0] ?? null;
  const missingSelection = requested.length > 0 && openItem === null;

  /*
    Queue totals, derived from the rows rather than the fixture.

    Only cleared items carry money: a rejected or held item keeps its assay for the audit
    trail but promises nothing, so the payable and EPR totals are summed over the cleared
    set rather than over the whole queue.
  */
  const grossTotal = rows.reduce((sum, item) => sum + (item.valuation?.grossValue ?? 0), 0);
  const cleared = rows.filter((item) => item.verdict === "verified");
  const held = rows.filter((item) => item.verdict === "review");
  const refused = rows.filter((item) => item.verdict === "rejected");
  const payableTotal = cleared.reduce(
    (sum, item) => sum + (item.valuation?.netToCollector ?? 0),
    0,
  );
  const eprTotal = cleared.reduce((sum, item) => sum + (item.valuation?.eprCreditInr ?? 0), 0);

  const openValuation = openItem?.valuation ?? null;
  const openVerdict = openItem?.gatekeeper ?? null;

  const receiptLines: ReceiptLine[] = (openItem?.materials ?? []).map((line) => {
    const value = lineValue(line.massGrams, line.ratePerKg);
    return {
      label: line.symbol ? `${line.name} (${line.symbol})` : line.name,
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
        lede={
          rows.length > 0
            ? `Every item the pipeline has assayed and priced, newest first. ${formatInr(payableTotal)} is promised to collectors and ${formatInr(eprTotal)} of brand EPR credit is created across the ${cleared.length} items the gatekeeper cleared; the rest keep their assay and promise nothing.`
            : "No items have been priced yet."
        }
        actions={
          <>
            <ButtonLink href="/intake">New intake</ButtonLink>
            <ButtonLink href="/handoff" variant="secondary">
              Open handoff
            </ButtonLink>
          </>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={queue.configured ? "verified" : "hazard"}>
              {queue.configured ? "Live records" : "Unavailable"}
            </Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {rows.length} priced {rows.length === 1 ? "item" : "items"} · {cleared.length}{" "}
              cleared · {held.length} held · {refused.length} refused
            </span>
            {queue.error ? (
              <span className="text-[12px] leading-snug text-hazard-ink">
                Could not load valuations: {queue.error}
              </span>
            ) : null}
          </div>
        }
      />

      <LiveAnalysis mode="valuation" />

      {!queue.configured ? (
        <Panel eyebrow="Unavailable" title="Valuations are unavailable">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            No database is connected, so priced items cannot be saved or listed here.
          </p>
        </Panel>
      ) : null}

      {queue.configured ? (
        <>
          <StatGrid columns={4}>
            <Stat
              label="Items priced"
              value={String(rows.length)}
              unit="items"
              note={`${cleared.length} cleared · ${held.length + refused.length} held or refused.`}
            />
            <Stat
              label="Gross material value"
              value={formatInr(grossTotal)}
              note="Total value from all material lines."
            />
            <Stat
              label="Net promised to collectors"
              value={formatInr(payableTotal)}
              emphasis
              note="Cleared items after fees. Held and refused items are excluded."
            />
            <Stat
              label="Brand EPR credit"
              value={formatInr(eprTotal)}
              note="Cleared items only. Brand credit, not collector payment."
            />
          </StatGrid>

          <section>
            <SectionHeader
              eyebrow="Queue"
              title="Priced items"
              note="Select an item to review its valuation."
            />

            {rows.length === 0 ? (
              <Surface className="mt-4 p-4">
                <p className="text-sm leading-relaxed text-ink-soft">
                  Nothing is priced yet. Run a valuation above to add the first item.
                </p>
              </Surface>
            ) : (
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
                    {rows.map((item) => {
                      const isOpen = item.id === openItem?.id;
                      return (
                        <TR
                          key={item.id}
                          className={isOpen ? "bg-sunken" : undefined}
                        >
                          <TD>
                            {isOpen ? <Badge tone="copper">Open</Badge> : null}
                          </TD>
                          <TD>
                            <Link
                              href={`/valuation?item=${encodeURIComponent(item.id)}`}
                              className="font-medium underline decoration-rule decoration-1 underline-offset-2 hover:decoration-copper"
                            >
                              {item.label}
                            </Link>
                            <p className="mt-1 font-mono text-[11px] text-ink-muted">
                              {item.id} · {item.category} · {item.brand ?? "brand unread"}
                            </p>
                          </TD>
                          <TD>
                            <Badge tone={conditionTone(item.condition)}>
                              {item.condition}
                            </Badge>
                          </TD>
                          <TD>
                            <ClearanceBadge verdict={item.verdict} />
                            {item.decision ? (
                              <p className="mt-1">
                                <Badge tone="neutral">
                                  Officer: {item.decision.decision.replace(/_/g, " ")}
                                </Badge>
                              </p>
                            ) : null}
                          </TD>
                          <TD numeric mono>
                            {formatMass(item.massGrams)}
                          </TD>
                          <TD numeric mono>
                            {item.verdict === "verified" && item.netToCollector !== null
                              ? formatInr(item.netToCollector)
                              : "—"}
                          </TD>
                          <TD mono className="hidden text-[12px] lg:table-cell">
                            {item.eprCreditNote ?? "—"}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
                <p className="border-t border-rule px-3 py-3 text-[12px] leading-relaxed text-ink-muted">
                  Refused items show no payable amount. Held items show a dash until a
                  decision is made in the{" "}
                  <Link
                    href="/validation"
                    className="underline decoration-rule underline-offset-2 hover:decoration-copper"
                  >
                    validation queue
                  </Link>
                  . EPR notes appear after routing.
                </p>
              </Surface>
            )}
          </section>

          {missingSelection ? (
            <Panel eyebrow="Not found" title={`No item holds the id ${requested}`}>
              <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
                No item matches that ID. Showing the newest priced item instead.
              </p>
            </Panel>
          ) : null}

          {openItem && openValuation && openVerdict ? (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              {/* `minmax(0,1fr)` at the base width, not just at `lg`: the implicit auto column
                  is floored by its content's min-content, and a table inside a scroll box still
                  reports its own min-content upward, which pushed this whole screen ~54px past
                  a 390px viewport. A track that can go to zero lets the table scroll instead. */}
              <div className="flex min-w-0 flex-col gap-8">
                <section>
                  <SectionHeader
                    eyebrow={`Open item · ${openItem.id}`}
                    title={openItem.label}
                    note={`Priced ${formatIstStamp(openItem.storedAt)}. The assay sets the value; the gatekeeper decides whether it can be promised.`}
                  />
                  <Surface className="mt-4 p-4">
                    <FieldList columns={3}>
                      <Field label="Category" value={openItem.category} />
                      <Field label="Brand read" value={openItem.brand ?? "unread"} mono />
                      <Field label="Condition" value={openItem.condition} tone="muted" />
                      <Field label="Mass" value={formatMass(openItem.massGrams)} mono />
                      <Field
                        label="Assayed by"
                        value="Automatic"
                        tone="muted"
                      />
                      <Field
                        label="Rate basis"
                        value={openValuation.rateBasis || "Not recorded"}
                        tone="muted"
                      />
                    </FieldList>

                    <div className="mt-5 border-t border-rule pt-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                        Hazards to share with the recycler
                      </p>
                      {openItem.hazards.length > 0 ? (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {openItem.hazards.map((hazard) => (
                            <li key={hazard}>
                              <Badge tone="hazard">{hazard}</Badge>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-[12px] leading-snug text-ink-muted">
                          None flagged on this item.
                        </p>
                      )}
                    </div>
                  </Surface>
                </section>

                <section>
                  <SectionHeader
                    eyebrow="Assay"
                    title="Metal breakdown"
                    note="Materials, weights, rates and values used for this item."
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
                                {line.symbol ? (
                                  <span className="ml-2 font-mono text-[11px] text-ink-muted">
                                    {line.symbol}
                                  </span>
                                ) : null}
                                {line.handling ? (
                                  <p className="mt-1 text-[11px] leading-snug text-ink-muted">
                                    {line.handling}
                                  </p>
                                ) : null}
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
                        <TR className="border-t-[3px] border-ink bg-paper">
                          <TD className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                            Gross
                          </TD>
                          <TD />
                          <TD numeric mono>
                            {formatMass(openItem.massGrams)}
                          </TD>
                          <TD />
                          <TD numeric mono className="font-semibold">
                            {formatInr(openValuation.grossValue)}
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
                      title="Clearance decision"
                      note="Credit is promised only when the item is verified."
                    />
                    <VerdictMark verdict={openVerdict.verdict} />
                  </div>

                  <Panel className="mt-4">
                    <p className="text-sm leading-relaxed text-ink-soft">
                      {openVerdict.reason || "The model recorded no reason sentence for this verdict."}
                    </p>

                    <div className="mt-4 border-t border-rule pt-3">
                      <MeterRow
                        label="Confidence"
                        value={openVerdict.confidence}
                        display={`${Math.round(openVerdict.confidence * 100)}% on ${openVerdict.matchedClass}`}
                        tone={verdictTone(openVerdict.verdict)}
                      />
                    </div>

                    {openVerdict.signals.length > 0 ? (
                      <FieldList columns={2} className="mt-4">
                        {openVerdict.signals.map((signal) => (
                          <Field
                            key={`${signal.label}-${signal.value}`}
                            label={signal.label}
                            value={signal.value}
                            mono
                          />
                        ))}
                      </FieldList>
                    ) : (
                      <p className="mt-4 text-[12px] leading-snug text-ink-muted">
                        No signals recorded.
                      </p>
                    )}

                    {openItem.decision ? (
                      <p className="mt-4 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-soft">
                        Decision made on{" "}
                        {formatIstStamp(openItem.decision.decidedAt)}:{" "}
                        <span className="font-mono">
                          {openItem.decision.decision.replace(/_/g, " ")}
                        </span>
                        {openItem.decision.reason ? ` — ${openItem.decision.reason}` : ""}
                        {openItem.decision.decidedByName
                          ? ` (${openItem.decision.decidedByName})`
                          : ""}
                        .
                      </p>
                    ) : null}

                    <p className="mt-5 border-t border-rule pt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                      Automatic check ·{" "}
                      {formatIstStamp(openVerdict.checkedAt)} ·{" "}
                      <Link
                        href="/validation"
                        className="underline decoration-rule underline-offset-2 hover:decoration-copper"
                      >
                        View validation
                      </Link>
                    </p>
                  </Panel>
                </section>
              </div>

              <aside className="flex flex-col gap-6 lg:sticky lg:top-16 lg:self-start">
                <Receipt
                  title="Valuation summary"
                  reference={openItem.id}
                  issuedAt={`Issued ${formatIstStamp(openValuation.computedAt)}`}
                  lines={receiptLines}
                  adjustments={[
                    {
                      label: "Handling & line fee",
                      value: `−${formatInr(openValuation.handlingFee)}`,
                    },
                  ]}
                  total={{
                    label: "Net to collector",
                    value: formatInr(openValuation.netToCollector),
                    sub: openValuation.validUntil
                      ? `Valid until ${formatIstStamp(openValuation.validUntil)}`
                      : "No expiry recorded",
                  }}
                  note={`${openValuation.rateBasis}. This is a valuation summary; no payment is settled here.`}
                  stamp={<Stamp verdict={openVerdict.verdict} />}
                />

                <Panel eyebrow="Compliance" title="Brand EPR credit">
                  <div className="flex flex-col gap-3">
                    <p className="text-sm leading-relaxed text-ink-soft">
                      This value is for brand EPR tracking. It is separate from any
                      payment to the collector.
                    </p>
                    <FieldList columns={1}>
                      <Field
                        label="Credit value"
                        value={formatInr(openValuation.eprCreditInr)}
                        mono
                        tone="copper"
                      />
                      <Field
                        label="Credit note"
                        value={openValuation.eprCreditNote ?? "Not recorded yet"}
                        mono
                      />
                      <Field
                        label="Basis"
                        value="Category and brand from the intake"
                      />
                    </FieldList>
                    <p className="flex items-center gap-2">
                      <Badge tone={verdictTone(openVerdict.verdict)}>
                        {verdictLabel(openVerdict.verdict)}
                      </Badge>
                      <span className="text-[12px] text-ink-muted">
                        Credit applies only when verified.
                      </span>
                    </p>
                  </div>
                </Panel>

                <Panel eyebrow="Next step" title="Route the item">
                  <p className="text-sm leading-relaxed text-ink-soft">
                    {openItem.hazards.length > 0
                      ? "Hazard declared. Route it to a recycler licensed for this stream."
                      : "No hazard declared. Standard routing is available."}
                  </p>
                  <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
                    Routing and pickup happen on the handoff screen. This page only prices
                    the item.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ButtonLink href="/handoff">Open handoff</ButtonLink>
                    <ButtonLink href="/recyclers" variant="secondary">
                      Destinations
                    </ButtonLink>
                  </div>
                </Panel>
              </aside>
            </div>
          ) : rows.length > 0 ? (
            <Panel eyebrow="Incomplete" title="Valuation details are unavailable">
              <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
                This item is recorded, but its valuation or clearance decision is missing.
              </p>
            </Panel>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
