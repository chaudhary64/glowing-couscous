import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { Meter } from "@/components/ui/meter";
import { formatConfidence } from "@/lib/format";
import type { ExtractedField } from "@/lib/types";

/**
 * What the models pulled out of the upload, with the confidence that matters more
 * than the value: a low-confidence read is the thing a human should double-check.
 */
export function ExtractionTable({
  extracted,
  caption,
}: {
  extracted: ExtractedField[];
  caption?: string;
}) {
  return (
    <Surface>
      <Table caption={caption}>
        <THead>
          <TR>
            <TH>Field</TH>
            <TH>Extracted value</TH>
            <TH>Read from</TH>
            <TH>Confidence</TH>
          </TR>
        </THead>
        <TBody>
          {extracted.map((field) => (
            <TR key={field.label}>
              <TD mono>{field.label}</TD>
              <TD className="font-medium">{field.value}</TD>
              <TD>
                <Badge tone={field.source === "voice" ? "copper" : "neutral"}>
                  {field.source === "voice" ? "Voice" : "Photo"}
                </Badge>
              </TD>
              <TD>
                <div className="flex items-center gap-3">
                  <Meter
                    value={field.confidence}
                    tone={field.confidence >= 0.5 ? "copper" : "lead"}
                    size="sm"
                    className="w-20 shrink-0"
                  />
                  <span className="font-mono text-[12px] tabular-nums text-ink-soft">
                    {formatConfidence(field.confidence)}
                  </span>
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Surface>
  );
}
