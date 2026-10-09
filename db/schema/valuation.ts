import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  confidence,
  currency,
  money,
  percent,
  primaryKeyId,
  timestamps,
} from "./columns";
import { items, rateCards } from "./catalog";
import { decisionKind, metricDirection, verdictKind } from "./enums";
import { users } from "./identity";

/**
 * Valuation and the gatekeeper: what the material is worth, whether the material
 * is what it claims to be, and who decided to pay.
 *
 * The ordering in this file is the product's central claim. A valuation is
 * computed, a verdict is issued against it by the model, and a decision is taken
 * by a human. Three separate records, because "the AI said so" and "an officer
 * approved it" are different facts and only the last one creates money.
 */

/**
 * A priced item: the gross material value, the handling fee, what the collector
 * receives, and the EPR credit the brand can book.
 *
 * Versioned rather than overwritten. If a rate card is corrected, the old
 * valuation stays readable with a higher `version`, because a collector who was
 * already told a number is entitled to see that number.
 */
export const valuations = pgTable(
  "valuations",
  {
    id: primaryKeyId(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    version: integer("version").default(1).notNull(),

    /** The card in force at this moment. The audit trail for every rupee here. */
    rateCardId: uuid("rate_card_id").references(() => rateCards.id, {
      onDelete: "set null",
    }),

    grossValuePaise: money("gross_value_paise").notNull(),
    /** Deducted for hazardous handling and transport. */
    handlingFeePaise: money("handling_fee_paise").default(0).notNull(),
    /** What the collector is actually offered. Never negative. */
    netToCollectorPaise: money("net_to_collector_paise").notNull(),
    /** The brand's liability offset created by diverting this unit formally. */
    eprCreditPaise: money("epr_credit_paise").default(0).notNull(),

    currency: currency(),

    /** The card's own words for where these rates came from. */
    rateBasis: text("rate_basis"),
    /** After this moment the quote must be recomputed. A stale quote is not a quote. */
    validUntil: timestamp("valid_until", { withTimezone: true }),

    /** Plain-language line shown to the collector, e.g. "copper and gold, dead board". */
    summary: text("summary"),

    confidence: confidence("confidence"),
    model: text("model"),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    ...timestamps(),
  },
  (table) => [
    /** Serves both "the current valuation for an item" and the version history. */
    uniqueIndex("valuations_item_version_uq").on(table.itemId, table.version),
    check("valuations_net_chk", sql`${table.netToCollectorPaise} >= 0`),
    check("valuations_gross_chk", sql`${table.grossValuePaise} >= 0`),
  ],
);

/**
 * The gatekeeper's answer on one item.
 *
 * Three-valued, not boolean. `review` is the state this whole table exists for:
 * the model declining to decide is a result that must be recorded as loudly as an
 * approval, because it is what puts an item in front of a human instead of paying
 * out silently.
 *
 * Multiple rows per item are expected — a re-upload gets a fresh verdict — so
 * "the" verdict is the latest by `checked_at`.
 */
export const gatekeeperVerdicts = pgTable(
  "gatekeeper_verdicts",
  {
    id: primaryKeyId(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),

    verdict: verdictKind("verdict").notNull(),
    confidence: confidence("confidence").notNull(),

    /** Which model answered, e.g. eco-gate v0.4. */
    modelVersion: text("model_version").notNull(),
    /** The class it matched against, e.g. "E-waste · Class E5 batteries". */
    matchedClass: text("matched_class"),
    /** Why, in the reviewing officer's words. Shown verbatim in the queue. */
    reason: text("reason"),

    /** How good the input was. A 0.6 on a blurred photo is not the same as on a sharp one. */
    imageQualityPct: percent("image_quality_pct"),
    latencyMs: integer("latency_ms"),

    checkedAt: timestamp("checked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    /** Set when a human has looked at a `review` verdict, whatever they decided. */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    ...timestamps(),
  },
  (table) => [
    index("gatekeeper_verdicts_item_idx").on(table.itemId, table.checkedAt),
    index("gatekeeper_verdicts_verdict_idx").on(table.verdict),
    check(
      "gatekeeper_verdicts_confidence_chk",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
  ],
);

/**
 * One signal behind a verdict — "Brand plate read · Dell · 0.94".
 *
 * Kept as rows so the queue can show the two signals that actually decided a case
 * instead of dumping a model log, and so a signal that keeps firing on false
 * positives can be found by query rather than by reading transcripts.
 */
export const verdictSignals = pgTable(
  "verdict_signals",
  {
    id: primaryKeyId(),
    verdictId: uuid("verdict_id")
      .notNull()
      .references(() => gatekeeperVerdicts.id, { onDelete: "cascade" }),

    label: text("label").notNull(),
    value: text("value").notNull(),
    /** How much this signal moved the answer, when the model reports it. */
    weightPct: percent("weight_pct"),
    ordinal: integer("ordinal").default(0).notNull(),

    ...timestamps(),
  },
  (table) => [index("verdict_signals_verdict_idx").on(table.verdictId)],
);

/**
 * The human decision that closes a hold.
 *
 * Approving is the only outcome that creates a payable credit; sending to reuse
 * and refusing both end the item without money. `undoneAt` exists because the
 * queue offers an undo, and an audit trail that erased the first decision would be
 * exactly the trail a brand's auditor would ask for.
 */
export const validationDecisions = pgTable(
  "validation_decisions",
  {
    id: primaryKeyId(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /** The verdict being resolved. Null if the verdict was later purged. */
    verdictId: uuid("verdict_id").references(() => gatekeeperVerdicts.id, {
      onDelete: "set null",
    }),

    decision: decisionKind("decision").notNull(),
    reason: text("reason"),

    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneByUserId: uuid("undone_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    ...timestamps(),
  },
  (table) => [
    index("validation_decisions_item_idx").on(table.itemId, table.decidedAt),
    index("validation_decisions_decision_idx").on(table.decision),
    check(
      "validation_decisions_undo_chk",
      sql`${table.undoneAt} is null or ${table.undoneAt} >= ${table.decidedAt}`,
    ),
  ],
);

/**
 * A trained revision of the gatekeeper, with the holdout it was measured on.
 *
 * The metrics below are only meaningful attached to a specific version and a
 * specific holdout, so both live here and a metric row points at them. Reporting a
 * precision number with no version attached is how a model quietly improves on
 * paper and degrades in production.
 */
export const modelVersions = pgTable(
  "model_versions",
  {
    id: primaryKeyId(),
    version: text("version").notNull(),

    trainedAt: date("trained_at"),
    /** Items with a human-confirmed label. The denominator for everything below. */
    labelledItems: integer("labelled_items"),
    holdoutSize: integer("holdout_size"),
    /** Who signed the holdout off, by name — a person, on the record. */
    reviewedBy: text("reviewed_by"),

    active: boolean("active").default(false).notNull(),
    notes: text("notes"),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("model_versions_version_uq").on(table.version),
    index("model_versions_active_idx").on(table.active),
  ],
);

/**
 * A reported metric against its target.
 *
 * `direction` is stored rather than assumed, because the metrics do not all point
 * the same way. `min` — the target is a floor and higher is better: Precision,
 * Recall, F1, ROC-AUC. `max` — the target is a ceiling and lower is better: the
 * false-credit rate, the one metric currently missing its target. A table that
 * assumed "higher is better" would render a false-credit rate of 0.09 as an
 * improvement on 0.04.
 */
export const modelMetrics = pgTable(
  "model_metrics",
  {
    id: primaryKeyId(),
    label: text("label").notNull(),

    modelVersionId: uuid("model_version_id").references(() => modelVersions.id, {
      onDelete: "set null",
    }),

    value: confidence("value").notNull(),
    target: confidence("target"),
    /** "pct" renders as a percentage, "raw" as a 0–1 score — the app's own `ModelMetric.unit`. */
    unit: text("unit").default("raw").notNull(),
    /** Defaults to `min` because four of the five metrics in use are floors. */
    direction: metricDirection("direction").default("min").notNull(),

    evaluatedOn: date("evaluated_on").notNull(),
    holdoutSize: integer("holdout_size"),
    notes: text("notes"),
    displayOrder: integer("display_order").default(0).notNull(),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("model_metrics_label_period_uq").on(
      table.label,
      table.evaluatedOn,
    ),
    index("model_metrics_version_idx").on(table.modelVersionId),
  ],
);

/**
 * A rule that fires before a credit exists — R-01 for a non-e-waste upload, R-03
 * for a working device that must not be shredded.
 *
 * Rules are data, not code, because they change under operational pressure and
 * every change needs to be attributable and reversible.
 */
export const rejectRules = pgTable(
  "reject_rules",
  {
    id: primaryKeyId(),
    code: text("code").notNull(),
    /** The rule as a sentence an operator can read out to a collector. */
    rule: text("rule").notNull(),
    note: text("note"),

    /** A hard block cannot be overridden from the queue; a soft one can. */
    hardBlock: boolean("hard_block").default(true).notNull(),
    active: boolean("active").default(true).notNull(),
    displayOrder: integer("display_order").default(0).notNull(),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("reject_rules_code_uq").on(table.code),
    index("reject_rules_active_idx").on(table.active),
  ],
);

/**
 * One firing of a rule.
 *
 * The block count and the credits-never-issued figure on the validation screen are
 * derived from these rows rather than stored on the rule, so the scoreboard cannot
 * drift from the events that justify it.
 */
export const ruleBlocks = pgTable(
  "rule_blocks",
  {
    id: primaryKeyId(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => rejectRules.id, { onDelete: "cascade" }),

    /** Null when the block happened before an item row existed. */
    itemId: uuid("item_id").references(() => items.id, {
      onDelete: "set null",
    }),

    /** What would have been credited. The number this rule saved. */
    preventedValuePaise: money("prevented_value_paise").default(0).notNull(),

    blockedAt: timestamp("blocked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    evidence: text("evidence"),

    ...timestamps(),
  },
  (table) => [
    index("rule_blocks_rule_idx").on(table.ruleId, table.blockedAt),
    index("rule_blocks_item_idx").on(table.itemId),
  ],
);
