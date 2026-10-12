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
        lede="Nothing is paid until this queue agrees. An item the model will not settle on its own waits here for a human, and only one of the three outcomes creates a payable credit. Every hold, refusal and decision below is a row this database holds."
        actions={<ButtonLink href="/intake">New intake</ButtonLink>}
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={configured ? "verified" : "hazard"}>
              {configured ? "Read from the database" : "No database"}
            </Badge>
            <Badge tone="neutral">
              Holdout evidence is authored — last trained {metricHoldout.lastTrained}
            </Badge>
            {counts ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                {counts.verified} cleared · {counts.held} held · {counts.rejected} refused,
                across {counts.itemsPriced} priced items
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
          note="Held because the model would not call it alone, not because it failed."
        />
        <Stat
          label="Refused before a credit"
          value={String(counts?.rejected ?? 0)}
          note="Verdicts recorded as rejected. Each keeps its evidence and can be looked up from the valuation id."
        />
        <Stat
          label="Cleared by the gatekeeper"
          value={String(counts?.verified ?? 0)}
          note={`${counts?.itemsPriced ?? 0} items priced in total, ${counts?.held ?? 0} of them on hold.`}
        />
        <Stat
          label="Decided today"
          value={String(counts?.decidedToday ?? 0)}
          unit="decisions"
          note="Decisions taken since midnight IST. A reload does not lose them."
        />
      </StatGrid>

      <section>
        <SectionHeader
          eyebrow="Judgement calls"
          title="Held for a human"
          note="Work the operator first, then the paperwork: rules, metrics and payout streams come after. Every action here is recorded; undo marks it undone rather than deleting it."
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
          The threshold is tuned for precision, not accuracy, because the two errors do not
          cost the same: a wrongly credited bottle pays the brand&rsquo;s EPR budget for
          material that never entered the formal route, while a wrongly rejected board only
          costs the collector a re-upload — the item still reaches a licensed recycler on
          the second attempt.
        </p>
      </Surface>

      <section>
        <SectionHeader
          eyebrow="Evidence"
          title="Refusals worth reading"
          note="Pulled from the same verdicts the valuation screen prices from, so the decision and the rupee figure line up."
        />

        {evidence.length === 0 ? (
          <Surface className="mt-5 p-4">
            <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
              {configured
                ? "No refusal is on file yet. Run something through the gatekeeper above that is not e-waste and it will be recorded here with the reason and the evidence behind it."
                : "This deployment has no records database, so a refusal cannot be recorded and there is nothing to read back. The gatekeeper above still refuses; the refusal is simply not kept."}
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
                  Refused by the automated gatekeeper at{" "}
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
          eyebrow="Model health · authored benchmark"
          title="Holdout metrics against target"
          note="Precision and recall are reported on the labelled holdout, not on live uploads. These are the published benchmark from the write-up and are not recomputed from the rows on this page."
        />
        <div className="mt-5">
          <MetricPanel />
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Controls"
          title="Rules that fire before a credit exists"
          note="R-01 to R-04 are the reasons a refusal can carry. The total is counted; the per-rule split is not recorded anywhere, so the table shows no per-rule counts."
        />
        <div className="mt-5">
          <RejectRules refused={counts?.rejected ?? null} />
        </div>
      </section>

      <section>
        <Panel eyebrow="Next" title="Where a clearance goes">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            Approving an item releases its valuation. Turning that release into a routed
            pickup with a credit note attached is feature 04, Smart Pickup &amp; Digital
            Credit, and it runs on the handoff screen — the approval recorded here is the
            state it starts from. A refusal or a reuse decision never reaches it, and no
            credit note is minted for either.
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
              only this state creates a payable credit.
            </span>
          </p>
        </Panel>
      </section>
    </div>
  );
}
