import Link from "next/link";
import { MetricPanel } from "@/components/features/gatekeeper/metric-panel";
import { RejectRules } from "@/components/features/gatekeeper/reject-rules";
import { ValidationQueue } from "@/components/features/gatekeeper/validation-queue";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/card";
import { Field, FieldList } from "@/components/ui/field-list";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Stamp, VerdictMark } from "@/components/ui/stamp";
import { Stat, StatGrid } from "@/components/ui/stat";
import { getFeature } from "@/lib/data/features";
import { getItem } from "@/lib/data/inventory";
import {
  blockedTotal,
  metricHoldout,
  modelMetrics,
  preventedCreditsInr,
} from "@/lib/data/model";
import { formatConfidence, formatInrCompact } from "@/lib/format";

/** Kept in the same order as the rules they demonstrate: R-01, then R-03. */
const evidenceCases = [
  {
    rule: "R-01",
    headline: "A bottle submitted as e-waste",
    item: getItem("ECO-2026-0436"),
  },
  {
    rule: "R-03",
    headline: "A working phone that must not be shredded",
    item: getItem("ECO-2026-0435"),
  },
];

export default function GatekeeperPage() {
  const feature = getFeature("gatekeeper");

  const precision = modelMetrics.find((metric) => metric.label === "Precision");
  const falseCredit = modelMetrics.find(
    (metric) => metric.label === "False-credit rate",
  );

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        feature={feature}
        lede="Every upload passes a valid/invalid boolean before a credit is minted. This screen is the evidence that the boolean is worth trusting."
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone="ink">
              {metricHoldout.labelled.toLocaleString("en-IN")} labelled items
            </Badge>
            <Badge tone="neutral">
              {metricHoldout.positives.toLocaleString("en-IN")} positive ·{" "}
              {metricHoldout.negatives.toLocaleString("en-IN")} negative
            </Badge>
            <Badge tone="neutral">Last trained {metricHoldout.lastTrained}</Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Reviewed by {metricHoldout.reviewedBy}
            </span>
          </div>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Precision"
          value={precision ? formatConfidence(precision.value) : "—"}
          note="Of every item credited, this share is genuine e-waste."
        />
        <Stat
          label="False-credit rate"
          value={falseCredit ? formatConfidence(falseCredit.value) : "—"}
          note="Target ≤ 5% and not there yet. The gap has to close before credits go live."
        />
        <Stat
          label="Blocked before credit"
          value={blockedTotal.toLocaleString("en-IN")}
          note="Four rules, firing while the upload is still worth nothing."
        />
        <Stat
          label="Credits prevented"
          value={formatInrCompact(preventedCreditsInr)}
          emphasis
          note="Simulated credits those blocked uploads would have drawn, at the median payout."
        />
      </StatGrid>

      <section>
        <SectionHeader
          eyebrow="Model health"
          title="Holdout metrics against target"
          note="Precision and recall are reported on the labelled holdout, not on live uploads."
        />
        <div className="mt-5">
          <MetricPanel />
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Threshold"
          title="The trade-off we tuned against"
          note="The two errors do not cost the same, so they are not weighed the same."
        />
        <div className="mt-5 grid gap-px border border-rule bg-rule sm:grid-cols-2">
          <div className="bg-paper-raised p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-hazard">
              Cost of a false credit
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              A bottle, a screenshot or a resubmitted photo draws a credit note.
              The brand&apos;s EPR budget pays out for material that never entered
              the formal route, and the compliance claim becomes worthless.
            </p>
          </div>
          <div className="bg-paper-raised p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-copper">
              Cost of a false rejection
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              A genuine board is turned away. The collector re-uploads, loses a few
              minutes, and the item still reaches a licensed recycler on the second
              attempt.
            </p>
          </div>
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Decisions"
          title="Validation queue"
          note="Newest first. Rejected rows are the ones this feature exists for."
        />
        <div className="mt-5">
          <ValidationQueue />
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Fraud controls"
          title="Rules that fire before a credit exists"
          note="A rule is cheaper than a model call, so the cheap checks run first."
        />
        <div className="mt-5">
          <RejectRules />
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Evidence"
          title="Two real fraud cases, stopped"
          note="Pulled from the same fixture inventory the valuation screen prices."
        />

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {evidenceCases.map(({ rule, headline, item }) => (
            <Panel
              key={item.id}
              eyebrow={`Rule ${rule} · ${item.id}`}
              title={headline}
              actions={<VerdictMark verdict={item.gatekeeper.verdict} />}
            >
              <p className="text-sm leading-relaxed text-ink-soft">
                {item.gatekeeper.reason}
              </p>

              <FieldList columns={2} className="mt-4">
                <Field
                  label="Confidence"
                  value={formatConfidence(item.gatekeeper.confidence)}
                  mono
                  tone="hazard"
                />
                <Field
                  label="Matched class"
                  value={item.gatekeeper.matchedClass}
                  mono
                />
                {item.gatekeeper.signals.slice(0, 4).map((signal) => (
                  <Field
                    key={signal.label}
                    label={signal.label}
                    value={signal.value}
                    mono
                  />
                ))}
              </FieldList>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
                <Link
                  href="/valuation"
                  className="font-mono text-[11px] uppercase tracking-[0.12em] underline decoration-rule underline-offset-2 hover:decoration-copper"
                >
                  See it on the valuation screen
                </Link>
                <Stamp verdict={item.gatekeeper.verdict} angle={-4} />
              </div>

              <p className="mt-4 border-t border-dotted border-rule pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                Credit note {item.valuation.eprCreditNote} · decision made by{" "}
                {item.gatekeeper.modelVersion} at {item.gatekeeper.checkedAt}
              </p>
            </Panel>
          ))}
        </div>
      </section>

      <section>
        <Panel eyebrow="Next step" title="What clearances unlock">
          <p className="text-sm leading-relaxed text-ink-soft">
            A verified upload becomes a price on the valuation screen, then a routed
            pickup with a credit note attached. A rejected or review upload never
            reaches either.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/valuation"
              className="border-2 border-ink bg-ink px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-paper transition-colors hover:bg-paper hover:text-ink"
            >
              Open valuation
            </Link>
            <Link
              href="/pickups"
              className="border-2 border-ink px-4 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink transition-colors hover:bg-ink hover:text-paper"
            >
              Open pickup
            </Link>
          </div>
          <p className="mt-4 flex items-center gap-2">
            <Badge tone="verified">Verified</Badge>
            <span className="text-[12px] text-ink-muted">
              only this state creates a payable credit.
            </span>
          </p>
        </Panel>
      </section>
    </div>
  );
}
