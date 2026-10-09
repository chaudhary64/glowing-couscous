import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryKeyId, timestamps } from "./columns";
import { items } from "./catalog";
import {
  activityKind,
  auditActorKind,
  channelStatus,
  notificationChannel,
  notificationStatus,
} from "./enums";
import { organizations, users } from "./identity";
import { intakes } from "./intake";
import { creditNotes, pickups } from "./logistics";
import { collectors } from "./network";

/**
 * Operations: the operator-facing feed, what was sent to collectors, the audit
 * trail, and the channel roadmap.
 *
 * The last of these is a schema decision worth stating. The WhatsApp channel is
 * deliberately unbuilt (see the track write-up), so it exists here as a roadmap
 * row with its blockers, not as tables that would imply an integration that does
 * not exist. When it is built it will write into `intakes` through the same path
 * the app does, and the only thing that changes is which row in
 * `delivery_channels` is `shipped`.
 */

/**
 * One line in the operator's activity feed.
 *
 * The subject columns are nullable links rather than a single polymorphic
 * `entity_id`, so that the feed can be joined back to real rows and a deleted
 * pickup does not leave an event pointing into nothing. Not every event has every
 * subject: a settlement has a credit note but no intake.
 */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: primaryKeyId(),

    kind: activityKind("kind").notNull(),

    /** The line as the operator reads it. */
    headline: text("headline").notNull(),
    detail: text("detail"),

    wardCode: text("ward_code"),

    collectorId: uuid("collector_id").references(() => collectors.id, {
      onDelete: "set null",
    }),
    intakeId: uuid("intake_id").references(() => intakes.id, {
      onDelete: "set null",
    }),
    itemId: uuid("item_id").references(() => items.id, {
      onDelete: "set null",
    }),
    pickupId: uuid("pickup_id").references(() => pickups.id, {
      onDelete: "set null",
    }),
    creditNoteId: uuid("credit_note_id").references(() => creditNotes.id, {
      onDelete: "set null",
    }),

    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    ...timestamps(),
  },
  (table) => [
    index("activity_events_occurred_idx").on(table.occurredAt),
    index("activity_events_kind_idx").on(table.kind, table.occurredAt),
    index("activity_events_collector_idx").on(table.collectorId),
    index("activity_events_item_idx").on(table.itemId),
  ],
);

/**
 * Something sent, or attempted, to a collector or an officer.
 *
 * `dedupeKey` is unique so that a retried job cannot send the same credit note
 * twice. `attempts` and `failureReason` are here because the delivery path is the
 * least reliable part of the system — a collector with one bar of signal on a
 * feature phone — and "we sent it" has to be answerable with evidence.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: primaryKeyId(),

    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    collectorId: uuid("collector_id").references(() => collectors.id, {
      onDelete: "set null",
    }),

    channel: notificationChannel("channel").notNull(),
    status: notificationStatus("status").default("queued").notNull(),

    /** Template name, e.g. credit_note_issued, not the rendered text. */
    template: text("template").notNull(),
    /** Template variables, so the same record can be re-rendered in another language. */
    payload: jsonb("payload"),

    /** Language it went out in. A Hindi template for a Tamil collector is a bug. */
    locale: text("locale"),

    attempts: integer("attempts").default(0).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),

    /** Idempotency key: one credit note, one SMS. */
    dedupeKey: text("dedupe_key"),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("notifications_dedupe_uq").on(table.dedupeKey),
    index("notifications_user_idx").on(table.userId, table.createdAt),
    index("notifications_collector_idx").on(table.collectorId),
    index("notifications_status_idx").on(table.status, table.channel),
    check("notifications_attempts_chk", sql`${table.attempts} >= 0`),
  ],
);

/**
 * Who did what, for the things that need to survive a dispute.
 *
 * Separate from `activity_events` on purpose: the feed is written for operators and
 * is allowed to be lossy and readable, while this table is written for an auditor
 * and is neither. `before` and `after` hold the changed fields only.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: primaryKeyId(),

    actorKind: auditActorKind("actor_kind").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** The organization the actor was acting for, which is not always their own. */
    actorOrganizationId: uuid("actor_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),

    /** Verb on a noun, e.g. "validation_decision.approved". */
    action: text("action").notNull(),
    entityKind: text("entity_kind").notNull(),
    entityId: uuid("entity_id"),

    before: jsonb("before"),
    after: jsonb("after"),

    /** Correlation id for tracing one request across the logs. */
    requestId: text("request_id"),
    userAgent: text("user_agent"),

    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),

    ...timestamps(),
  },
  (table) => [
    index("audit_log_entity_idx").on(table.entityKind, table.entityId),
    index("audit_log_actor_idx").on(table.actorUserId, table.at),
    index("audit_log_action_idx").on(table.action, table.at),
  ],
);

/**
 * A way users reach the platform, and whether it is built.
 *
 * `rank` is odd on purpose: it is the fixture's priority rank and it is nullable,
 * because an unranked channel has been noted but not prioritised. `rationale` is
 * where "WhatsApp is a channel, not a capability" is actually recorded, so the
 * next person to ask the question finds the answer in the database.
 */
export const deliveryChannels = pgTable(
  "delivery_channels",
  {
    id: primaryKeyId(),
    code: text("code").notNull(),
    name: text("name").notNull(),

    rank: integer("rank"),
    status: channelStatus("status").notNull(),

    /** What it costs to build, in plain words rather than a story-point estimate. */
    effort: text("effort"),
    /** Who it reaches, in plain words. */
    reach: text("reach"),
    /** Why it holds this position. */
    rationale: text("rationale"),

    decidedAt: date("decided_at"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("delivery_channels_code_uq").on(table.code),
    index("delivery_channels_status_idx").on(table.status),
    check(
      "delivery_channels_rank_chk",
      sql`${table.rank} is null or ${table.rank} >= 1`,
    ),
  ],
);

/**
 * Why a channel is not built yet — one row per blocker.
 *
 * Rows rather than a text array because blockers get cleared one at a time, and
 * "is the WhatsApp business account still the blocker" has to be a queryable fact
 * rather than a string to re-read.
 */
export const channelBlockers = pgTable(
  "channel_blockers",
  {
    id: primaryKeyId(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => deliveryChannels.id, { onDelete: "cascade" }),

    label: text("label").notNull(),
    detail: text("detail"),

    /** Blocking vs merely relevant: only the first stops the channel. */
    blocking: boolean("blocking").default(true).notNull(),

    ownerRole: text("owner_role"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    ordinal: integer("ordinal").default(0).notNull(),

    ...timestamps(),
  },
  (table) => [index("channel_blockers_channel_idx").on(table.channelId)],
);

/**
 * The reasoning behind a channel's position, kept as a record rather than as a
 * paragraph in a slide deck.
 *
 * This is where "it is a channel, not a capability" is actually stored: the
 * decision, the headline argument, the line to say when a judge asks how
 * collectors reach us, and — the two columns that make it a decision rather than
 * an opinion — what building it would cost and what skipping it would cost.
 *
 * A log, not a single row per channel: a deferral can be reversed, and the newer
 * record must win without erasing the older one. "The" decision is the latest by
 * `decided_at`, the same pattern the gatekeeper verdicts use.
 */
export const channelDecisions = pgTable(
  "channel_decisions",
  {
    id: primaryKeyId(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => deliveryChannels.id, { onDelete: "cascade" }),

    /** The verdict in as few words as it takes, e.g. "Not in this build". */
    decision: text("decision").notNull(),
    headline: text("headline").notNull(),

    /** What it would cost to build, in plain words. */
    costOfBuilding: text("cost_of_building"),
    /** What is being given up by not building it — the honest other side. */
    costOfSkipping: text("cost_of_skipping"),
    /** What to say out loud when the question comes up on stage. */
    demoLine: text("demo_line"),

    decidedAt: date("decided_at"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    ...timestamps(),
  },
  (table) => [
    index("channel_decisions_channel_idx").on(table.channelId, table.decidedAt),
  ],
);
