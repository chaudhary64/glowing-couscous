"use client";

import Link from "next/link";
import { useState } from "react";
import { ExtractionTable } from "@/components/features/intake/extraction-table";
import { VoiceNoteCard } from "@/components/features/intake/voice-note-card";
import { Badge } from "@/components/ui/badge";
import { Panel, Surface } from "@/components/ui/card";
import { Field, FieldList } from "@/components/ui/field-list";
import { SectionHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/cn";
import { formatInr, formatMass } from "@/lib/format";
import { conditionTone, verdictLabel, verdictTone } from "@/lib/tone";
import type { IntakeSample, ResolvedItemSummary } from "@/lib/types";

/**
 * The capture console. Switching between fixtures is the only interaction: each
 * one walks a different path — clean board, hazardous battery, oversized CRT, and
 * a bottle that must be refused.
 */
export function IntakeConsole({
  samples,
  resolved,
  canValue = true,
}: {
  samples: IntakeSample[];
  resolved: Record<string, ResolvedItemSummary>;
  /** Whether this role may open Valuations; an operator may not, so no link is shown. */
  canValue?: boolean;
}) {
  const [activeId, setActiveId] = useState(samples[0].id);
  const active = samples.find((sample) => sample.id === activeId) ?? samples[0];
  const item = resolved[active.id];

  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionHeader
          eyebrow="Capture"
          title="Choose an intake"
          note="Four fixtures, four different outcomes: credited, hazard-routed, held for review, refused."
        />

        <div role="group" aria-label="Intake fixtures" className="mt-4 flex flex-wrap gap-2">
          {samples.map((sample) => {
            const isActive = sample.id === active.id;
            return (
              <button
                key={sample.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveId(sample.id)}
                className={cn(
                  "border-[3px] px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
                  isActive
                    ? "border-ink bg-ink text-paper"
                    : "border-rule bg-paper-raised text-ink-soft hover:border-ink hover:text-ink",
                )}
              >
                <span className="block">{sample.mode === "voice" ? "Voice" : "Photo"}</span>
                <span className="mt-0.5 block max-w-[22ch] truncate text-[10px] tracking-[0.06em] normal-case">
                  {sample.subject}
                </span>
              </button>
            );
          })}
        </div>

        <Surface className="mt-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b-[3px] border-ink px-4 py-3">
            <Badge tone="ink">{active.id}</Badge>
            <Badge tone={active.mode === "voice" ? "copper" : "neutral"}>
              {active.mode === "voice" ? "Voice note" : "Photo upload"}
            </Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Captured {active.capturedAt}
            </span>
          </div>

          <div className="p-4">
            {active.voiceNote ? (
              <VoiceNoteCard voiceNote={active.voiceNote} />
            ) : (
              <Panel eyebrow="Vision extraction" title="No text was typed">
                <p className="text-sm leading-relaxed text-ink-soft">
                  This intake arrived as a single photo. Microsoft Foundry read the
                  object class, the brand plate and the hazard markers straight off
                  the image, so the collector never filled in a form.
                </p>
                <Surface
                  tone="inset"
                  className="mt-4 flex flex-col items-start gap-2 border-dashed px-4 py-6"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                    Photo fixture
                  </span>
                  <span className="font-display text-base uppercase leading-tight tracking-tight">
                    {active.subject}
                  </span>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {active.extracted[0]?.value ?? "Unclassified"} ·{" "}
                    {active.extracted[0]
                      ? `${Math.round(active.extracted[0].confidence * 100)}% match`
                      : "no match"}
                  </span>
                </Surface>
              </Panel>
            )}
          </div>
        </Surface>
      </section>

      <section>
        <SectionHeader
          eyebrow="Structured output"
          title="Fields read from the upload"
          note="Every field carries the model's own confidence, so a weak read is visible rather than hidden."
        />
        <div className="mt-4">
          <ExtractionTable extracted={active.extracted} />
        </div>
      </section>

      {item ? (
        <section>
          <SectionHeader
            eyebrow="Handoff"
            title="Resolved to a priced item"
            note="Identification is only useful if it lands on a valuation the collector can accept."
          />
          <Panel className="mt-4">
            <FieldList columns={2}>
              <Field label="Item" value={item.label} />
              <Field label="Item id" value={item.id} mono />
              <Field label="Category" value={item.category} />
              <Field label="Brand read" value={item.brand} mono />
              <Field label="Mass" value={formatMass(item.massGrams)} mono />
              <Field label="Condition" value={item.condition} tone="muted" />
              <Field
                label="Net to collector"
                value={formatInr(item.netToCollector)}
                mono
                tone="copper"
              />
              <Field label="EPR credit note" value={item.creditNote} mono tone="muted" />
            </FieldList>

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
              <Badge tone={verdictTone(item.verdict)}>
                {verdictLabel(item.verdict)}
              </Badge>
              <Badge tone={conditionTone(item.condition)}>{item.condition}</Badge>

              {item.verdict === "rejected" ? (
                <p className="text-[12px] leading-snug text-ink-muted">
                  No credit is issued for this item. The gatekeeper stops it before a
                  rupee is promised.
                </p>
              ) : (
                <p className="text-[12px] leading-snug text-ink-muted">
                  Clearance is confirmed before the credit note is minted.
                </p>
              )}

              {canValue ? (
                <Link
                  href="/valuation"
                  className="ml-auto border-[3px] border-ink bg-ink px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-paper transition-colors hover:bg-paper hover:text-ink"
                >
                  Open the valuation
                </Link>
              ) : null}
            </div>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
