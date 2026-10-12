"use client";

import { useState } from "react";

import { CollectorPhone, PhoneFrame } from "./collector-phone";
import { RecyclerGate } from "./recycler-gate";
import { Button } from "@/components/ui/button";
import type { HandoffLoad } from "@/lib/pickup/load";

/**
 * The split-screen demo: the collector's phone on the left, the recycler's gate on the
 * right, one load moving between them. When the phone routes, the gate opens that load,
 * so the recording never shows anyone copying an id.
 *
 * "New handoff" remounts both halves rather than deleting anything — loads are the
 * compliance trail and the API has no delete — so each take starts from a fresh load
 * and the previous one stays in the table, settled and paid.
 */
export function HandoffDemo({
  load,
  canRoute = true,
  canSettle = true,
}: {
  load: HandoffLoad;
  /** Whether this seat holds the phone's step (`/handoff`) and the gate's (`/gate`). */
  canRoute?: boolean;
  canSettle?: boolean;
}) {
  const [run, setRun] = useState(0);
  const [pickupId, setPickupId] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-[3px] border-ink pb-4">
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-copper">Feature 04 · live demo</p>
          <h1 className="mt-1 font-display text-3xl uppercase leading-[0.95] tracking-tight sm:text-4xl">
            Smart pickup &amp; digital credit
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            Collector hands over a hazardous load → PIN on the phone → recycler weighs and verifies → credit note → DynamoDB Stream → UPI payout.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setPickupId(null);
            setRun((value) => value + 1);
          }}
        >
          New handoff
        </Button>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <section aria-label="Collector's phone" className="xl:sticky xl:top-6">
          <p className="mb-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">Kabadiwala · mobile</p>
          <PhoneFrame>
            <CollectorPhone key={run} load={load} onRouted={setPickupId} canRoute={canRoute} />
          </PhoneFrame>
        </section>
        <section aria-label="Recycler's gate terminal">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">Authorised recycler · desktop</p>
          <RecyclerGate key={`${run}:${pickupId ?? ""}`} pickupId={pickupId} canSettle={canSettle} />
        </section>
      </div>
    </div>
  );
}
