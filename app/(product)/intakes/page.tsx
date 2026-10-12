import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader } from "@/components/ui/page-header";
import { requireAccess } from "@/lib/auth/dal";
import { SIMULATED_CLAIM } from "@/lib/disclaimer";
import { formatInr, formatMass, formatTimestamp } from "@/lib/format";
import { listPricedItems } from "@/lib/records/queues";
import { scopeForUser } from "@/lib/records/scope";
import { verdictLabel, verdictTone } from "@/lib/tone";

export const instant = false;

/**
 * My submissions: what this collector submitted, and what each item was valued at.
 *
 * Read-only by design. A Collector reports a pile and is paid for it; capturing is the
 * Operator's console (`/intake`) and pricing is the Admin's (`/valuation`), so nothing on
 * this screen writes.
 *
 * The rows are cut by the caller's scope inside the reader. An Admin's scope is `all`. A
 * Collector's reaches the submissions made in their name — through their collector record
 * — and until that record exists (the migration hand-over, §4.3) the reader answers with
 * a sentence saying so, which the page shows instead of an empty table that would read as
 * "you have submitted nothing".
 */

export default async function IntakesPage() {
  const user = await requireAccess("/intakes");
  const scope = await scopeForUser(user);
  const read = await listPricedItems(scope, 50);
  const rows = read.rows;
  const everyone = scope.kind === "all";
  // For a narrower scope the reader's sentence is the scope's answer, not a failure.
  const unavailable = !everyone && read.error ? read.error : null;

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Collection"
        title="Submissions"
        lede={
          everyone
            ? "Every item submitted to the platform, newest first, with what it was valued at. You are an admin, so this is every collector's history; a collector sees only their own."
            : "What you submitted, newest first, with what each item was valued at. Read-only: an item is priced once, on the server, from the rate card."
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {unavailable ? (
              <Badge tone="review">Not linked yet</Badge>
            ) : (
              <Badge tone={read.configured ? "verified" : "hazard"}>
                {read.configured ? "Live records" : "Unavailable"}
              </Badge>
            )}
            <Badge tone="ink">Read-only</Badge>
            {read.error && !unavailable ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-hazard-ink">
                {read.error}
              </span>
            ) : null}
          </div>
        }
      />

      <Surface>
        {unavailable ? (
          <p className="max-w-3xl p-4 text-sm leading-relaxed text-ink-soft">{unavailable}</p>
        ) : !read.configured ? (
          <p className="max-w-3xl p-4 text-sm leading-relaxed text-ink-soft">
            No records database is connected, so no submission can be read back. The list is
            absent rather than empty: an empty table would say nothing was ever submitted.
          </p>
        ) : rows.length === 0 ? (
          <p className="max-w-3xl p-4 text-sm leading-relaxed text-ink-soft">
            Nothing has been submitted yet. An item appears here as soon as it is priced and
            its record is written.
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH className="w-36">Submitted</TH>
                <TH>Item</TH>
                <TH numeric className="hidden sm:table-cell">
                  Mass
                </TH>
                <TH>Verdict</TH>
                <TH numeric>Net to collector</TH>
                <TH numeric className="hidden lg:table-cell">
                  EPR credit
                </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((item) => (
                <TR key={item.id}>
                  <TD mono className="text-[11px] text-ink-muted">
                    {formatTimestamp(item.storedAt)}
                  </TD>
                  <TD>
                    <span className="font-medium">{item.label}</span>
                    <p className="mt-1 font-mono text-[11px] text-ink-muted">
                      {item.id}
                      {item.brand ? ` · ${item.brand}` : ""}
                    </p>
                  </TD>
                  <TD numeric mono className="hidden sm:table-cell">
                    {formatMass(item.massGrams)}
                  </TD>
                  <TD>
                    {item.verdict ? (
                      <Badge tone={verdictTone(item.verdict)}>{verdictLabel(item.verdict)}</Badge>
                    ) : (
                      <Badge tone="neutral">No verdict</Badge>
                    )}
                  </TD>
                  <TD numeric mono>
                    {item.verdict === "verified" && item.netToCollector !== null
                      ? formatInr(item.netToCollector)
                      : "—"}
                  </TD>
                  <TD numeric mono className="hidden lg:table-cell">
                    {item.eprCreditInr !== null ? formatInr(item.eprCreditInr) : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Surface>

      <p className="max-w-3xl text-[12px] leading-relaxed text-ink-muted">
        Net to collector is shown only for items the gatekeeper cleared; a held or refused item
        keeps its assay and promises nothing. {SIMULATED_CLAIM}
      </p>
    </div>
  );
}
