import { Receipt, type ReceiptLine } from "@/components/ui/receipt";
import { Stamp } from "@/components/ui/stamp";
import { SIMULATED_CLAIM } from "@/lib/disclaimer";
import { formatInr, formatMass } from "@/lib/format";
import type { Collector, EwasteItem, Recycler } from "@/lib/types";

/**
 * The note the collector actually holds: a scrap payout, not a brand credit.
 *
 * The stamp reads "Settled", not "Verified". Verified belongs to the gatekeeper's
 * boolean; this document proves a payment, so it uses the settled state — the one
 * green state in lib/tone.ts that means money moved.
 */
export function CreditNote({
  collector,
  item,
  recycler,
  reference,
  amount,
  className,
}: {
  collector: Collector;
  item: EwasteItem;
  recycler: Recycler;
  reference: string;
  amount: number;
  className?: string;
}) {
  /**
   * The money lines have to reconcile to the total: gross material value, then the
   * handling deduction the valuation already charged, then what is actually paid.
   * Mass is a quantity, not money, so it belongs in the adjustments below.
   */
  const lines: ReceiptLine[] = [
    {
      label: item.label,
      detail: item.id,
      value: formatInr(item.valuation.grossValue),
    },
    {
      label: "Handling & licensed line fee",
      detail: "deducted before payout",
      value: `−${formatInr(item.valuation.handlingFee)}`,
      muted: true,
    },
  ];

  return (
    <Receipt
      className={className}
      title="Collector credit note"
      reference={reference}
      issuedAt="Issued 09 Oct 2026, 15:04 IST"
      lines={lines}
      adjustments={[
        {
          label: "Weighed at recycler gate",
          value: `${formatMass(item.massGrams)} · ${recycler.name}`,
        },
        { label: "Paid to", value: collector.name },
        { label: "Collector ID", value: collector.id },
        { label: "Linked brand EPR note", value: item.valuation.eprCreditNote },
      ]}
      total={{
        label: "Settled to collector",
        value: formatInr(amount),
        sub: "Payable once weight is verified at the recycler gate.",
      }}
      note={`Running total for this collector: ${formatInr(collector.creditsInr)} across ${collector.pickups} pickups. ${SIMULATED_CLAIM}`}
      stamp={<Stamp label="Settled" tone="verified" />}
    />
  );
}
