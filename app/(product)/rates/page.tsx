import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { requireAccess } from "@/lib/auth/dal";
import { ITEM_CLASSES, RATE_CARD, materialIds } from "@/lib/data/rate-card";
import { formatInr, formatRate } from "@/lib/format";
import { currentRates, type RateSheetLine } from "@/lib/rates/daily";
import { displayDay } from "@/lib/rates/feed";
import { materialLabel, materialTone } from "@/lib/tone";
import type { MaterialCategory } from "@/lib/types";

export const instant = false;

const GRADE_ORDER: MaterialCategory[] = ["precious", "base", "hazardous", "inert"];

/** "copper, nickel and tin". */
const listOf = (names: string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * The rate card in force, for the roles that answer for prices.
 *
 * Read-only. The metals with a market price follow it once a day (`lib/rates/daily.ts`
 * keeps the dated card), and everything else is code: `lib/data/rate-card.ts`, so a
 * change to a manual rate is a reviewed commit rather than an edit in a form. Showing it
 * here means an admin can answer "why was this item worth ₹86" without opening the
 * repository, from the same sheet the pricing code reads.
 */
export default async function RatesPage() {
  await requireAccess("/rates");
  const sheet = await currentRates();

  const materials = materialIds
    .map((id) => ({ id, ...RATE_CARD[id], ...sheet.lines[id] }))
    .sort(
      (a, b) =>
        GRADE_ORDER.indexOf(a.category) - GRADE_ORDER.indexOf(b.category) ||
        b.ratePerKg - a.ratePerKg,
    );
  const marketLinked = materials.filter((line) => line.marketPerKg !== null).length;
  const fixedLinked = materials.filter((line) => line.fixedSource !== null).length;
  // In the card's own order, so copper leads rather than whichever metal is dearest.
  const namesWhere = (test: (line: RateSheetLine) => boolean) =>
    materialIds.filter((id) => test(sheet.lines[id])).map((id) => RATE_CARD[id].name.toLowerCase());
  const fixed = namesWhere((line) => line.fixedSource !== null);
  const paidPlan = namesWhere((line) => line.needsPaidPlan);
  const classes = Object.values(ITEM_CLASSES);

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Administration"
        title="Rate card"
        lede="The prices every valuation is computed from, on the server. Metals with a market price follow it once a day, from MetalpriceAPI; the rest ship with the code, so changing one is a reviewed change to the repository, not an edit here."
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={sheet.source === "daily" ? "verified" : "neutral"}>
              {sheet.source === "daily" && sheet.day ? `Daily card · ${displayDay(sheet.day)}` : "Demo card"}
            </Badge>
            <span className="text-[12px] text-ink-soft">{sheet.basis}</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Valid until {sheet.validUntil}
            </span>
          </div>
        }
      />

      {sheet.note ? (
        <Surface tone="inset" className="p-4">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            {sheet.note}{" "}
            {sheet.source === "daily"
              ? "The last stored card is in force until today's arrives."
              : "Every rate below is the demo card's."}
          </p>
        </Surface>
      ) : null}

      {fixed.length > 0 ? (
        <Surface tone="inset" className="p-4">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            The MetalpriceAPI plan in use has no daily price for {listOf(fixed)}, so their market prices are held
            fixed at the latest close when they were taken, shown beside each. They are paid exactly like the
            metals priced daily, as a share of that price, and a paid plan would replace them with the day&rsquo;s.
          </p>
        </Surface>
      ) : null}

      {paidPlan.length > 0 ? (
        <Surface tone="inset" className="p-4">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            The MetalpriceAPI plan in use has no price for {listOf(paidPlan)}, so they keep the demo card&rsquo;s
            rates. On a paid plan each one joins the market the first day it is priced, at the rate it pays now.
          </p>
        </Surface>
      ) : null}

      <section>
        <SectionHeader
          eyebrow="Materials"
          title="Price per kilogram"
          note={`${materials.length} materials${
            marketLinked > 0
              ? `, ${marketLinked - fixedLinked} at today's market${fixedLinked > 0 ? ` and ${fixedLinked} at a fixed market price` : ""}: each pays the share of the market it paid the day it was first priced, never more than the market`
              : ""
          }. A zero rate still has to be declared: a hazardous or inert fraction carries handling cost.`}
        />
        <Surface className="mt-4">
          <Table caption="Material rates">
            <THead>
              <TR>
                <TH>Material</TH>
                <TH>Grade</TH>
                <TH numeric>Rate</TH>
                {marketLinked > 0 ? <TH numeric className="hidden sm:table-cell">Market</TH> : null}
                <TH className="hidden sm:table-cell">Source</TH>
                <TH className="hidden lg:table-cell">Handling</TH>
              </TR>
            </THead>
            <TBody>
              {materials.map((line) => (
                <TR key={line.id}>
                  <TD>
                    <span className="font-medium">{line.name}</span>
                    <span className="ml-2 font-mono text-[11px] text-ink-muted">{line.symbol}</span>
                  </TD>
                  <TD>
                    <Badge tone={materialTone(line.category)}>{materialLabel(line.category)}</Badge>
                  </TD>
                  <TD numeric mono>
                    {formatRate(line.ratePerKg)}
                  </TD>
                  {marketLinked > 0 ? (
                    <TD numeric mono className="hidden sm:table-cell">
                      {line.marketPerKg !== null ? (
                        <>
                          {formatRate(line.marketPerKg)}
                          {line.share !== null ? (
                            <span className="block text-[11px] text-ink-muted">
                              pays {(line.share * 100).toFixed(1)}%
                            </span>
                          ) : null}
                        </>
                      ) : line.needsPaidPlan ? (
                        <span className="text-[11px] text-ink-muted">paid plan</span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TD>
                  ) : null}
                  <TD className="hidden sm:table-cell">
                    {line.fixedSource !== null ? (
                      <>
                        <Badge tone="neutral">Fixed price</Badge>
                        <span className="mt-1 block text-[11px] text-ink-muted">{line.fixedSource}</span>
                      </>
                    ) : line.marketPerKg !== null ? (
                      <Badge tone="verified">Daily market</Badge>
                    ) : line.ratePerKg > 0 ? (
                      <Badge tone="neutral">Manual</Badge>
                    ) : (
                      <span className="text-[12px] text-ink-muted">No value</span>
                    )}
                  </TD>
                  <TD className="hidden text-[12px] text-ink-soft lg:table-cell">{line.handling}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Surface>
      </section>

      <section>
        <SectionHeader
          eyebrow="Item classes"
          title="Handling fee and EPR credit"
          note="Each item is priced under one class: the handling fee comes off the material value, and the EPR credit goes to the brand."
        />
        <Surface className="mt-4">
          <Table caption="Item classes">
            <THead>
              <TR>
                <TH>Class</TH>
                <TH className="hidden md:table-cell">CPCB category</TH>
                <TH numeric>Handling fee</TH>
                <TH numeric>EPR credit</TH>
              </TR>
            </THead>
            <TBody>
              {classes.map((entry) => (
                <TR key={entry.label}>
                  <TD className="font-medium">{entry.label}</TD>
                  <TD className="hidden text-[12px] text-ink-soft md:table-cell">{entry.cpcb}</TD>
                  <TD numeric mono>
                    {formatInr(entry.handlingFee)}
                  </TD>
                  <TD numeric mono>
                    {formatInr(entry.eprCreditInr)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Surface>
      </section>
    </div>
  );
}
