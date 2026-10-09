import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Every closed set of values in the domain, declared once.
 *
 * These become real Postgres enum types, so an invalid state cannot be written by
 * a buggy handler or a well-meaning migration script. Sets that are genuinely open
 * — languages, waste-stream names, material symbols — are text columns instead,
 * because a new language must not require a migration.
 */

/* ------------------------------------------------------------- identity */

export const organizationKind = pgEnum("organization_kind", [
  "brand", // generates EPR obligations
  "recycler", // CPCB-registered, receives loads
  "municipality", // ward officers reading the hotspot map
  "cooperative", // a collective of informal collectors
  "platform", // us
]);

/** Matches the Cognito group names a user is placed in. */
export const membershipRole = pgEnum("membership_role", [
  "owner",
  "admin",
  "officer",
  "operator",
  "viewer",
]);

export const userStatus = pgEnum("user_status", [
  "invited",
  "active",
  "suspended",
]);

export const auditActorKind = pgEnum("audit_actor_kind", [
  "user",
  "system",
  "integration",
]);

/* -------------------------------------------------------------- network */

export const collectorTier = pgEnum("collector_tier", [
  "new",
  "verified",
  "lead",
]);

export const facilityKind = pgEnum("facility_kind", [
  "recycling", // processes material
  "reuse", // refurbishes working devices
  "collection", // aggregation point only
]);

/* --------------------------------------------------------------- intake */

export const intakeMode = pgEnum("intake_mode", ["photo", "voice"]);

/** Where an extracted field came from, so a low-confidence read is traceable. */
export const extractionSource = pgEnum("extraction_source", ["photo", "voice"]);

/* -------------------------------------------------------------- catalog */

export const itemCondition = pgEnum("item_condition", [
  "working",
  "dead",
  "damaged",
]);

export const materialCategory = pgEnum("material_category", [
  "precious",
  "base",
  "hazardous", // no scrap value; carries a disposal cost
  "inert",
]);

/* ------------------------------------------------------------ valuation */

/** The gatekeeper's boolean, plus the state where it refuses to decide alone. */
export const verdictKind = pgEnum("verdict_kind", [
  "verified",
  "rejected",
  "review",
]);

/** The three ways a held item leaves the validation queue. */
export const decisionKind = pgEnum("decision_kind", [
  "approved_recyclable",
  "sent_to_reuse",
  "rejected_non_ewaste",
]);

/**
 * Which way a metric points, so it can be judged against its target without
 * hardcoding a rule per label.
 *
 * `min` — the target is a floor, higher is better (Precision, Recall, F1, ROC-AUC).
 * `max` — the target is a ceiling, lower is better (the false-credit rate).
 */
export const metricDirection = pgEnum("metric_direction", ["min", "max"]);

/* ------------------------------------------------------------ logistics */

export const pickupStatus = pgEnum("pickup_status", [
  "requested",
  "assigned",
  "in_transit",
  "received",
  "settled",
]);

export const creditNoteStatus = pgEnum("credit_note_status", [
  "issued",
  "settled",
  "withheld",
]);

export const eprNoteStatus = pgEnum("epr_note_status", [
  "created",
  "withheld",
  "booked",
]);

/** A brand's position against its annual CPCB target for a period. */
export const eprObligationStatus = pgEnum("epr_obligation_status", [
  "open",
  "at_risk",
  "met",
  "filed",
]);

/** Who a ledger line belongs to. */
export const ledgerSubject = pgEnum("ledger_subject", [
  "collector",
  "brand",
  "platform",
]);

/** Append-only. A withhold is a line, not a deleted credit. */
export const ledgerEntryKind = pgEnum("ledger_entry_kind", [
  "credit",
  "payout",
  "withhold",
  "adjustment",
]);

/* ------------------------------------------------------------------ geo */

export const hotspotStatus = pgEnum("hotspot_status", [
  "open",
  "van_assigned",
  "cleared",
]);

/* ------------------------------------------------------------------ ops */

export const activityKind = pgEnum("activity_kind", [
  "intake",
  "valuation",
  "validation",
  "pickup",
  "settled",
]);

export const notificationChannel = pgEnum("notification_channel", [
  "push",
  "sms",
  "whatsapp",
  "email",
]);

export const notificationStatus = pgEnum("notification_status", [
  "queued",
  "sent",
  "failed",
  "suppressed",
]);

export const channelStatus = pgEnum("channel_status", [
  "shipped",
  "next",
  "deferred",
]);
