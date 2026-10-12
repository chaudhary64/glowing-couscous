"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchJson, usePoll } from "./use-poll";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { formatMass } from "@/lib/format";
import {
  formatPaise,
  isApiError,
  type CreditNoteView,
  type PickupEvent,
  type PickupView,
  type StreamRate,
} from "@/lib/pickup/types";

/**
 * The recycler's terminal at the gate: open the load, weigh it, type the PIN off the
 * collector's phone, issue the credit.
 *
 * The price preview beside the weight is arithmetic on the same rate card the Lambda
 * prices from, so the operator sees what the weighbridge figure will pay before they
 * commit — and sees the variance warning when it is far from what the collector
 * declared. The note the API returns is still the figure of record; the preview is
 * labelled as one.
 */

const POLL_MS = 2000;
const VARIANCE_LIMIT_PCT = 25;

type Outcome =
  | { kind: "success"; note: CreditNoteView }
  | { kind: "error"; code: string; message: string; attemptsRemaining?: number | null };

export function RecyclerGate({
  pickupId: suggested,
  canSettle = true,
}: {
  pickupId?: string | null;
  /** False for a seat that may watch the gate but not settle (an Operator on `/demo`). */
  canSettle?: boolean;
}) {
  const [idInput, setIdInput] = useState(suggested ?? "");
  const [pickup, setPickup] = useState<PickupView | null>(null);
  const [note, setNote] = useState<CreditNoteView | null>(null);
  const [events, setEvents] = useState<PickupEvent[]>([]);
  const [rates, setRates] = useState<StreamRate[]>([]);
  const [massKg, setMassKg] = useState("");
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const pinRefs = useRef<Array<HTMLInputElement | null>>([]);

  const apply = useCallback((status: number, body: unknown) => {
    if (status !== 200 || isApiError(body)) {
      setPickup(null);
      setLookupError(isApiError(body) ? body.error.message : `No load found (${status})`);
      return;
    }
    const loaded = body as { pickup: PickupView; creditNote: CreditNoteView | null };
    setLookupError(null);
    setOutcome(null);
    setEvents([]);
    setPickup(loaded.pickup);
    setNote(loaded.creditNote);
    setMassKg(String(loaded.pickup.declaredMassG / 1000));
    setDigits(["", "", "", ""]);
    setTimeout(() => pinRefs.current[0]?.focus(), 0);
  }, []);

  const open = (id: string) => {
    const trimmed = id.trim().toUpperCase();
    if (!trimmed) return;
    void fetchJson(`/api/pickup/${encodeURIComponent(trimmed)}`).then(({ status, body }) => apply(status, body));
  };

  // The split-screen demo hands the gate the load the phone just routed. The parent
  // keys this component on that id, so this runs once per load.
  useEffect(() => {
    if (!suggested) return;
    let cancelled = false;
    void fetchJson(`/api/pickup/${encodeURIComponent(suggested)}`).then(({ status, body }) => {
      if (!cancelled) apply(status, body);
    });
    return () => {
      cancelled = true;
    };
  }, [suggested, apply]);

  useEffect(() => {
    void fetchJson("/api/pickup/streams").then(({ status, body }) => {
      if (status === 200 && !isApiError(body)) setRates((body as { streams: StreamRate[] }).streams);
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!pickup) return;
    const [one, trail] = await Promise.all([
      fetchJson(`/api/pickup/${pickup.pickupId}`),
      fetchJson(`/api/pickup/${pickup.pickupId}/events`),
    ]);
    if (one.status === 200 && !isApiError(one.body)) {
      const loaded = one.body as { pickup: PickupView; creditNote: CreditNoteView | null };
      setPickup(loaded.pickup);
      setNote(loaded.creditNote);
    }
    if (trail.status === 200 && !isApiError(trail.body)) {
      setEvents((trail.body as { events: PickupEvent[] }).events);
    }
  }, [pickup]);

  // Poll until the payout lands, then stop: after that nothing about the load changes.
  usePoll(refresh, POLL_MS, Boolean(pickup) && pickup?.payoutStatus !== "paid");

  const rate = rates.find((entry) => entry.code === pickup?.stream);
  const weighedG = Math.round(Number(massKg) * 1000);
  const validMass = Number.isFinite(weighedG) && weighedG >= 1 && weighedG <= 500_000;
  const preview = useMemo(() => {
    if (!rate || !validMass) return null;
    const gross = Math.round((rate.ratePaisePerKg * weighedG) / 1000);
    const handling = Math.round((rate.handlingPaisePerKg * weighedG) / 1000);
    return { gross, handling, net: Math.max(0, gross - handling) };
  }, [rate, validMass, weighedG]);
  const variancePct = pickup && validMass
    ? ((weighedG - pickup.declaredMassG) / pickup.declaredMassG) * 100
    : 0;

  const pin = digits.join("");
  const settled = pickup?.status === "settled";
  const canSubmit = Boolean(pickup) && !settled && validMass && /^\d{4}$/.test(pin) && !busy;

  const setDigit = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "");
    if (clean.length > 1) {
      // A pasted PIN fills every box.
      const next = clean.slice(0, 4).padEnd(4, " ").split("").map((char) => char.trim());
      setDigits(next);
      pinRefs.current[Math.min(3, clean.length)]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    if (clean && index < 3) pinRefs.current[index + 1]?.focus();
  };

  const verify = async () => {
    if (!pickup || !canSubmit) return;
    setBusy(true);
    setOutcome(null);
    const { status, body } = await fetchJson(`/api/pickup/${pickup.pickupId}/settle`, {
      method: "POST",
      body: JSON.stringify({ pin, weighedMassG: weighedG }),
    });
    setBusy(false);
    if (status === 200 && !isApiError(body)) {
      const result = body as { pickup: PickupView; creditNote: CreditNoteView };
      setPickup(result.pickup);
      setNote(result.creditNote);
      setOutcome({ kind: "success", note: result.creditNote });
      void refresh();
      return;
    }
    setDigits(["", "", "", ""]);
    pinRefs.current[0]?.focus();
    setOutcome(
      isApiError(body)
        ? { kind: "error", code: body.error.code, message: body.error.message, attemptsRemaining: body.error.attemptsRemaining }
        : { kind: "error", code: "unknown", message: `Settlement failed (${status})` },
    );
    void refresh();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <div className="space-y-5">
        <Panel eyebrow="Step 1" title="Open the load">
          <form
            className="flex flex-wrap gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              open(idInput);
            }}
          >
            <label className="sr-only" htmlFor="gate-pickup-id">Pickup id</label>
            <input
              id="gate-pickup-id"
              value={idInput}
              onChange={(event) => setIdInput(event.target.value)}
              placeholder="PU-2026-0001"
              className="min-w-0 flex-1 border-[3px] border-ink bg-paper px-3 py-2 font-mono text-sm uppercase tracking-[0.08em]"
            />
            <Button type="submit" variant="secondary">Open</Button>
          </form>
          {lookupError ? <p role="alert" className="mt-3 text-sm text-hazard-ink">{lookupError}</p> : null}

          {pickup ? (
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">Load</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {pickup.streamLabel}
                {pickup.hazardous ? <Badge tone="hazard">Hazardous</Badge> : null}
              </dd>
              <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">Collector</dt>
              <dd>{pickup.collectorId}</dd>
              <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">Routed to</dt>
              <dd>{pickup.facilityName} · <span className="font-mono text-xs">{pickup.cpcbLicense}</span></dd>
              <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">Declared</dt>
              <dd>{formatMass(pickup.declaredMassG)}</dd>
              {pickup.routing?.refused?.length ? (
                <>
                  <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">Passed over</dt>
                  <dd className="text-ink-soft">
                    {pickup.routing.refused.map((entry) => `${entry.facilityId} (${entry.rule})`).join(", ")}
                  </dd>
                </>
              ) : null}
            </dl>
          ) : null}
        </Panel>

        {pickup ? (
          <Panel eyebrow="Step 2" title={settled ? "Settled" : "Weigh and verify"}>
            {settled ? (
              <SettledSummary pickup={pickup} note={note} />
            ) : (
              <div className="space-y-5">
                <div>
                  <label htmlFor="gate-mass" className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                    Weighbridge reading (kg)
                  </label>
                  <div className="mt-1 flex flex-wrap items-center gap-4">
                    <input
                      id="gate-mass"
                      inputMode="decimal"
                      value={massKg}
                      onChange={(event) => setMassKg(event.target.value)}
                      className="w-32 border-[3px] border-ink bg-paper px-3 py-2 font-mono text-lg tabular-nums"
                    />
                    {preview ? (
                      <p className="text-sm text-ink-soft">
                        Pays <span className="font-mono font-medium text-ink">{formatPaise(preview.net)}</span>
                        <span className="ml-2 font-mono text-[11px] text-ink-muted">
                          ({formatPaise(preview.gross)} − {formatPaise(preview.handling)} handling · preview)
                        </span>
                      </p>
                    ) : null}
                  </div>
                  {validMass && Math.abs(variancePct) > VARIANCE_LIMIT_PCT ? (
                    <p className="mt-2 border-l-[5px] border-review bg-sunken px-3 py-2 text-sm text-review-ink">
                      {variancePct > 0 ? "+" : ""}{variancePct.toFixed(1)}% against the declared {formatMass(pickup.declaredMassG)}.
                      The note will still issue, priced on this weight, and be flagged for review.
                    </p>
                  ) : null}
                </div>

                <fieldset>
                  <legend className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                    PIN from the collector&rsquo;s phone
                  </legend>
                  <div className="mt-2 flex gap-2">
                    {digits.map((digit, index) => (
                      <input
                        key={index}
                        ref={(element) => {
                          pinRefs.current[index] = element;
                        }}
                        aria-label={`PIN digit ${index + 1}`}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        // Locked while a check is in flight: the answer clears the boxes,
                        // and digits typed before it arrives would be wiped mid-entry.
                        disabled={busy}
                        value={digit}
                        onChange={(event) => setDigit(index, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Backspace" && !digits[index] && index > 0) pinRefs.current[index - 1]?.focus();
                          if (event.key === "Enter") void verify();
                        }}
                        className="size-14 border-[3px] border-ink bg-paper text-center font-mono text-2xl tabular-nums"
                      />
                    ))}
                  </div>
                  {pickup.handoff ? (
                    <p className="mt-2 font-mono text-[11px] text-ink-muted">
                      {pickup.handoff.locked
                        ? "Locked — the collector needs a new PIN"
                        : pickup.handoff.expired
                          ? "Expired — the collector needs a new PIN"
                          : `${pickup.handoff.attemptsRemaining} of 5 tries left`}
                    </p>
                  ) : null}
                </fieldset>

                {canSettle ? (
                  <Button type="button" onClick={verify} disabled={!canSubmit} className="w-full justify-center py-3 sm:w-auto">
                    {busy ? "Verifying…" : "Verify & issue credit"}
                  </Button>
                ) : (
                  <p className="border-l-[5px] border-review bg-sunken px-3 py-2 text-sm leading-relaxed text-ink-soft">
                    Settling is the Officer&rsquo;s step: an Officer signs in at the recycler gate, weighs
                    this load and types the collector&rsquo;s PIN. You can watch it settle here — the phone
                    turns green when the payout lands.
                  </p>
                )}
              </div>
            )}

            {outcome?.kind === "error" ? (
              <p role="alert" className="mt-4 border-l-[5px] border-hazard bg-sunken px-3 py-2 text-sm text-hazard-ink">
                {outcome.message}
                {outcome.code === "pin_mismatch" && typeof outcome.attemptsRemaining === "number"
                  ? ` ${outcome.attemptsRemaining} ${outcome.attemptsRemaining === 1 ? "try" : "tries"} left.`
                  : ""}
              </p>
            ) : null}
          </Panel>
        ) : null}
      </div>

      <Panel eyebrow="Audit trail" title="Every step, as written">
        {events.length ? (
          <ol className="space-y-3">
            {events.map((event) => (
              <li key={`${event.at}-${event.kind}`} className="flex gap-3 text-sm">
                <span className={`mt-1.5 inline-block size-2 shrink-0 ${eventTone(event.kind)}`} aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium">{eventLabel(event)}</p>
                  <p className="font-mono text-[11px] text-ink-muted">
                    {new Date(event.at).toLocaleTimeString("en-IN")}
                    {event.actorRole ? ` · ${event.actorRole}` : event.kind === "payout_sent" ? " · payout function" : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-muted">Open a load to see its trail.</p>
        )}
      </Panel>

      {outcome?.kind === "success" ? <GateToast note={outcome.note} paid={pickup?.payoutStatus === "paid"} /> : null}
    </div>
  );
}

function SettledSummary({ pickup, note }: { pickup: PickupView; note: CreditNoteView | null }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="verified" solid>Credit note {pickup.creditNoteId}</Badge>
        {pickup.payoutStatus === "paid" ? (
          <Badge tone="verified">UPI paid · {pickup.payoutRef}</Badge>
        ) : (
          <Badge tone="review">UPI payout pending</Badge>
        )}
        {note?.flags.includes("mass_variance") ? <Badge tone="review">Mass variance · review</Badge> : null}
      </div>
      {note ? (
        <p>
          <span className="font-display text-3xl tracking-tight">{formatPaise(note.amountPaise)}</span>
          <span className="ml-3 font-mono text-[11px] text-ink-muted">
            {formatMass(note.massG)} × ₹{(note.ratePaisePerKg / 100).toFixed(2)}/kg − ₹{(note.handlingPaisePerKg / 100).toFixed(2)}/kg handling
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** The desktop's success notification: fixed to the corner, so it reads in a split-screen video. */
function GateToast({ note, paid }: { note: CreditNoteView; paid: boolean }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 9000);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div role="status" className="handoff-upi fixed bottom-6 right-6 z-30 w-[min(360px,calc(100vw-3rem))] border-[3px] border-verified bg-paper-raised p-4 ">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-verified">Handoff verified</p>
      <p className="mt-1 font-display text-3xl tracking-tight">{formatPaise(note.amountPaise)}</p>
      <p className="mt-1 text-sm text-ink-soft">
        Credit note {note.noteId} issued. {paid ? "UPI payment sent to the collector." : "Sending UPI payment…"}
      </p>
    </div>
  );
}

function eventLabel(event: PickupEvent): string {
  const details = event.details as Record<string, unknown>;
  switch (event.kind) {
    case "routed":
      return `Routed to ${String(details.facilityId ?? "")}`;
    case "pin_issued":
      return "Handoff PIN issued to the phone";
    case "pin_reissued":
      return "New PIN issued — previous one revoked";
    case "pin_failed":
      return `Wrong PIN entered (attempt ${String(details.attempt ?? "?")})`;
    case "pin_locked":
      return "PIN locked after 5 wrong attempts";
    case "pin_verified":
      return "PIN verified at the gate";
    case "settled":
      return `Settled · ${formatPaise(Number(details.amountPaise ?? 0))} on ${formatMass(Number(details.weighedMassG ?? 0))}`;
    case "payout_sent":
      return `UPI payout sent · ref ${String(details.ref ?? "")}`;
    default:
      return event.kind;
  }
}

function eventTone(kind: PickupEvent["kind"]): string {
  if (kind === "pin_failed" || kind === "pin_locked") return "bg-hazard";
  if (kind === "settled" || kind === "payout_sent" || kind === "pin_verified") return "bg-verified";
  return "bg-copper";
}
