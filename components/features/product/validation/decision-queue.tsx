"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { formatConfidence, formatInr, formatMass, formatTimestamp } from "@/lib/format";
import type { BadgeTone } from "@/lib/tone";
import type { StoredDecision, StoredItem } from "@/lib/types";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The queue that now remembers what a human decided.
 *
 * It used to hold its decisions in component state and admit it in the footer — "held in
 * this session only ... decisions vanish on reload" — which made the one screen whose
 * whole purpose is a human judgement the only one that forgot it had made one. Every
 * action here is now a `validation_decisions` row, through
 * `POST /api/validation/decision`, and the footer says what the table holds instead.
 *
 * Three consequences of that, all visible in the code below:
 *
 * 1. **Nothing is optimistic.** A decision's badge comes from the row, never from local
 *    state, so a write that failed cannot look like it landed. The request reports its own
 *    failure and the item stays where it is until the server says otherwise.
 * 2. **Undo is a server call too.** It marks `undone_at` — the row stays, because an
 *    audit trail that erased the first answer is not the trail a brand's auditor asks for
 *    — and the item returns to this queue.
 * 3. **It never imports the data layer.** `lib/records/*` reaches into `pg`, and a client
 *    bundle has no business carrying a database driver. The page hands rows down as props,
 *    the same bargain `EvidenceAsset` makes for the evidence viewer.
 */

type ActionId = "recyclable" | "reuse" | "reject";

interface Action {
  id: ActionId;
  label: string;
  variant: ButtonVariant;
}

/**
 * The three ways a held item can leave this queue. Each one has a different
 * consequence, so the label says what happens rather than "approve"/"reject". The
 * consequences are stated once beneath the buttons instead of on each of them.
 */
const actions: Action[] = [
  { id: "recyclable", label: "Approve as recyclable", variant: "primary" },
  { id: "reuse", label: "Send to reuse", variant: "secondary" },
  { id: "reject", label: "Reject as non-e-waste", variant: "danger" },
];

const DECISION_WORDS: Record<StoredDecision["decision"], string> = {
  approved_recyclable: "Approved as recyclable",
  sent_to_reuse: "Sent to reuse",
  rejected_non_ewaste: "Rejected as non-e-waste",
};

const DECISION_TONES: Record<StoredDecision["decision"], BadgeTone> = {
  approved_recyclable: "verified",
  sent_to_reuse: "copper",
  rejected_non_ewaste: "hazard",
};

export function DecisionQueue({
  pending,
  refused,
  decisions,
}: {
  pending: StoredItem[];
  refused: StoredItem[];
  decisions: StoredDecision[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  const live = decisions.filter((decision) => decision.undoneAt === null);

  async function decide(item: StoredItem, action: ActionId) {
    setBusy(item.id);
    setFailure(null);
    try {
      const response = await fetch("/api/validation/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item: item.id,
          decision: action,
          reason: item.gatekeeper?.matchedClass ?? null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      if (!response.ok) {
        setFailure({
          id: item.id,
          message:
            payload?.message ??
            `The decision was not recorded (HTTP ${response.status}). The item is still waiting.`,
        });
        return;
      }
      // The row is the state. A refresh re-reads the queue, the holds and the log, so
      // what is on screen afterwards is what the database holds.
      router.refresh();
    } catch {
      setFailure({
        id: item.id,
        message:
          "The browser could not reach the server, so nothing was recorded. The item is still waiting.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function undo(decision: StoredDecision) {
    setBusy(decision.id);
    setFailure(null);
    try {
      const response = await fetch(
        `/api/validation/decision?id=${encodeURIComponent(decision.id)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      if (!response.ok) {
        setFailure({
          id: decision.itemCode,
          message: payload?.message ?? `The decision could not be taken back (HTTP ${response.status}).`,
        });
        return;
      }
      router.refresh();
    } catch {
      setFailure({
        id: decision.itemCode,
        message: "The browser could not reach the server, so nothing changed.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel
        eyebrow="Held items"
        title="Awaiting a decision"
        actions={
          <Badge tone={pending.length > 0 ? "review" : "verified"}>
            {pending.length > 0 ? `${pending.length} open` : "Queue clear"}
          </Badge>
        }
      >
        {pending.length === 0 ? (
          <EmptyState title="Queue clear">
            Nothing is held. Every item on file either cleared the gatekeeper on its own or
            already has a decision recorded against it.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-px bg-rule">
            {pending.map((item) => {
              const verdict = item.gatekeeper;
              const working = busy === item.id;
              return (
                <li key={item.id} className="bg-paper-raised p-4">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                        {item.id} · priced {formatTimestamp(item.storedAt)}
                      </p>
                      <h3 className="mt-1 text-base font-medium leading-snug">{item.label}</h3>
                      <p className="mt-1 text-[12px] text-ink-muted">
                        {formatMass(item.massGrams)}
                        {item.brand ? ` · ${item.brand}` : " · plate unread"}
                        {item.hazards.length > 0
                          ? ` · ${item.hazards.length} hazard${item.hazards.length === 1 ? "" : "s"} flagged`
                          : ""}
                        {verdict ? (
                          <>
                            {" "}
                            · model confidence{" "}
                            <span className="font-mono">
                              {formatConfidence(verdict.confidence)}
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <Badge tone="review">Awaiting decision</Badge>
                  </div>

                  {verdict ? (
                    <p className="mt-3 border-t border-rule pt-3 text-sm leading-relaxed text-ink-soft">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                        {verdict.matchedClass}
                      </span>
                      <br />
                      {verdict.reason}
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {actions.map((action) => (
                      <Button
                        key={action.id}
                        type="button"
                        variant={action.variant}
                        disabled={working}
                        onClick={() => void decide(item, action.id)}
                      >
                        {action.label}
                      </Button>
                    ))}
                    <Link
                      href={`/valuation?item=${encodeURIComponent(item.id)}`}
                      className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
                    >
                      See the valuation →
                    </Link>
                  </div>

                  <p className="mt-2 text-[12px] leading-snug text-ink-muted">
                    Approving releases the valuation and promises a credit. Sending to
                    reuse and refusing both end the item without one — and both are
                    recorded, so &ldquo;why was this not paid?&rdquo; has an answer.
                  </p>

                  {failure?.id === item.id ? (
                    <p className="mt-3 border-2 border-hazard bg-hazard-tint p-3 text-[13px] leading-relaxed text-ink">
                      {failure.message}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        eyebrow="Recorded"
        title="Decisions on file"
        actions={<Badge tone="neutral">{live.length} live</Badge>}
      >
        {live.length === 0 ? (
          <EmptyState title="No decisions yet">
            No decision has been recorded yet. Choosing an action above writes a row here,
            and it is still on this list after a reload.
          </EmptyState>
        ) : (
          <ul className="flex flex-col">
            {live.map((decision) => {
              const working = busy === decision.id;
              return (
                <li
                  key={decision.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule-soft py-2 last:border-b-0"
                >
                  <span className="font-mono text-[12px] text-ink-muted">{decision.itemCode}</span>
                  <span className="text-[13px]">{decision.itemLabel}</span>
                  <Badge tone={DECISION_TONES[decision.decision]}>
                    {DECISION_WORDS[decision.decision]}
                  </Badge>
                  {decision.netToCollector !== null && decision.netToCollector > 0 ? (
                    <span className="font-mono text-[12px] tabular-nums">
                      {formatInr(decision.netToCollector)}
                    </span>
                  ) : null}
                  <span className="text-[12px] text-ink-muted">
                    {decision.decidedByName ?? "an unattributed operator"} ·{" "}
                    {formatTimestamp(decision.decidedAt)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="ml-auto"
                    disabled={working}
                    onClick={() => void undo(decision)}
                  >
                    Undo
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-4 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
          Every decision here is a <span className="font-mono">validation_decisions</span>{" "}
          row, so it survives a reload and a deploy. Taking one back marks it{" "}
          <span className="font-mono">undone_at</span> rather than deleting it — the row
          stays as the record that the answer was revisited — and the item returns to the
          queue above.
        </p>

        {failure && !pending.some((item) => item.id === failure.id) ? (
          <p className="mt-3 border-2 border-hazard bg-hazard-tint p-3 text-[13px] leading-relaxed text-ink">
            {failure.message}
          </p>
        ) : null}
      </Panel>

      <Panel eyebrow="Refused by the gatekeeper" title="Already turned away">
        {refused.length === 0 ? (
          <p className="text-sm leading-relaxed text-ink-soft">
            No refusal is on file. An item the gatekeeper rejects is recorded here, because
            &ldquo;show me what you turned away&rdquo; should have an answer.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {refused.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Badge tone="hazard">Rejected</Badge>
                <span className="font-mono text-[12px] text-ink-muted">{item.id}</span>
                <span className="text-[13px]">{item.label}</span>
                <span className="text-[12px] text-ink-muted">
                  — {item.gatekeeper?.matchedClass ?? "unclassified"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
          These never reached this queue: the model refused them before a credit could
          exist, and the refusal is a{" "}
          <span className="font-mono">gatekeeper_verdicts</span> row with its evidence
          archived beside it. The rule code that fired is not stored — a firing is a{" "}
          <span className="font-mono">rule_blocks</span> row and nothing writes those yet —
          so the matched class is shown instead of a rule number nobody could look up.
        </p>
      </Panel>
    </div>
  );
}
