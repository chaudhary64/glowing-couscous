import { Badge } from "@/components/ui/badge";
import { Panel, Surface } from "@/components/ui/card";
import { Field, FieldList } from "@/components/ui/field-list";
import { MeterRow } from "@/components/ui/meter";
import { metricHoldout, modelMetrics, thresholdNote } from "@/lib/data/model";
import { formatConfidence } from "@/lib/format";

/**
 * Not every metric improves by going up: a lower false-credit rate is better, so
 * "did we hit target" cannot be one `>=` comparison across the table.
 */
const lowerIsBetter = new Set(["False-credit rate"]);

export function MetricPanel() {
  const metrics = modelMetrics.map((metric) => {
    const inverted = lowerIsBetter.has(metric.label);
    const met = inverted
      ? metric.value <= metric.target
      : metric.value >= metric.target;

    return { ...metric, met, direction: inverted ? "max" : "min" };
  });

  const gaps = metrics.filter((metric) => !metric.met);

  return (
    <Panel
      eyebrow="Holdout evaluation"
      title="Metric panel"
      actions={
        <Badge tone={gaps.length > 0 ? "review" : "verified"}>
          {gaps.length > 0 ? `${gaps.length} below target` : "All at target"}
        </Badge>
      }
    >
      <div className="flex flex-col">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="border-b border-rule-soft py-1 last:border-b-0"
          >
            <MeterRow
              label={metric.label}
              value={metric.value}
              target={metric.target}
              tone={metric.met ? "copper" : "review"}
              display={`${formatConfidence(metric.value)} · target ${metric.direction} ${formatConfidence(metric.target)}`}
              note={metric.note}
            />
            {metric.met ? null : (
              <p className="pb-2">
                <Badge tone="review">Below target</Badge>
              </p>
            )}
          </div>
        ))}
      </div>

      <Surface tone="inset" className="mt-4 p-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
          Operating point
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">
          {thresholdNote}
        </p>
      </Surface>

      <FieldList columns={2} className="mt-5">
        <Field
          label="Labelled holdout"
          value={metricHoldout.labelled.toLocaleString("en-IN")}
          mono
        />
        <Field
          label="Positives / negatives"
          value={`${metricHoldout.positives.toLocaleString("en-IN")} / ${metricHoldout.negatives.toLocaleString("en-IN")}`}
          mono
        />
        <Field label="Reviewers" value={metricHoldout.reviewedBy} />
        <Field label="Last trained" value={metricHoldout.lastTrained} mono />
      </FieldList>
    </Panel>
  );
}
