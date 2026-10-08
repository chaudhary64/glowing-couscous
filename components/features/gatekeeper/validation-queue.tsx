import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { validationQueue } from "@/lib/data/model";
import { formatConfidence } from "@/lib/format";
import { verdictLabel, verdictTone } from "@/lib/tone";
import type { Verdict } from "@/lib/types";

const order: Verdict[] = ["rejected", "review", "verified"];

export function ValidationQueue() {
  const tally = validationQueue.reduce<Record<Verdict, number>>(
    (counts, record) => {
      counts[record.verdict] += 1;
      return counts;
    },
    { verified: 0, rejected: 0, review: 0 },
  );

  return (
    <Surface>
      <Table caption={`${validationQueue.length} most recent decisions, newest first`}>
        <THead>
          <TR>
            <TH>Record</TH>
            <TH>Subject</TH>
            <TH className="hidden sm:table-cell">Collector</TH>
            <TH className="hidden md:table-cell">Time</TH>
            <TH>Verdict</TH>
            <TH numeric>Confidence</TH>
            <TH className="hidden lg:table-cell">Reason</TH>
          </TR>
        </THead>
        <TBody>
          {validationQueue.map((record) => (
            <TR key={record.id} muted={record.verdict === "verified"}>
              <TD mono>{record.id}</TD>
              <TD>{record.subject}</TD>
              <TD className="hidden text-ink-soft sm:table-cell">
                {record.collector}
              </TD>
              <TD className="hidden font-mono text-[12px] text-ink-muted md:table-cell">
                {record.submittedAt}
              </TD>
              <TD>
                <Badge
                  tone={verdictTone(record.verdict)}
                  solid={record.verdict === "rejected"}
                >
                  {verdictLabel(record.verdict)}
                </Badge>
              </TD>
              <TD numeric mono>
                {formatConfidence(record.confidence)}
              </TD>
              <TD className="hidden max-w-sm text-[12px] leading-snug text-ink-soft lg:table-cell">
                {record.reason}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-ink px-3 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          Today
        </span>
        {order.map((verdict) => (
          <span key={verdict} className="flex items-center gap-2">
            <Badge tone={verdictTone(verdict)}>{verdictLabel(verdict)}</Badge>
            <span className="font-mono text-[13px] font-medium">{tally[verdict]}</span>
          </span>
        ))}
        <span className="ml-auto font-mono text-[11px] text-ink-muted">
          Showing the last {validationQueue.length} decisions
        </span>
      </div>
    </Surface>
  );
}
