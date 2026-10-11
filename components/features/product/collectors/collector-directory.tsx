import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { MeterRow } from "@/components/ui/meter";
import { formatInr, formatTimestamp } from "@/lib/format";
import type { CollectorActivity } from "@/lib/pickup/directory";

/**
 * Collector activity, counted from the loads.
 *
 * This table used to be a roster of five invented people with invented credit balances.
 * What it shows now is what the platform actually knows: a collector id, how many loads
 * that id has asked for, how many are still open, and what has settled against them. The
 * name, the standing and the languages are gone because nothing writes them — a roster
 * that is absent is better than one that is made up, and the page says so.
 *
 * The totals row is the reason the columns are worth having: it has to equal the load
 * board's own totals, and a directory whose total disagrees with the board is the first
 * sign that one of the two is lying.
 */
export function CollectorActivityTable({
  activity,
}: {
  activity: CollectorActivity[];
}) {
  const totals = activity.reduce(
    (sum, row) => ({
      loads: sum.loads + row.loads,
      open: sum.open + row.open,
      notes: sum.notes + row.notes,
      settledInr: sum.settledInr + row.settledInr,
    }),
    { loads: 0, open: 0, notes: 0, settledInr: 0 },
  );

  return (
    <Surface>
      <Table caption={`${activity.length} collector ids with activity, ordered by settled credits`}>
        <THead>
          <TR>
            <TH>Collector</TH>
            <TH className="hidden sm:table-cell">Working in</TH>
            <TH className="hidden lg:table-cell">Streams carried</TH>
            <TH numeric>Loads</TH>
            <TH numeric>Open</TH>
            <TH numeric className="hidden sm:table-cell">
              Notes
            </TH>
            <TH numeric>Settled</TH>
          </TR>
        </THead>
        <TBody>
          {activity.map((row) => (
            <TR key={row.collectorId}>
              <TD>
                <span className="font-medium">{row.collectorId}</span>
                {row.latestAt ? (
                  <p className="mt-1 font-mono text-[11px] text-ink-muted">
                    last asked {formatTimestamp(row.latestAt)}
                  </p>
                ) : null}
                {row.hazardous > 0 ? (
                  <p className="mt-1">
                    <Badge tone="hazard">
                      {row.hazardous} hazardous load{row.hazardous === 1 ? "" : "s"}
                    </Badge>
                  </p>
                ) : null}
              </TD>
              <TD className="hidden text-ink-soft sm:table-cell">
                {row.cities.length > 0 ? row.cities.join(", ") : "—"}
              </TD>
              <TD className="hidden lg:table-cell">
                <span className="flex flex-wrap gap-1.5">
                  {row.streams.length > 0 ? (
                    row.streams.map((stream) => (
                      <Badge key={stream} tone="neutral">
                        {stream}
                      </Badge>
                    ))
                  ) : (
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                      Nothing resolved
                    </span>
                  )}
                </span>
              </TD>
              <TD numeric mono>
                {row.loads}
              </TD>
              <TD numeric mono>
                {row.open > 0 ? row.open : "—"}
              </TD>
              <TD numeric mono className="hidden sm:table-cell">
                {row.notes > 0 ? row.notes : "—"}
              </TD>
              <TD numeric mono>
                {row.settledInr > 0 ? formatInr(row.settledInr) : "—"}
              </TD>
            </TR>
          ))}
          <TR className="border-t-[3px] border-ink bg-paper">
            <TD className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              All collectors
            </TD>
            <TD className="hidden sm:table-cell" />
            <TD className="hidden lg:table-cell" />
            <TD numeric mono className="font-semibold">
              {totals.loads}
            </TD>
            <TD numeric mono className="font-semibold">
              {totals.open}
            </TD>
            <TD numeric mono className="hidden font-semibold sm:table-cell">
              {totals.notes}
            </TD>
            <TD numeric mono className="font-semibold">
              {formatInr(totals.settledInr)}
            </TD>
          </TR>
        </TBody>
      </Table>
    </Surface>
  );
}

/**
 * Settled credits across the collectors, relative to the leading one rather than to the
 * total, because the question an operator asks is who is carrying the volume, not what
 * share the tail holds.
 */
export function CreditsShare({ activity }: { activity: CollectorActivity[] }) {
  const settled = activity.filter((row) => row.settledInr > 0);
  const top = settled[0]?.settledInr ?? 0;
  const total = settled.reduce((sum, row) => sum + row.settledInr, 0);

  if (settled.length === 0 || top === 0) {
    return (
      <p className="text-[13px] leading-relaxed text-ink-soft">
        No credit note has settled against any collector yet, so there is no share to
        show. A bar drawn now would be an invented one.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {settled.map((row) => (
        <MeterRow
          key={row.collectorId}
          label={row.collectorId}
          value={row.settledInr / top}
          tone={row.hazardous > 0 ? "hazard" : "copper"}
          display={formatInr(row.settledInr)}
          note={`${row.notes} note${row.notes === 1 ? "" : "s"} · ${
            Math.round((row.settledInr / total) * 100)
          }% of all settled credits`}
        />
      ))}
    </div>
  );
}
