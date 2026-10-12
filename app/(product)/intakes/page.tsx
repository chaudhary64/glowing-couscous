import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader } from "@/components/ui/page-header";
import { requireAccess } from "@/lib/auth/dal";
import { scopeFor, scopeRefusal } from "@/lib/auth/scope";
import { SIMULATED_CLAIM } from "@/lib/disclaimer";
import { formatInr, formatMass, formatTimestamp } from "@/lib/format";
import { listPricedItems } from "@/lib/records/queues";
import { verdictLabel, verdictTone } from "@/lib/tone";

export const instant = false;

/**
 * My submissions: what this collector submitted, and what each item was valued at.
 *
 * Read-only by design. A Collector reports a pile and is paid for it; capturing is the
 * Operator's console (`/intake`) and pricing is the Admin's (`/valuation`), so nothing on
 * this screen writes.
 *
 * The rows are cut by `scopeFor`, and only one scope can be honoured today. An Admin's
 * scope is `all`, which the existing reader serves as it stands. A Collector's scope is
 * `{ kind: "collector", userId }`, and nothing yet links a submission to the collector who
 * made it (`items.collector_id` is null in the normal case — see the migration hand-over,
 * §4.3), so the page says that instead of drawing everyone's items under "yours" or an
 * empty table that reads as "you have submitted nothing". The scoped reader lands with the
 * read layer's step 20; this page then passes it the same `scope`.
 */

const NOT_LINKED =
  "Your submissions are not linked to your account yet. Nothing records which collector made a submission, so this list cannot be cut to yours, and showing everyone's would be wrong. It fills in once each submission carries the collector who made it.";

export default async function IntakesPage() {
  const user = await requireAccess("/intakes");
  const scope = scopeFor(user);

  // Only `all` can be served by today's unscoped reader; every other scope waits for it.
  const read = scope.kind === "all" ? await listPricedItems(50) : null;
  const unavailable = read ? null : (scopeRefusal(scope) ?? NOT_LINKED);
  const rows = read?.rows ?? [];
  const everyone = scope.kind === "all";

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
            {read ? (
              <Badge tone={read.configured ? "verified" : "hazard"}>
                {read.configured ? "Counted from the database" : "No database"}
              </Badge>
            ) : (
              <Badge tone="review">Not linked yet</Badge>
            )}
            <Badge tone="ink">Read-only</Badge>
            {read?.error ? (
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
        ) : !read?.configured ? (
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
