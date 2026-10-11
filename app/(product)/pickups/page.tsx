import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { mayOpen, RoleLink } from "@/components/ui/role-link";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { Field, FieldList } from "@/components/ui/field-list";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { simulatedNote } from "@/lib/disclaimer";
import { formatInr, formatMass, formatPct, formatTimestamp } from "@/lib/format";
import { listLoadEvents, listLoads } from "@/lib/pickup/directory";
import type { PickupEvent, PickupView } from "@/lib/pickup/types";
import { pickupLabel, pickupTone } from "@/lib/tone";

export const instant = false;

/**
 * The load board, read from the loads.
 *
 * This screen used to render six hand-authored loads, a five-person collector roster and
 * a table of logistics totals — `PU-8841`, `CN-2026-8838`, "23 open pickups", "₹1,13,050
 * of credits issued" — none of which any code wrote. Meanwhile `POST /pickups` had been
 * minting real loads into DynamoDB all along, with real credit notes and a real audit
 * trail, and the screen showed none of them.
 *
 * Every figure below is now a sum over those rows. The audit trail is the events the
 * service wrote in the same transaction as each state change, so it is the load's history
 * rather than a reconstruction of it.
 */

/** The words the API's event kinds read as on a screen. */
const EVENT_WORDS: Record<PickupEvent["kind"], string> = {
  routed: "Routed to a licensed destination",
  pin_issued: "Handoff PIN issued to the collector's phone",
  pin_reissued: "Handoff PIN reissued",
  pin_failed: "A wrong PIN was entered at the gate",
  pin_locked: "PIN locked after too many wrong attempts",
  pin_verified: "PIN verified at the gate",
  settled: "Weighed and settled — credit note issued",
  payout_sent: "Payout sent to the collector",
};

function routeText(load: PickupView): string {
  if (load.etaMinutes > 0) return `${load.distanceKm} km · ${load.etaMinutes} min`;
  return `${load.distanceKm} km`;
}

/** A load is open until it settles; there is no third state in the service. */
function isOpen(load: PickupView): boolean {
  return load.status !== "settled";
}

export default async function PickupsPage() {
  const user = await requireAccess("/pickups");

  const board = await listLoads(50);
  const loads = board.rows;
  const openLoads = loads.filter(isOpen);
  // The load the panel opens on: the newest one still moving, because that is the row an
  // operator can still act on. With everything settled it falls back to the newest load.
  const focus = openLoads[0] ?? loads[0] ?? null;
  const trail = focus ? await listLoadEvents(focus.pickupId) : null;

  const hazardous = loads.filter((load) => load.hazardous);
  const settledInr =
    loads.reduce((total, load) => total + Number(load.creditNoteAmountPaise ?? 0), 0) / 100;
  const declined = loads.filter(
    (load) => (load.routing?.refused?.length ?? 0) > 0,
  ).length;

  const notice = !board.configured
    ? "The pickup service is not connected, so no load can be read."
    : board.error
      ? `The load board could not be read: ${board.error}`
      : null;

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Operations · Pickups"
        title="Pickups"
        lede="Route every load to a licensed line, then settle the note against the weight the recycler actually took. Hazardous loads can only go to a destination authorised for that stream."
        actions={
          <>
            {mayOpen(user.role, "/recyclers") ? (
              <ButtonLink href="/recyclers" variant="secondary">
                Destinations
              </ButtonLink>
            ) : null}
            <ButtonLink href="/handoff" variant="secondary">
              Collector handoff
            </ButtonLink>
          </>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={notice ? "hazard" : "verified"}>
              {notice ? "No board" : "Read from the pickup service"}
            </Badge>
            {notice ? null : (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                {loads.length} load{loads.length === 1 ? "" : "s"} on the board ·{" "}
                {openLoads.length} open · {hazardous.length} hazardous
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
              label="Open loads"
              value={String(openLoads.length)}
              unit="loads"
              note={`${loads.length} on the board in total. A load is open until the gate settles it.`}
            />
            <Stat
              label="Hazardous share"
              value={formatPct(loads.length > 0 ? hazardous.length / loads.length : 0)}
              note={
                declined > 0
                  ? `${declined} load${declined === 1 ? "" : "s"} carried a refused candidate, so the router passed over a nearer site.`
                  : "Hazardous loads can only go to a destination authorised for that stream."
              }
            />
            <Stat
              label="Notes issued"
              value={String(loads.filter((load) => Boolean(load.creditNoteId)).length)}
              unit="notes"
              note="One note per settled load."
            />
            <Stat
              label="Settled to collectors"
              value={formatInr(settledInr)}
              emphasis
              note={simulatedNote("The sum of the notes on this board.")}
            />
          </StatGrid>

          <section>
            <SectionHeader
              eyebrow="Live board"
              title="All loads"
              note="Hazardous loads carry a mark in the left margin, because that flag is what restricts the destination."
            />

            <Surface className="mt-4">
              {loads.length === 0 ? (
                <p className="p-4 text-sm leading-relaxed text-ink-soft">
                  No load has been routed yet. A route on the collector handoff screen
                  appears here as soon as the service records it.
                </p>
              ) : (
                <>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Pickup</TH>
                        <TH>Collector</TH>
                        <TH>Item</TH>
                        <TH>Destination</TH>
                        <TH className="hidden lg:table-cell">Route</TH>
                        <TH>Status</TH>
                        <TH className="hidden md:table-cell">Credit note</TH>
                        <TH numeric>Settled</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {loads.map((load) => (
                        <TR
                          key={load.pickupId}
                          className={load.hazardous ? "border-l-[5px] border-l-hazard" : undefined}
                        >
                          <TD mono>
                            <span className="font-medium">{load.pickupId}</span>
                            {load.hazardous ? (
                              <p className="mt-1">
                                <Badge tone="hazard">Hazard</Badge>
                              </p>
                            ) : null}
                          </TD>
                          <TD>
                            <span className="font-medium">{load.collectorId}</span>
                            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                              {load.city}
                            </p>
                          </TD>
                          <TD>
                            <span>{load.streamLabel}</span>
                            <p className="mt-1 font-mono text-[11px] text-ink-muted">
                              {load.itemCode} · {formatMass(Number(load.declaredMassG ?? 0))}
                            </p>
                          </TD>
                          <TD>
                            <RoleLink
                              role={user.role}
                              href="/recyclers"
                              className="font-medium underline decoration-rule decoration-1 underline-offset-2 hover:decoration-copper"
                              plainClassName="font-medium"
                            >
                              {load.facilityName}
                            </RoleLink>
                            <p className="mt-1 font-mono text-[11px] text-ink-muted">
                              {load.cpcbLicense}
                            </p>
                          </TD>
                          <TD className="hidden font-mono text-[12px] text-ink-muted lg:table-cell">
                            {routeText(load)}
                          </TD>
                          <TD>
                            <Badge tone={pickupTone(load.status)}>
                              {pickupLabel(load.status)}
                            </Badge>
                          </TD>
                          <TD mono className="hidden text-[12px] md:table-cell">
                            {load.creditNoteId ?? "—"}
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
                    A settled row means the note was issued against weight verified at the
                    recycler gate. Nothing on this board is authored.
                  </p>
                </>
              )}
            </Surface>
          </section>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <section>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionHeader
                  eyebrow="Audit trail"
                  title={focus ? `${focus.pickupId}` : "No load to open"}
                  note="Every step the service recorded, in order."
                />
                {focus ? (
                  <Badge tone={pickupTone(focus.status)}>{pickupLabel(focus.status)}</Badge>
                ) : null}
              </div>

              {focus ? (
                <Panel className="mt-4" bodyClassName="p-4">
                  <FieldList columns={2} className="mb-5">
                    <Field label="Collector" value={focus.collectorId} />
                    <Field label="Destination" value={focus.facilityName} tone="muted" />
                    <Field
                      label="Stream"
                      value={`${focus.streamLabel}${focus.hazardous ? " · hazardous" : ""}`}
                    />
                    <Field
                      label="Declared mass"
                      value={formatMass(Number(focus.declaredMassG ?? 0))}
                      mono
                    />
                    <Field label="Pickup id" value={focus.pickupId} mono tone="copper" />
                    <Field
                      label="Credit note"
                      value={
                        focus.creditNoteId
                          ? `${focus.creditNoteId} · ${formatInr(
                              Number(focus.creditNoteAmountPaise ?? 0) / 100,
                            )}`
                          : "not issued yet"
                      }
                      mono
                      tone={focus.creditNoteId ? undefined : "muted"}
                    />
                  </FieldList>

                  {trail && trail.rows.length > 0 ? (
                    <ol className="flex flex-col border-t border-rule pt-3">
                      {trail.rows.map((event, index) => (
                        <li
                          key={`${event.at}-${event.kind}-${index}`}
                          className="flex gap-3 border-b border-rule-soft py-3 last:border-b-0"
                        >
                          <span className="w-32 shrink-0 font-mono text-[11px] tabular-nums text-ink-muted">
                            {formatTimestamp(event.at)}
                          </span>
                          <span className="min-w-0">
                            <span className="text-sm leading-snug">
                              {EVENT_WORDS[event.kind]}
                            </span>
                            {event.actorRole ? (
                              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                                {event.actorRole}
                              </p>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
                      {trail?.error
                        ? `The trail could not be read: ${trail.error}`
                        : "The service recorded no event for this load yet."}
                    </p>
                  )}

                  <p className="mt-3 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
                    A load with no licensed line is refused rather than recorded, which is
                    why the trail starts at “routed” and never at a failed attempt.
                  </p>
                </Panel>
              ) : (
                <Surface tone="inset" className="mt-4 p-4">
                  <p className="text-sm leading-relaxed text-ink-soft">
                    Nothing has been routed, so there is no trail to read.
                  </p>
                </Surface>
              )}
            </section>

            <aside className="flex flex-col gap-6 lg:sticky lg:top-16 lg:self-start">
              <Panel eyebrow="Destinations" title="Loads by facility">
                <ul className="flex flex-col">
                  {loads.length === 0 ? (
                    <li className="py-2 text-[13px] leading-relaxed text-ink-soft">
                      No load is on the board.
                    </li>
                  ) : (
                    [...new Set(loads.map((load) => load.facilityId))]
                      .sort((a, b) => a.localeCompare(b))
                      .map((facilityId) => {
                        const forFacility = loads.filter(
                          (load) => load.facilityId === facilityId,
                        );
                        const first = forFacility[0];
                        return (
                          <li
                            key={facilityId}
                            className="flex items-baseline justify-between gap-3 border-b border-rule-soft py-2 last:border-b-0"
                          >
                            <span className="min-w-0">
                              <span className="text-sm font-medium">
                                {first.facilityName}
                              </span>
                              <span className="mt-0.5 block font-mono text-[11px] text-ink-muted">
                                {first.cpcbLicense}
                              </span>
                            </span>
                            <span className="shrink-0 font-mono text-[13px] tabular-nums">
                              {forFacility.length} load
                              {forFacility.length === 1 ? "" : "s"}
                            </span>
                          </li>
                        );
                      })
                  )}
                </ul>

                {declined > 0 ? (
                  <div className="mt-4 border-t border-rule pt-3">
                    <p className="text-[12px] leading-relaxed text-ink-soft">
                      <span className="font-medium text-ink">
                        {declined} load{declined === 1 ? "" : "s"}
                      </span>{" "}
                      had at least one candidate refused by the router — a nearer facility
                      that was not authorised for the stream, usually. The refusal is
                      recorded on the load rather than discarded.
                    </p>
                  </div>
                ) : null}
              </Panel>

              <Panel eyebrow="Collector roster" title="No roster on file">
                <p className="text-sm leading-relaxed text-ink-soft">
                  Loads carry a collector id, because the service records who asked for the
                  route. Nothing provisions a collector record yet, so a name, a city and a
                  credit balance cannot be shown beside it — the id is the honest answer
                  rather than a placeholder name.
                </p>
              </Panel>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
