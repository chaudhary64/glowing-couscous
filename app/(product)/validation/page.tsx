import Link from "next/link";
import { MetricPanel } from "@/components/features/gatekeeper/metric-panel";
import { RejectRules } from "@/components/features/gatekeeper/reject-rules";
import { DecisionQueue } from "@/components/features/product/validation/decision-queue";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { Field, FieldList } from "@/components/ui/field-list";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stamp, VerdictMark } from "@/components/ui/stamp";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { getItem } from "@/lib/data/inventory";
import {
  blockedTotal,
  metricHoldout,
  modelMetrics,
  preventedCreditsInr,
  validationQueue,
} from "@/lib/data/model";
import { formatConfidence, formatInr, formatInrCompact } from "@/lib/format";
import type { PendingDecision, RefusedCase } from "@/lib/types";

export const instant = false;

/** Held records, shaped for the client queue so it never imports fixtures itself. */
const pending: PendingDecision[] = validationQueue
  .filter((record) => record.verdict === "review")
  .map((record) => ({
    id: record.id,
    subject: record.subject,
    collector: record.collector,
    submittedAt: record.submittedAt,
    confidence: record.confidence,
    reason: record.reason,
  }));

/**
 * The two refusals already in the fixture queue, with the rule that stopped each.
 * Derived rather than invented, so the queue and the rule table agree.
 */
const refusalRules: Record<string, string> = {
  "ECO-2026-0436": "R-01",
  "ECO-2026-0435": "R-03",
};

const refused: RefusedCase[] = validationQueue
  .filter((record) => record.verdict === "rejected")
  .map((record) => ({
    id: record.id,
    subject: record.subject,
    rule: refusalRules[record.id] ?? "R-01",
    reason: record.reason,
  }));

/** Same two cases the write-up argues from, kept as evidence on the working screen. */
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

export default async function ValidationQueuePage() {
  await requireAccess("/validation");

  const precision = modelMetrics.find((metric) => metric.label === "Precision");
  const falseCredit = modelMetrics.find(
    (metric) => metric.label === "False-credit rate",
  );

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Operations · Validation"
        title="Validation queue"
        lede="Nothing is paid until this queue agrees. An item the model will not settle on its own waits here for a human, and only one of the three outcomes creates a payable credit."
        actions={<ButtonLink href="/intake">New intake</ButtonLink>}
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone="ink">
              {metricHoldout.labelled.toLocaleString("en-IN")} labelled items in the
              holdout
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
          label="Awaiting a decision"
          value={String(pending.length)}
          unit="items"
          emphasis
          note="Held because the model would not call it alone, not because it failed."
        />
        <Stat
          label="Blocked before credit"
          value={blockedTotal.toLocaleString("en-IN")}
          note="Four rules, firing while the upload is still worth nothing."
        />
        <Stat
          label="Precision"
          value={precision ? formatConfidence(precision.value) : "—"}
          note="Of every item credited, this share is genuine e-waste."
        />
        <Stat
          label="False-credit rate"
          value={falseCredit ? formatConfidence(falseCredit.value) : "—"}
          note="Below target and known: the gap has to close before credits go live."
        />
      </StatGrid>

      <section>
        <SectionHeader
          eyebrow="Judgement calls"
          title="Two items held for a human"
          note="Work the operator first, then the paperwork: rules, metrics and payout streams come after."
        />
        <div className="mt-5">
          <DecisionQueue pending={pending} refused={refused} />
        </div>
      </section>

      <Surface tone="inset" className="p-4">
        <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
          The threshold is tuned for precision, not accuracy, because the two errors
          do not cost the same: a wrongly credited bottle pays the brand&rsquo;s EPR
          budget for material that never entered the formal route, while a wrongly
          rejected board only costs the collector a re-upload — the item still reaches
          a licensed recycler on the second attempt.
        </p>
      </Surface>

      <section>
        <SectionHeader
          eyebrow="Evidence"
          title="Two refusals worth reading"
          note="Pulled from the same inventory the valuation screen prices, so the rule and the rupee figure line up."
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
                  label="Stopped before"
                  value={formatInr(item.valuation.grossValue)}
                  mono
                  tone="muted"
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
                  See the withheld valuation
                </Link>
                <Stamp verdict={item.gatekeeper.verdict} angle={-4} />
              </div>

              <p className="mt-4 border-t border-dotted border-rule pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                Credit note {item.valuation.eprCreditNote} · refused by{" "}
                {item.gatekeeper.modelVersion} at {item.gatekeeper.checkedAt}
              </p>
            </Panel>
          ))}
        </div>
      </section>

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
          eyebrow="Controls"
          title="Rules that fire before a credit exists"
          note={`${blockedTotal} uploads stopped in the review period, about ${formatInrCompact(
            preventedCreditsInr,
          )} of simulated credits never issued.`}
        />
        <div className="mt-5">
          <RejectRules />
        </div>
      </section>

      <section>
        <Panel eyebrow="Next" title="Where a clearance goes">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            Approving an item releases its valuation, which then becomes a routed
            pickup with a credit note attached. A refusal or a reuse decision never
            reaches either screen, and no credit note is minted for it.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href="/valuation">Open valuations</ButtonLink>
            <ButtonLink href="/pickups" variant="secondary">
              Open pickups
            </ButtonLink>
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
