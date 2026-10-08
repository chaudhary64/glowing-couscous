"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { formatConfidence } from "@/lib/format";
import type { BadgeTone } from "@/lib/tone";
import type { PendingDecision, RefusedCase } from "@/lib/types";

type ActionId = "recyclable" | "reuse" | "reject";

interface Action {
  id: ActionId;
  label: string;
  variant: ButtonVariant;
  tone: BadgeTone;
  outcome: string;
  note: string;
}

/**
 * The three ways a held item can leave this queue. Each one has a different
 * consequence, so the label says what happens rather than "approve"/"reject".
 */
const actions: Action[] = [
  {
    id: "recyclable",
    label: "Approve as recyclable",
    variant: "primary",
    tone: "verified",
    outcome: "Approved as recyclable",
    note: "Releases the valuation, then a pickup on a licensed line. This is the only action that mints a payable credit.",
  },
  {
    id: "reuse",
    label: "Send to reuse",
    variant: "secondary",
    tone: "copper",
    outcome: "Sent to reuse",
    note: "The unit goes to the reuse partner for refurbishment. No scrap credit is issued, and nothing is shredded.",
  },
  {
    id: "reject",
    label: "Reject as non-e-waste",
    variant: "danger",
    tone: "hazard",
    outcome: "Rejected as non-e-waste",
    note: "No credit is created and the collector is told which rule refused it, so the same upload is not repeated.",
  },
];

const actionById = new Map(actions.map((action) => [action.id, action]));

export function DecisionQueue({
  pending,
  refused,
}: {
  pending: PendingDecision[];
  refused: RefusedCase[];
}) {
  const [decisions, setDecisions] = useState<Record<string, ActionId>>({});

  const decided = pending.filter((record) => decisions[record.id]);
  const remaining = pending.length - decided.length;

  const decide = (id: string, action: ActionId) => {
    setDecisions((current) => ({ ...current, [id]: action }));
  };

  const undo = (id: string) => {
    setDecisions((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  return (
    <Panel
      eyebrow="Held items"
      title="Awaiting a decision"
      actions={
        <Badge tone={remaining > 0 ? "review" : "verified"}>
          {remaining > 0 ? `${remaining} open` : "Queue clear"}
        </Badge>
      }
    >
      {pending.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-soft">
          Nothing is held. Every upload today cleared the boolean on its own.
        </p>
      ) : null}

      <ul className="flex flex-col gap-px bg-rule">
        {pending.map((record) => {
          const decision = decisions[record.id];
          const chosen = decision ? actionById.get(decision) : undefined;

          return (
            <li key={record.id} className="bg-paper-raised p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                    {record.id} · submitted {record.submittedAt}
                  </p>
                  <h3 className="mt-1 text-base font-medium leading-snug">
                    {record.subject}
                  </h3>
                  <p className="mt-1 text-[12px] text-ink-muted">
                    Collected by {record.collector} · model confidence{" "}
                    <span className="font-mono">
                      {formatConfidence(record.confidence)}
                    </span>
                  </p>
                </div>
                {chosen ? (
                  <Badge tone={chosen.tone}>{chosen.outcome}</Badge>
                ) : (
                  <Badge tone="review">Awaiting decision</Badge>
                )}
              </div>

              <p className="mt-3 border-t border-rule pt-3 text-sm leading-relaxed text-ink-soft">
                {record.reason}
              </p>

              {chosen ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="max-w-xl text-[12px] leading-relaxed text-ink-soft">
                    {chosen.note}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => undo(record.id)}
                  >
                    Undo
                  </Button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {actions.map((action) => (
                    <Button
                      key={action.id}
                      type="button"
                      variant={action.variant}
                      onClick={() => decide(record.id, action.id)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 border-t border-rule pt-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          Decided this session · {decided.length}
        </p>
        {decided.length === 0 ? (
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
            No decisions taken yet. Choosing an action above records it here.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {decided.map((record) => {
              const chosen = actionById.get(decisions[record.id]);
              if (!chosen) return null;
              return (
                <li
                  key={record.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule-soft py-1.5 last:border-b-0"
                >
                  <span className="font-mono text-[12px] text-ink-muted">
                    {record.id}
                  </span>
                  <span className="text-[13px]">{record.subject}</span>
                  <span className="ml-auto">
                    <Badge tone={chosen.tone}>{chosen.outcome}</Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
          Decisions are held in this session only — nothing is written to DynamoDB
          and no credit note is created from this screen.
        </p>
      </div>

      <div className="mt-4 border-t border-rule pt-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          Already refused by a rule today
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {refused.map((record) => (
            <li key={record.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Badge tone="hazard">{record.rule}</Badge>
              <span className="font-mono text-[12px] text-ink-muted">{record.id}</span>
              <span className="text-[13px]">{record.subject}</span>
              <span className="text-[12px] text-ink-muted">— {record.reason}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
          These never reached this queue: a rule refused them before a credit could
          exist, which is cheaper than a model call.
        </p>
      </div>
    </Panel>
  );
}
