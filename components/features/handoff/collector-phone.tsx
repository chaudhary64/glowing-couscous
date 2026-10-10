"use client";

import { useCallback, useEffect, useState } from "react";

import { UpiOverlay } from "./upi-overlay";
import { fetchJson, usePoll } from "./use-poll";
import { Badge } from "@/components/ui/badge";
import { formatMass } from "@/lib/format";
import type { DemoLoad } from "@/lib/pickup/demo";
import {
  formatPaise,
  isApiError,
  type CreditNoteView,
  type HandoffPin,
  type PickupView,
} from "@/lib/pickup/types";

/**
 * The kabadiwala's phone. One button, then one number: the PIN the recycler types at
 * the gate. Everything after that is read from the API — the phone never decides the
 * load settled or the money arrived, it polls and shows what the table says:
 *
 *   assigned          PIN on screen, minutes left, tries left
 *   settled/pending   "Verified at the gate — payment on its way"
 *   paid              the green UPI screen
 *
 * A locked or expired PIN gets a "new PIN" button rather than a dead end.
 */

type Stage = "idle" | "routing" | "waiting" | "verified" | "paid";

const POLL_MS = 1500;

export function CollectorPhone({
  load,
  onRouted,
}: {
  load: DemoLoad;
  /** Tells a split-screen parent which load the gate should open. */
  onRouted?: (pickupId: string) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [pickup, setPickup] = useState<PickupView | null>(null);
  const [note, setNote] = useState<CreditNoteView | null>(null);
  const [pin, setPin] = useState<HandoffPin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPaid, setShowPaid] = useState(true);

  const handOver = useCallback(async () => {
    setStage("routing");
    setError(null);
    const { status, body } = await fetchJson("/api/pickup/handoff", { method: "POST" });
    if (status !== 201 || isApiError(body)) {
      setStage("idle");
      setError(isApiError(body) ? body.error.message : `Routing failed (${status})`);
      return;
    }
    const routed = body as { pickup: PickupView; handoff: HandoffPin };
    setPickup(routed.pickup);
    setPin(routed.handoff);
    setStage("waiting");
    onRouted?.(routed.pickup.pickupId);
  }, [onRouted]);

  const newPin = useCallback(async () => {
    if (!pickup) return;
    setError(null);
    const { status, body } = await fetchJson(`/api/pickup/${pickup.pickupId}/pin`, { method: "POST" });
    if (status !== 200 || isApiError(body)) {
      setError(isApiError(body) ? body.error.message : `Could not issue a new PIN (${status})`);
      return;
    }
    const reissued = body as { pickup: PickupView; handoff: HandoffPin };
    setPickup(reissued.pickup);
    setPin(reissued.handoff);
  }, [pickup]);

  const refresh = useCallback(async () => {
    if (!pickup) return;
    const { status, body } = await fetchJson(`/api/pickup/${pickup.pickupId}`);
    if (status !== 200 || isApiError(body)) return; // try again next tick
    const next = body as { pickup: PickupView; creditNote: CreditNoteView | null };
    setPickup(next.pickup);
    setNote(next.creditNote);
    if (next.pickup.payoutStatus === "paid") setStage("paid");
    else if (next.pickup.status === "settled") setStage("verified");
  }, [pickup]);

  usePoll(refresh, POLL_MS, stage === "waiting" || stage === "verified");

  const handoff = pickup?.handoff;
  const blocked = Boolean(handoff?.locked || handoff?.expired);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-paper-raised text-ink">
      {/* status bar */}
      <div className="flex items-center justify-between border-b border-rule px-5 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
        <span>EcoEPR · Collector</span>
        <span>{load.collectorId}</span>
      </div>

      <div className="flex flex-1 flex-col px-5 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-copper">Namaste, {load.collectorName.split(" ")[0]}</p>
        <h2 className="mt-1 font-display text-2xl uppercase leading-tight tracking-tight">Today&rsquo;s load</h2>

        <div className="mt-4 border border-rule bg-paper p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium leading-snug">{load.label}</p>
            <Badge tone="hazard">Hazardous</Badge>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-y-1 font-mono text-[11px]">
            <dt className="text-ink-muted">Stream</dt>
            <dd className="text-right">{load.streamLabel}</dd>
            <dt className="text-ink-muted">Declared</dt>
            <dd className="text-right">{formatMass(load.declaredMassG)}</dd>
            {pickup ? (
              <>
                <dt className="text-ink-muted">To</dt>
                <dd className="truncate text-right">{pickup.facilityName}</dd>
                <dt className="text-ink-muted">Pickup</dt>
                <dd className="text-right">{pickup.pickupId}</dd>
              </>
            ) : null}
          </dl>
        </div>

        {stage === "idle" || stage === "routing" ? (
          <div className="mt-auto pt-6">
            <p className="mb-3 text-sm leading-relaxed text-ink-soft">
              Tap once at the recycler&rsquo;s gate. You&rsquo;ll get a 4-digit PIN to show them.
            </p>
            <button
              type="button"
              onClick={handOver}
              disabled={stage === "routing"}
              className="w-full border-2 border-ink bg-ink py-5 font-display text-2xl uppercase tracking-tight text-paper transition-colors hover:bg-paper hover:text-ink disabled:cursor-wait disabled:opacity-70"
            >
              {stage === "routing" ? "Routing…" : "Hand over e-waste"}
            </button>
          </div>
        ) : null}

        {stage === "waiting" && pin ? (
          <div className="mt-6 flex flex-1 flex-col items-center text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-muted">Show this PIN at the gate</p>
            <p
              aria-label={`Handoff PIN ${pin.pin.split("").join(" ")}`}
              className={`mt-3 font-mono text-7xl font-medium tabular-nums tracking-[0.18em] ${blocked ? "text-ink-muted line-through" : "text-ink"}`}
            >
              {pin.pin}
            </p>
            {blocked ? (
              <div className="mt-4 w-full border-2 border-hazard bg-hazard-tint p-3 text-sm text-hazard">
                {handoff?.locked ? "Too many wrong tries at the gate. This PIN is locked." : "This PIN has expired."}
                <button
                  type="button"
                  onClick={newPin}
                  className="mt-3 block w-full border-2 border-hazard bg-hazard py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:bg-paper hover:text-hazard"
                >
                  Get a new PIN
                </button>
              </div>
            ) : (
              <div className="mt-4 flex w-full justify-between font-mono text-[11px] text-ink-muted">
                <Countdown until={pin.expiresAt} />
                <span>{handoff?.attemptsRemaining ?? pin.maxAttempts} tries left</span>
              </div>
            )}
            <p className="mt-auto flex items-center gap-2 pt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
              <span className="inline-block size-2 animate-pulse bg-copper" aria-hidden />
              Waiting for the recycler
            </p>
          </div>
        ) : null}

        {stage === "verified" ? (
          <div className="mt-6 flex flex-1 flex-col items-center justify-center text-center" role="status">
            <Badge tone="verified" solid>Verified at gate</Badge>
            <p className="mt-4 font-display text-4xl tracking-tight">
              {note ? formatPaise(note.amountPaise) : "…"}
            </p>
            <p className="mt-2 text-sm text-ink-soft">Credit note {pickup?.creditNoteId} issued.</p>
            <p className="mt-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
              <span className="inline-block size-2 animate-pulse bg-verified" aria-hidden />
              UPI payment on its way
            </p>
          </div>
        ) : null}

        {stage === "paid" && !showPaid ? (
          <div className="mt-6 flex flex-1 flex-col items-center justify-center text-center">
            <Badge tone="verified" solid>Paid</Badge>
            <p className="mt-3 font-display text-4xl tracking-tight">{formatPaise(pickup?.payoutAmountPaise ?? 0)}</p>
            <p className="mt-1 font-mono text-[11px] text-ink-muted">UPI ref {pickup?.payoutRef}</p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 border-l-4 border-hazard bg-hazard-tint px-3 py-2 text-sm text-hazard">
            {error}
          </p>
        ) : null}
      </div>

      {stage === "paid" && showPaid && pickup?.payoutRef ? (
        <UpiOverlay
          amountPaise={pickup.payoutAmountPaise ?? 0}
          reference={pickup.payoutRef}
          vpa={pickup.payoutVpa ?? ""}
          noteId={pickup.creditNoteId ?? ""}
          paidAt={pickup.paidAt ?? new Date().toISOString()}
          onClose={() => setShowPaid(false)}
        />
      ) : null}
    </div>
  );
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");
  return <span>Valid {minutes}:{seconds}</span>;
}

/**
 * The device chrome, for the split-screen demo and the standalone phone page. Rounded,
 * unlike everything else in the product: it is a picture of a phone, not a surface of
 * the interface, and a square phone reads as a card.
 */
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[380px] rounded-[2.25rem] border-[10px] border-ink bg-ink shadow-[0_24px_48px_-24px_rgba(18,23,27,0.6)]">
      <div className="relative h-[720px] max-h-[calc(100svh-10rem)] min-h-[600px] overflow-hidden rounded-[1.6rem]">
        {children}
      </div>
    </div>
  );
}
