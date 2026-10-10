"use client";

import { useEffect, useState } from "react";

/**
 * What the operator watches while the model works: the photograph under a copper scan
 * beam, and the pipeline's steps ticking through beside it.
 *
 * The steps are paced by elapsed time, not by progress events — the route answers once,
 * at the end — so they are worded as what the pipeline does, the last one holds until
 * the answer arrives, and the panel says so. A progress bar that claimed a percentage
 * would be inventing a number.
 */

export type ScanMode = "valuation" | "intake" | "gatekeeper";

const STEPS: Record<ScanMode, (hasAudio: boolean) => string[]> = {
  valuation: () => [
    "Reading the photograph",
    "Identifying the item",
    "Assaying material fractions",
    "Pricing on the rate card",
    "Gatekeeper check",
  ],
  intake: (hasAudio) => [
    ...(hasAudio ? ["Transcribing the Hindi voice note"] : []),
    "Reading the photograph",
    "Extracting the intake fields",
    "Pricing on the rate card",
    "Gatekeeper check",
  ],
  gatekeeper: () => [
    "Reading the photograph",
    "Classifying the item",
    "Checking reject rules R-01 → R-04",
    "Deciding the verdict",
  ],
};

/** Roughly where each step falls in a typical 12–18 s call. */
const STEP_MS = 2600;

export function AnalysisScanner({
  mode,
  photo,
  hasAudio,
}: {
  mode: ScanMode;
  photo: { mimeType: string; dataBase64: string } | null;
  hasAudio: boolean;
}) {
  const steps = STEPS[mode](hasAudio);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - started), 100);
    return () => clearInterval(timer);
  }, []);

  const active = Math.min(steps.length - 1, Math.floor(elapsed / STEP_MS));
  const seconds = (elapsed / 1000).toFixed(1);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Analysing: ${steps[active]}`}
      className="analysis-scanner mt-4 grid gap-4 border-2 border-ink bg-ink p-4 text-paper md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
    >
      <div className="analysis-scanner__frame relative aspect-[4/3] overflow-hidden bg-[#0b0f12]">
        {photo ? (
          // A data URL of the photo the operator just picked — never a remote image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:${photo.mimeType};base64,${photo.dataBase64}`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-80 saturate-[0.7]"
          />
        ) : (
          <BoardSchematic />
        )}
        <div aria-hidden className="analysis-scanner__grid absolute inset-0" />
        <div aria-hidden className="analysis-scanner__beam absolute inset-x-0" />
        {(["tl", "tr", "bl", "br"] as const).map((corner) => (
          <span key={corner} aria-hidden data-c={corner} className="analysis-scanner__corner" />
        ))}
        <span
          aria-hidden
          className="absolute bottom-2 left-2 font-mono text-[10px] uppercase tracking-[0.16em] text-copper"
        >
          {hasAudio && !photo ? "Voice note · hi-IN" : "Foundry · gpt-4.1-mini"}
        </span>
        <span aria-hidden className="absolute bottom-2 right-2 font-mono text-[10px] tabular-nums text-paper/70">
          {seconds} s
        </span>
      </div>

      <div className="flex flex-col justify-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-copper">Live analysis</p>
        <ol className="mt-3 space-y-2.5">
          {steps.map((step, index) => {
            const state = index < active ? "done" : index === active ? "active" : "waiting";
            return (
              <li
                key={step}
                data-state={state}
                className="analysis-step flex items-center gap-3 font-mono text-[12px] tracking-[0.04em]"
              >
                <span aria-hidden className="analysis-step__dot" />
                <span>{step}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-[11px] leading-snug text-paper/55">
          Usually 10–20 seconds. The steps are the pipeline&rsquo;s order, not a live progress
          feed — the last one holds until the model answers.
        </p>
      </div>
    </div>
  );
}

/** Stand-in when there is no photo: a board drawn in copper, for the beam to cross. */
function BoardSchematic() {
  return (
    <svg viewBox="0 0 320 240" className="absolute inset-0 h-full w-full" fill="none" stroke="var(--color-copper)" strokeWidth="1.2" aria-hidden>
      <rect x="20" y="20" width="280" height="200" opacity="0.5" />
      <path d="M20 80h60l20 20h60l20-20h120M80 20v40l20 20M220 220v-40l-20-20h-40l-20-20v-40M300 160h-40l-10 10v50" opacity="0.6" />
      <rect x="120" y="100" width="60" height="44" opacity="0.8" />
      {Array.from({ length: 6 }, (_, i) => (
        <path key={i} d={`M${126 + i * 10} 100v-8M${126 + i * 10} 144v8`} opacity="0.8" />
      ))}
      <circle cx="80" cy="80" r="4" />
      <circle cx="240" cy="80" r="4" />
      <circle cx="150" cy="180" r="4" />
    </svg>
  );
}
