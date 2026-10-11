import Link from "next/link";
import {
  CollectorActivityTable,
  CreditsShare,
} from "@/components/features/product/collectors/collector-directory";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { SIMULATED_CLAIM, simulatedNote } from "@/lib/disclaimer";
import { formatInr, formatMass, formatTimestamp } from "@/lib/format";
import { listCollectorActivity, listLoads } from "@/lib/pickup/directory";
import { pickupLabel, pickupTone } from "@/lib/tone";

export const instant = false;

/**
 * Who is collecting, counted from the loads.
 *
 * This screen used to be the most authored page on the site: five invented people, with
 * invented cities, credit balances and language lists, plus a directory table that
 * presented them as a ledger. Nothing writes a collector record — the Postgres `collectors`
 * table has no writer and the `collector_name` column is null on every row the pipeline
 * writes — so a roster cannot be read honestly today.
 *
 * What can be read is who asked for each route, because `POST /pickups` records it. So the
 * page is now an activity view keyed by collector id, and it says what is missing instead
 * of filling the gap: no name, no standing, no languages. That is the same rule the rest of
 * the app follows — a figure is counted or it is labelled, and it is never invented to
 * make a table look complete.
 */
export default async function CollectorsPage() {
  await requireAccess("/collectors");

  const [activity, board] = await Promise.all([
    listCollectorActivity(25),
    listLoads(50),
  ]);
  const collectors = activity.rows;
  const loads = board.rows;

  const totalLoads = collectors.reduce((sum, row) => sum + row.loads, 0);
  const openLoads = collectors.reduce((sum, row) => sum + row.open, 0);
  const notes = collectors.reduce((sum, row) => sum + row.notes, 0);
  const settledInr = collectors.reduce((sum, row) => sum + row.settledInr, 0);
  const hazardous = collectors.reduce((sum, row) => sum + row.hazardous, 0);

  const notice = !activity.configured
    ? "The pickup service is not connected, so no collector activity can be read."
    : activity.error
      ? `Collector activity could not be read: ${activity.error}`
      : null;

  const recent = loads.slice(0, 8);

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Network · Collectors"
        title="Collectors"
        lede="Every route the platform has recorded, grouped by the collector who asked for it. A collector id is what the service stores; the person behind it is not on file, so the page shows the activity rather than a name it cannot verify."
        actions={
          <ButtonLink href="/pickups" variant="secondary">
            See the load board
          </ButtonLink>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={notice ? "hazard" : "verified"}>
              {notice ? "No activity" : "Counted from the load board"}
            </Badge>
            {notice ? null : (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                {collectors.length} collector id{collectors.length === 1 ? "" : "s"} ·{" "}
                {totalLoads} load{totalLoads === 1 ? "" : "s"} · {notes} note
                {notes === 1 ? "" : "s"} issued
              </span>
            )}
          </div>
        }
      />

      {notice ? (
        <Surface tone="inset" className="p-4">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">{notice}</p>
        </Surface>
      ) : null}

      {notice ? null : (
        <>
          <StatGrid columns={4}>
            <Stat
              label="Collectors with activity"
              value={String(collectors.length)}
              unit="ids"
              note={`Ids the service has recorded asking for a route, not a loaded roster. ${hazardous} load${hazardous === 1 ? " was" : "s were"} carrying a hazard declaration.`}
            />
            <Stat
              label="Loads asked for"
              value={String(totalLoads)}
              unit="loads"
              note={`Across every collector id above. ${openLoads} still open.`}
            />
            <Stat
              label="Credit notes issued"
              value={String(notes)}
              unit="notes"
              note="One note per settled load."
            />
            <Stat
              label="Settled to collectors"
              value={formatInr(settledInr)}
              emphasis
              note={simulatedNote(
                "Each note is tied to a weighed load at a licensed recycler.",
              )}
            />
          </StatGrid>

          <section>
            <SectionHeader
              eyebrow="Activity"
              title="Everyone with a load on the board"
              note="Ordered by credits settled, with the totals row summing to the same figures the load board shows."
            />
            <div className="mt-5">
              <CollectorActivityTable activity={collectors} />
            </div>
          </section>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section>
              <SectionHeader
                eyebrow="Distribution"
                title="Credits share"
                note="Measured against the leading collector, so the shape of the tail is visible at a glance."
              />
              <Surface className="mt-5 p-4">
                <CreditsShare activity={collectors} />
              </Surface>
            </section>

            <section>
              <SectionHeader
                eyebrow="Language coverage"
                title="Not recorded"
                note="Which languages a collector speaks is a roster fact, and there is no roster."
              />
              <Surface className="mt-5 p-4">
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  The intake pipeline resolves a Hindi voice note into a structured item,
                  and the collector id on a load is the only identity the platform stores.
                  Nothing records what a collector speaks, so a language-coverage panel
                  would be a chart of guesses. It is absent rather than approximate — the
                  same reason there is no name beside a collector id.
                </p>
              </Surface>
            </section>
          </div>

          <section>
            <SectionHeader
              eyebrow="Loads in flight"
              title="Recently active"
              note="Which collector asked for which load, and what state it is in now."
            />
            <Surface className="mt-5">
              {recent.length === 0 ? (
                <p className="p-4 text-sm leading-relaxed text-ink-soft">
                  No load has been routed yet, so no collector has activity to show.
                </p>
              ) : (
                <>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Load</TH>
                        <TH>Collector</TH>
                        <TH className="hidden sm:table-cell">Stream</TH>
                        <TH>Status</TH>
                        <TH numeric>Settled</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {recent.map((load) => (
                        <TR
                          key={load.pickupId}
                          className={load.hazardous ? "border-l-[5px] border-l-hazard" : undefined}
                        >
                          <TD mono>
                            <Link
                              href="/pickups"
                              className="font-medium underline decoration-rule underline-offset-2 hover:decoration-copper"
                            >
                              {load.pickupId}
                            </Link>
                            <p className="mt-1 font-mono text-[11px] text-ink-muted">
                              {formatTimestamp(load.requestedAt)}
                            </p>
                          </TD>
                          <TD mono>
                            {load.collectorId || "unattributed"}
                            <p className="mt-1 text-[11px] text-ink-muted">{load.city}</p>
                          </TD>
                          <TD className="hidden text-[13px] text-ink-soft sm:table-cell">
                            {load.streamLabel}
                            <p className="mt-1 font-mono text-[11px] text-ink-muted">
                              {formatMass(Number(load.declaredMassG ?? 0))}
                            </p>
                          </TD>
                          <TD>
                            <Badge tone={pickupTone(load.status)}>
                              {pickupLabel(load.status)}
                            </Badge>
                          </TD>
                          <TD numeric mono>
                            {load.creditNoteAmountPaise
                              ? formatInr(load.creditNoteAmountPaise / 100)
                              : "—"}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>

                  <p className="border-t border-rule px-3 py-3 text-[12px] leading-relaxed text-ink-muted">
                    A settled row means the credit note was issued against weight verified at
                    the recycler gate. Nothing on this page is authored — there is no sample
                    roster behind it.
                  </p>
                </>
              )}
            </Surface>
          </section>

          <Panel eyebrow="Read this before quoting a number" title="What is counted, and what is missing">
            <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
              {SIMULATED_CLAIM} Each note is tied to a weighed load at a CPCB-registered
              recycler rather than to a promise made at the doorstep — which is the only
              reason a brand could book one against an EPR mandate.
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-soft">
              What this page cannot show is a person. A collector id is stored on every load,
              and nothing else about the collector is: no name, no standing, no languages, no
              contact. Adding those columns would mean inventing them here, so they are
              absent. A roster is a table away from being real, and until it exists this page
              counts the work instead of the worker.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
