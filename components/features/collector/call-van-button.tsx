"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { saveConsent, useConsent } from "@/lib/consent";

/**
 * [Call Van]: ask for a collection van at the spot the collector is standing on.
 *
 * Always a tap, never automatic. The position is the device's own fix, taken the way the
 * intake screen takes one (high accuracy, because a ward boundary can run down the middle
 * of a lane), and sent to `POST /api/heatmap/call-van`, which files it to its ~150 m cell
 * and drops an open site on the map. Tapping is the choice: a collector who has not
 * answered the cookie notice has now answered it for location, the same rule
 * `live-analysis.tsx` follows. One who declined location there can still call — the tap
 * is asked for, not assumed — and the browser's own permission prompt still decides.
 */

type CallState =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "sending" }
  | { kind: "called"; areaName: string; code: string; repeated: boolean; assigned: boolean }
  | { kind: "failed"; message: string };

type Fix = { latitude: number; longitude: number; accuracyM: number };

function locate(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This device cannot report a location, so a van cannot be called from it."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        }),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? "Location is blocked for this site. Allow it in the browser's site settings, then call again."
              : "The device could not find its position. Step outside or wait a moment, then call again.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}

export function CallVanButton() {
  const router = useRouter();
  const consent = useConsent();
  const [state, setState] = useState<CallState>({ kind: "idle" });
  const [refreshing, startTransition] = useTransition();
  const busy = state.kind === "locating" || state.kind === "sending" || refreshing;

  async function call() {
    if (consent === null) saveConsent(true);
    setState({ kind: "locating" });
    let fix: Fix;
    try {
      fix = await locate();
    } catch (error) {
      setState({ kind: "failed", message: (error as Error).message });
      return;
    }

    setState({ kind: "sending" });
    try {
      const response = await fetch("/api/heatmap/call-van", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fix),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok: true; code: string; status: string; areaName: string; repeated: boolean }
        | { message?: string }
        | null;
      if (!response.ok || !body || !("ok" in body)) {
        const message = body && "message" in body ? body.message : undefined;
        setState({ kind: "failed", message: message ?? `The call was not recorded (${response.status}).` });
        return;
      }
      setState({
        kind: "called",
        areaName: body.areaName,
        code: body.code,
        repeated: body.repeated,
        assigned: body.status === "van_assigned",
      });
      startTransition(() => router.refresh());
    } catch {
      setState({ kind: "failed", message: "The call did not reach the server. Check the connection and call again." });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void call()} disabled={busy}>
          {state.kind === "locating" ? "Finding you…" : state.kind === "sending" ? "Calling…" : "Call Van"}
        </Button>
        <span className="text-[12px] leading-snug text-ink-muted">
          Uses this device&rsquo;s location once. Only the ~150 m cell is kept, never the exact spot.
        </span>
      </div>
      <p role="status" aria-live="polite" className="text-[13px] leading-relaxed">
        {state.kind === "called" ? (
          <span className="text-ink">
            {state.assigned
              ? `A van is already assigned to this spot in ${state.areaName}. Your call was added to it.`
              : state.repeated
                ? `This spot in ${state.areaName} had already called a van; the call is refreshed and stays open on the map.`
                : `Van called to ${state.areaName}. The spot is on the map as an open site until an operator assigns a van.`}{" "}
            <span className="font-mono text-[11px] text-ink-muted">{state.code}</span>
          </span>
        ) : state.kind === "failed" ? (
          <span className="text-hazard-ink">{state.message}</span>
        ) : null}
      </p>
    </div>
  );
}
