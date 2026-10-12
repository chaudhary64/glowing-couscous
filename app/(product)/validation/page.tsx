import Link from "next/link";
import { LiveAnalysis } from "@/components/features/ai/live-analysis";
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
import { scopeForUser } from "@/lib/records/scope";
import { metricHoldout } from "@/lib/data/model";
import { formatConfidence, formatInr, formatIstStamp, formatMass } from "@/lib/format";
import {
  listPendingHolds,
  listRecentDecisions,
  listRefusedItems,
  storedCounts,
} from "@/lib/records/queues";

export const instant = false;

/**
 * The queue where a human closes what the model would not.
 *
 * This screen used to be the clearest example on the site of an interface over nothing:
 * its decisions were held in component state and its own footer said so, the queue was
 * eight authored rows, and the two refusals it displayed came from `lib/data/model.ts`.
 * The gap was never the design — the design is right, and the schema has a
 * `validation_decisions` table with an `undone_at` column waiting for exactly this — it
 * was that no row was ever written or read.
 *
 * Now all of it is a row. The pending queue is `gatekeeper_verdicts` at `review` with no
 * live decision against the item, the refusals are verdicts at `rejected`, and the
 * decision log is `validation_decisions` joined to whoever took each one. Reload the
 * page and the work is still there.
 *
 * One thing on this screen is still authored, and it says so where it appears: the holdout
 * metrics. That is not a gap this change could close — precision, recall and ROC-AUC need a
 * labelled holdout and a trained classifier. The reject-rule table names the prompt's rule
 * vocabulary and counts its total from `gatekeeper_verdicts`; it used to print a fabricated
 * per-rule split, and a firing is still a `rule_blocks` row that no code writes, so no rule
 * carries a count. Every count that comes from a row is counted, and everything else is
 * labelled.
 */

export default async function ValidationQueuePage() {
  const scope = await scopeForUser(await requireAccess("/validation"));

  const [snapshot, holds, refusals, decisions] = await Promise.all([
    storedCounts(scope),
    listPendingHolds(scope, 12),
    listRefusedItems(6),
    listRecentDecisions(8),
  ]);

  const counts = snapshot.counts;
  const configured = snapshot.configured;
  const readError = snapshot.error ?? holds.error ?? refusals.error ?? decisions.error;
  const evidence = refusals.rows.slice(0, 2);

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Operations · Validation"
        title="Validation queue"
        lede="Review items the automated check could not clear. Approve, send to reuse, or refuse each item."
        actions={<ButtonLink href="/intake">New intake</ButtonLink>}
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={configured ? "verified" : "hazard"}>
              {configured ? "Live records" : "Unavailable"}
            </Badge>
            <Badge tone="neutral">
              Benchmark · last trained {metricHoldout.lastTrained}
            </Badge>
            {counts ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                {counts.verified} cleared · {counts.held} held · {counts.rejected} refused ·{" "}
                {counts.itemsPriced} priced
              </span>
            ) : null}
            {readError ? (
              <span className="text-[12px] leading-snug text-hazard-ink">{readError}</span>
            ) : null}
          </div>
        }
      />

      <LiveAnalysis mode="gatekeeper" />

      <StatGrid columns={4}>
        <Stat
          label="Awaiting a decision"
          value={String(counts?.awaitingDecision ?? 0)}
          unit="items"
          emphasis
          note="Items that need a human decision."
        />
        <Stat
          label="Refused"
          value={String(counts?.rejected ?? 0)}
          note="Items rejected before credit."
        />
        <Stat
          label="Cleared"
          value={String(counts?.verified ?? 0)}
          note={`${counts?.itemsPriced ?? 0} priced in total · ${counts?.held ?? 0} held.`}
        />
        <Stat
          label="Decided today"
          value={String(counts?.decidedToday ?? 0)}
          unit="decisions"
          note="Decisions made since midnight."
        />
      </StatGrid>

      <section>
        <SectionHeader
          eyebrow="Review"
          title="Held for a human"
          note="Review held items and record a decision."
        />
        <div className="mt-5">
          <DecisionQueue
            pending={holds.rows}
            refused={refusals.rows}
            decisions={decisions.rows}
          />
        </div>
      </section>

      <Surface tone="inset" className="p-4">
        <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
          The check favors precision: approving the wrong item creates an invalid credit,
          while a rejected item can be submitted again.
        </p>
      </Surface>

      <section>
        <SectionHeader
          eyebrow="Evidence"
          title="Refusals worth reading"
          note="Examples of items rejected before review."
        />

        {evidence.length === 0 ? (
          <Surface className="mt-5 p-4">
            <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
              {configured
                ? "No refusals recorded yet."
                : "No database is connected, so refusals cannot be saved or listed here."}
            </p>
          </Surface>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {evidence.map((item) => (
              <Panel
                key={item.id}
                eyebrow={`${item.gatekeeper?.matchedClass ?? "Unclassified"} · ${item.id}`}
                title={item.label}
                actions={
                  item.gatekeeper ? (
                    <VerdictMark verdict={item.gatekeeper.verdict} />
                  ) : undefined
                }
              >
                <p className="text-sm leading-relaxed text-ink-soft">
                  {item.gatekeeper?.reason ?? "No reason was recorded with this verdict."}
                </p>

                <FieldList columns={2} className="mt-4">
                  <Field
                    label="Confidence"
                    value={
                      item.gatekeeper
                        ? formatConfidence(item.gatekeeper.confidence)
                        : "—"
                    }
                    mono
                    tone="hazard"
                  />
                  <Field
                    label="Stopped before"
                    value={formatInr(item.valuation?.grossValue ?? 0)}
                    mono
                    tone="muted"
                  />
                  <Field label="Mass" value={formatMass(item.massGrams)} mono />
                  <Field
                    label="Submission"
                    value={item.intakeCode ?? "not recorded"}
                    mono
                    tone="muted"
                  />
                  {(item.gatekeeper?.signals ?? []).slice(0, 2).map((signal) => (
                    <Field
                      key={`${signal.label}-${signal.value}`}
                      label={signal.label}
                      value={signal.value}
                      mono
                    />
                  ))}
                </FieldList>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
                  <Link
                    href={`/valuation?item=${encodeURIComponent(item.id)}`}
                    className="font-mono text-[11px] uppercase tracking-[0.12em] underline decoration-rule underline-offset-2 hover:decoration-copper"
                  >
                    See the withheld valuation
                  </Link>
                  {item.gatekeeper ? (
                    <Stamp verdict={item.gatekeeper.verdict} angle={-4} />
                  ) : null}
                </div>

                <p className="mt-4 border-t border-dotted border-rule pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                  Rejected at{" "}
                  {item.gatekeeper
                    ? formatIstStamp(item.gatekeeper.checkedAt)
                    : "an unrecorded time"}
                </p>
              </Panel>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          eyebrow="Benchmark"
          title="Model performance"
          note="These results come from a labelled test set, not live uploads."
        />
        <div className="mt-5">
          <MetricPanel />
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Controls"
          title="Rejection rules"
          note="Rules that can reject an item before review."
        />
        <div className="mt-5">
          <RejectRules refused={counts?.rejected ?? null} />
        </div>
      </section>

      <section>
        <Panel eyebrow="Next step" title="After approval">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            Approval releases the valuation for handoff and pickup. Reuse and refusal do
            not create a credit note.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href="/valuation">Open valuations</ButtonLink>
            <ButtonLink href="/handoff" variant="secondary">
              Open handoff
            </ButtonLink>
          </div>
          <p className="mt-4 flex items-center gap-2">
            <Badge tone="verified">Verified</Badge>
            <span className="text-[12px] text-ink-muted">
              only approved items can create a credit.
            </span>
          </p>
        </Panel>
      </section>
    </div>
  );
}
