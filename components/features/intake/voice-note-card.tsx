import { Badge } from "@/components/ui/badge";
import { Panel, Surface } from "@/components/ui/card";
import { Field, FieldList } from "@/components/ui/field-list";
import { TypeOut } from "@/components/motion/type-out";
import type { VoiceNote } from "@/lib/types";

/**
 * The transcript is the loudest text on this screen on purpose. A collector
 * describes an item in Hindi, not in a category dropdown, and that sentence is the
 * evidence the whole pipeline rests on.
 */
/**
 * `engine` names whatever actually produced the transcript. It is a prop rather
 * than a constant because the answer changed once already: the pipeline reads the
 * audio directly now, so a hardcoded service name would have quietly become a
 * false claim on the screen.
 */
export function VoiceNoteCard({
  voiceNote,
  engine = "Azure Speech · hi-IN",
  typeOut = false,
}: {
  voiceNote: VoiceNote;
  engine?: string;
  /** Type a freshly returned transcript out on screen; fixtures render whole. */
  typeOut?: boolean;
}) {
  return (
    <Panel eyebrow="Speech to text" title="What the collector said">
      <Surface tone="inset" className="border-l-4 border-l-copper px-4 py-3.5">
        <p lang="hi" className="text-lg leading-relaxed text-ink">
          {typeOut ? <TypeOut text={voiceNote.transcript} /> : voiceNote.transcript}
        </p>
      </Surface>

      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        {voiceNote.translation}
      </p>

      <FieldList columns={3} className="mt-4">
        <Field label="Language" value={voiceNote.language} mono />
        <Field label="Clip length" value={`${voiceNote.durationSeconds} s`} mono />
        <Field label="Words" value={String(voiceNote.words)} mono />
      </FieldList>

      <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        <Badge tone="copper">{engine}</Badge>
        <span className="text-[12px] leading-snug text-ink-muted">
          No typing, no category sheet, no literacy requirement.
        </span>
      </p>
    </Panel>
  );
}
