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
import { formatInr, formatMass, formatTimestamp } from "@/lib/format";
import { conditionTone, verdictLabel, verdictTone } from "@/lib/tone";
import type { StoredIntake } from "@/lib/types";

/**
 * The capture console, read from the record.
 *
 * This used to walk four authored fixtures, because four fixed submissions were the only
 * way to guarantee the four verdict paths were all on screen. They are not any more: the
 * pipeline writes a submission and its priced item together, so the console lists what
 * this database actually holds — newest first — and switching between them is a read of
 * rows an operator produced, not a tour of a fixture file. A voice submission shows the
 * Hindi transcript the recogniser returned, stored on the asset; a photo shows the vision
 * panel; nothing here is invented to fill a gap.
 */
export function IntakeConsole({
  intakes,
  canValue = true,
}: {
  intakes: StoredIntake[];
  /** Whether this role may open Valuations; an operator may not, so no link is shown. */
  canValue?: boolean;
}) {
  const [activeId, setActiveId] = useState(intakes[0]?.id ?? "");
  const active = intakes.find((intake) => intake.id === activeId) ?? intakes[0];

  if (!active) {
    return (
      <Surface className="mt-4 p-4">
        <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
          Nothing has been recorded yet, so there is no submission to open. Run a capture
          above and it appears here with the fields the model read out of it.
        </p>
      </Surface>
    );
  }

  const item = active.item;
  const subject =
    active.summary ?? (active.mode === "voice" ? "Hindi voice note" : "Photograph");

  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionHeader
          eyebrow="Recorded"
          title="Open a submission"
          note="The most recent submissions on file. Each one is a row the pipeline wrote when it priced the upload."
        />

        <div role="group" aria-label="Recorded submissions" className="mt-4 flex flex-wrap gap-2">
          {intakes.map((intake) => {
            const isActive = intake.id === active.id;
            return (
              <button
                key={intake.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveId(intake.id)}
                className={cn(
                  "border-[3px] px-3 py-2 text-left font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
                  isActive
                    ? "border-ink bg-ink text-paper"
                    : "border-rule bg-paper-raised text-ink-soft hover:border-ink hover:text-ink",
                )}
              >
                <span className="block">{intake.mode === "voice" ? "Voice" : "Photo"}</span>
                <span className="mt-0.5 block max-w-[22ch] truncate text-[10px] tracking-[0.06em] normal-case">
                  {intake.summary ?? intake.id}
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
              Captured {formatTimestamp(active.submittedAt)}
            </span>
          </div>

          <div className="p-4">
            {active.voiceNote ? (
              <VoiceNoteCard voiceNote={active.voiceNote} />
            ) : (
              <Panel eyebrow="Vision extraction" title="No text was typed">
                <p className="text-sm leading-relaxed text-ink-soft">
                  This intake arrived as a photograph. The vision model read the object
                  class, the brand plate and the hazard markers straight off the image, so
                  the collector never filled in a form.
                </p>
                <Surface
                  tone="inset"
                  className="mt-4 flex flex-col items-start gap-2 border-dashed px-4 py-6"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                    Stored submission
                  </span>
                  <span className="font-display text-base uppercase leading-tight tracking-tight">
                    {subject}
                  </span>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {active.fields[0]?.value ?? "Unclassified"} ·{" "}
                    {active.fields[0]
                      ? `${Math.round(active.fields[0].confidence * 100)}% match`
                      : "no field kept"}
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
          {active.fields.length > 0 ? (
            <ExtractionTable extracted={active.fields} />
          ) : (
            <Surface className="p-4">
              <p className="text-sm leading-relaxed text-ink-soft">
                No parsed field was kept for this submission — the route ran the
                identification pass only, so there is no per-field record to show.
              </p>
            </Surface>
          )}
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Handoff"
          title="Resolved to a priced item"
          note="Identification is only useful if it lands on a valuation the collector can accept."
        />
        {item ? (
          <Panel className="mt-4">
            <FieldList columns={2}>
              <Field label="Item" value={item.label} />
              <Field label="Item id" value={item.id} mono />
              <Field label="Category" value={item.category} />
              <Field label="Brand read" value={item.brand ?? "unread"} mono />
              <Field label="Mass" value={formatMass(item.massGrams)} mono />
              <Field label="Condition" value={item.condition} tone="muted" />
              <Field
                label="Net to collector"
                value={item.netToCollector === null ? "—" : formatInr(item.netToCollector)}
                mono
                tone="copper"
              />
              <Field
                label="EPR credit note"
                value={item.eprCreditNote ?? "not on file"}
                mono
                tone="muted"
              />
            </FieldList>

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
              {item.verdict ? (
                <Badge tone={verdictTone(item.verdict)}>{verdictLabel(item.verdict)}</Badge>
              ) : (
                <Badge tone="neutral">No verdict</Badge>
              )}
              <Badge tone={conditionTone(item.condition)}>{item.condition}</Badge>

              {item.verdict === "rejected" ? (
                <p className="text-[12px] leading-snug text-ink-muted">
                  No credit is issued for this item. The gatekeeper stops it before a rupee
                  is promised.
                </p>
              ) : (
                <p className="text-[12px] leading-snug text-ink-muted">
                  Clearance is confirmed before the credit note is minted.
                </p>
              )}

              {canValue ? (
                <Link
                  href={`/valuation?item=${encodeURIComponent(item.id)}`}
                  className="ml-auto border-[3px] border-ink bg-ink px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-paper transition-colors hover:bg-paper hover:text-ink"
                >
                  Open the valuation
                </Link>
              ) : null}
            </div>
          </Panel>
        ) : (
          <Surface className="mt-4 p-4">
            <p className="text-sm leading-relaxed text-ink-soft">
              This submission was priced without an item row — no item is joined to it, so
              there is nothing to open a valuation for.
            </p>
          </Surface>
        )}
      </section>
    </div>
  );
}
