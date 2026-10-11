import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { requireAccess } from "@/lib/auth/dal";
import { formatInr, formatRate } from "@/lib/format";
import { loadRateCard } from "@/lib/rates/card";
import { materialLabel, materialTone } from "@/lib/tone";
import type { MaterialCategory } from "@/lib/types";

export const instant = false;

const GRADE_ORDER: MaterialCategory[] = ["precious", "base", "hazardous", "inert"];

/**
 * The rate card in force, for the roles that answer for prices.
 *
 * Read-only, and read from the database: `rate_cards`, `rate_card_lines` and
 * `rate_card_classes` hold the same rows the pricing path prices every valuation from,
 * written by `npm run rates:seed`. So an admin can answer "why was this item worth ₹86"
 * without opening the repository, from the table the pricing code actually used — and the
 * page and the price cannot disagree, because they are the same rows. With no card seeded
 * the page falls back to the card shipped in code and says which one it is showing.
 */
export default async function RatesPage() {
  await requireAccess("/rates");

  const card = await loadRateCard();
  const materials = Object.values(card.materials).sort(
    (a, b) =>
      GRADE_ORDER.indexOf(a.category) - GRADE_ORDER.indexOf(b.category) ||
      b.ratePerKg - a.ratePerKg,
  );
  const classes = Object.values(card.classes);

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Administration"
        title="Rate card"
        lede="The prices every valuation is computed from. The card is stored, so changing a rate is a governed write rather than a deploy — and this screen shows the same rows the pricing code reads."
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={card.source === "database" ? "verified" : "neutral"}>
              {card.source === "database" ? "Read from the database" : "Card shipped in code"}
            </Badge>
            <Badge tone="neutral">{card.basis}</Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Valid until {card.validUntil}
            </span>
            {card.error ? (
              <span className="text-[12px] leading-snug text-hazard-ink">{card.error}</span>
            ) : null}
          </div>
        }
      />

      <section>
        <SectionHeader
          eyebrow="Materials"
          title="Price per kilogram"
          note={`${materials.length} materials. A zero rate still has to be declared: a hazardous or inert fraction carries handling cost.`}
        />
        <Surface className="mt-4">
          <Table caption="Material rates">
            <THead>
              <TR>
                <TH>Material</TH>
                <TH>Grade</TH>
                <TH numeric>Rate</TH>
                <TH className="hidden md:table-cell">Handling</TH>
              </TR>
            </THead>
            <TBody>
              {materials.map((line) => (
                <TR key={line.name}>
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
                  <TD className="hidden text-[12px] text-ink-soft md:table-cell">{line.handling}</TD>
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
