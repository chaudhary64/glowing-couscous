import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import {
  blockedTotal,
  medianPayoutInr,
  preventedCreditsInr,
  rejectRules,
} from "@/lib/data/model";
import { formatInrCompact } from "@/lib/format";

export function RejectRules() {
  return (
    <Surface>
      <Table caption="Rules that fire before a credit exists">
        <THead>
          <TR>
            <TH className="w-16">Code</TH>
            <TH>Rule</TH>
            <TH numeric>Blocked</TH>
            <TH className="hidden lg:table-cell">Note</TH>
          </TR>
        </THead>
        <TBody>
          {rejectRules.map((rule) => (
            <TR key={rule.code}>
              <TD mono className="text-copper">
                {rule.code}
              </TD>
              <TD>{rule.rule}</TD>
              <TD numeric mono>
                {rule.blocked}
              </TD>
              <TD className="hidden max-w-md text-[12px] leading-snug text-ink-soft lg:table-cell">
                {rule.note}
              </TD>
            </TR>
          ))}
          <TR className="border-t-2 border-ink bg-paper">
            <TD className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Total
            </TD>
            <TD className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Blocked before credit
            </TD>
            <TD numeric mono className="font-semibold">
              {blockedTotal}
            </TD>
            <TD className="hidden text-[12px] leading-snug text-ink-muted lg:table-cell">
              Roughly {formatInrCompact(preventedCreditsInr)} of simulated
              credits never issued, at a {formatInrCompact(medianPayoutInr)} median
              payout.
            </TD>
          </TR>
        </TBody>
      </Table>
    </Surface>
  );
}
