import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { rejectRules } from "@/lib/data/model";

/**
 * The rules that refuse an item before a credit exists.
 *
 * The vocabulary is the prompt's — the gatekeeper instruction hands the model R-01 to
 * R-04 — so the table can name every refusal rule there is. What it cannot do is say how
 * often each one fired: a firing is a `rule_blocks` row and no code writes one, so the
 * per-rule column of invented counts (148 / 61 / 37 / 24) is gone rather than relabelled.
 *
 * The total it shows is `storedCounts().rejected`, counted from `gatekeeper_verdicts`.
 * A refusal whose rule was never recorded still lands in that number, which is why the
 * total is not the sum of a column.
 */
export function RejectRules({ refused }: { refused: number | null }) {
  return (
    <Surface>
      <Table caption="The reasons a submission can be refused before a credit exists">
        <THead>
          <TR>
            <TH className="w-16">Code</TH>
            <TH>Rule</TH>
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
              <TD className="hidden max-w-md text-[12px] leading-snug text-ink-soft lg:table-cell">
                {rule.note}
              </TD>
            </TR>
          ))}
          <TR className="border-t-[3px] border-ink bg-paper">
            <TD className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Total
            </TD>
            <TD>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                Refused before a credit
              </span>{" "}
              {refused === null ? (
                <span className="text-[12px] text-ink-muted">
                  — not counted; the records database could not be read
                </span>
              ) : (
                <span className="font-mono text-sm font-semibold tabular-nums">{refused}</span>
              )}
            </TD>
            <TD className="hidden text-[12px] leading-snug text-ink-muted lg:table-cell">
              {refused === null ? (
                "—"
              ) : (
                <>
                  Every rule&rsquo;s refusals together, counted from{" "}
                  <span className="font-mono">gatekeeper_verdicts</span> at{" "}
                  <span className="font-mono">rejected</span>. The per-rule split is not
                  recorded — a firing would be a{" "}
                  <span className="font-mono">rule_blocks</span> row and nothing writes one —
                  so no rule above carries a count.
                </>
              )}
            </TD>
          </TR>
        </TBody>
      </Table>
    </Surface>
  );
}
