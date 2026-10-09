import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { currency, massGrams, money, primaryKeyId, timestamps } from "./columns";
import { items } from "./catalog";
import {
  creditNoteStatus,
  eprNoteStatus,
  eprObligationStatus,
  ledgerEntryKind,
  ledgerSubject,
  materialCategory,
  pickupStatus,
} from "./enums";
import { organizations, users } from "./identity";
import { collectors, facilities } from "./network";

/**
 * Logistics and money: carrying the item to a licensed facility, and issuing the
 * two notes that follow — the collector's credit and the brand's EPR credit.
 *
 * This is where the product's promise becomes an accounting event. Everything
 * financial is written once, in `ledger_entries`, and never updated: a correction
 * is a new line. A payout figure that can be edited in place is not evidence of
 * anything.
 */

/**
 * A routed load: one item, one collector, one facility, one journey.
 *
 * Note there is no `hazardous` boolean here, even though the fixture carries one.
 * Hazard is a property of the item's materials and is already recorded on
 * `item_hazards`; a second copy on the pickup would be the one that goes stale, and
 * the failure mode is a swollen battery routed to a board line.
 */
export const pickups = pgTable(
  "pickups",
  {
    id: primaryKeyId(),
    code: text("code").notNull(),

    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    collectorId: uuid("collector_id")
      .notNull()
      .references(() => collectors.id, { onDelete: "cascade" }),

    /**
     * The receiving facility. Null while the pickup is only requested — a route can
     * exist before a licensed site has accepted it, and refusing to record the
     * request until then would lose the hazardous item's clock.
     */
    facilityId: uuid("facility_id").references(() => facilities.id, {
      onDelete: "set null",
    }),

    status: pickupStatus("status").default("requested").notNull(),

    wardCode: text("ward_code"),
    /** The van round this load was folded into, e.g. R-4 · Andheri. */
    routeLabel: text("route_label"),

    distanceKm: numeric("distance_km", { precision: 6, scale: 2 }),
    etaMinutes: integer("eta_minutes"),

    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),

    notes: text("notes"),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("pickups_code_uq").on(table.code),
    index("pickups_item_idx").on(table.itemId),
    index("pickups_collector_idx").on(table.collectorId),
    index("pickups_facility_idx").on(table.facilityId),
    index("pickups_status_idx").on(table.status, table.requestedAt),
    check(
      "pickups_distance_chk",
      sql`${table.distanceKm} is null or ${table.distanceKm} >= 0`,
    ),
  ],
);

/**
 * One step of a pickup's journey, as shown on the timeline.
 *
 * Rows rather than a status column plus timestamps, because the steps are not
 * uniform across routes: a battery load has a discharge step a board load does
 * not, and a municipality route adds a weighbridge step. The timeline is data.
 */
export const pickupSteps = pgTable(
  "pickup_steps",
  {
    id: primaryKeyId(),
    pickupId: uuid("pickup_id")
      .notNull()
      .references(() => pickups.id, { onDelete: "cascade" }),

    ordinal: integer("ordinal").notNull(),
    label: text("label").notNull(),
    detail: text("detail"),

    /** Set when the step actually happened. Null while it is still pending. */
    at: timestamp("at", { withTimezone: true }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("pickup_steps_order_uq").on(table.pickupId, table.ordinal),
  ],
);

/**
 * The collector's credit note: what they are owed for this load.
 *
 * One per pickup. This is the "verifiable" half of the product's claim — the
 * collector leaves with a document, not an assurance.
 */
export const creditNotes = pgTable(
  "credit_notes",
  {
    id: primaryKeyId(),
    code: text("code").notNull(),

    pickupId: uuid("pickup_id")
      .notNull()
      .references(() => pickups.id, { onDelete: "cascade" }),
    collectorId: uuid("collector_id")
      .notNull()
      .references(() => collectors.id, { onDelete: "cascade" }),

    status: creditNoteStatus("status").default("issued").notNull(),

    amountPaise: money("amount_paise").notNull(),
    /** The weighed mass this was priced at, which may differ from the declared one. */
    massG: massGrams("mass_g"),
    currency: currency(),

    issuedAt: timestamp("issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    /** How it was paid — upi, cash, bank. Free text because channels change. */
    settledVia: text("settled_via"),

    issuedByUserId: uuid("issued_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("credit_notes_code_uq").on(table.code),
    uniqueIndex("credit_notes_pickup_uq").on(table.pickupId),
    index("credit_notes_collector_idx").on(table.collectorId, table.issuedAt),
    index("credit_notes_status_idx").on(table.status),
    check("credit_notes_amount_chk", sql`${table.amountPaise} >= 0`),
  ],
);

/**
 * The brand's EPR credit for one item: the compliance evidence this whole pipeline
 * exists to produce.
 *
 * One per item. `compliance_period` is the month it is booked into, chosen
 * deliberately rather than derived from `issuedAt`, because a February collection
 * can legitimately be filed in March and the filing month is what CPCB sees.
 */
export const eprCreditNotes = pgTable(
  "epr_credit_notes",
  {
    id: primaryKeyId(),
    code: text("code").notNull(),

    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    brandOrganizationId: uuid("brand_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),

    category: materialCategory("category"),
    massG: massGrams("mass_g"),
    creditedPaise: money("credited_paise").notNull(),
    currency: currency(),

    status: eprNoteStatus("status").default("created").notNull(),

    compliancePeriod: date("compliance_period").notNull(),

    issuedAt: timestamp("issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    /** The CPCB form this note is reported on, once it is filed. */
    cpcbForm: text("cpcb_form"),

    notes: text("notes"),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("epr_credit_notes_code_uq").on(table.code),
    uniqueIndex("epr_credit_notes_item_uq").on(table.itemId),
    index("epr_credit_notes_brand_idx").on(
      table.brandOrganizationId,
      table.compliancePeriod,
    ),
    index("epr_credit_notes_status_idx").on(table.status),
    check("epr_credit_notes_credited_chk", sql`${table.creditedPaise} >= 0`),
  ],
);

/**
 * A brand's target for a compliance period, and how far the platform has carried
 * it. One row per brand per period, because the obligation is per filing, not per
 * year — and a brand that starts the year behind needs to see that in March, not
 * in the annual return.
 */
export const eprObligations = pgTable(
  "epr_obligations",
  {
    id: primaryKeyId(),
    brandOrganizationId: uuid("brand_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    compliancePeriod: date("compliance_period").notNull(),

    targetMassG: massGrams("target_mass_g").notNull(),
    fulfilledMassG: massGrams("fulfilled_mass_g").default("0").notNull(),

    targetCreditsPaise: money("target_credits_paise"),
    fulfilledCreditsPaise: money("fulfilled_credits_paise")
      .default(0)
      .notNull(),

    status: eprObligationStatus("status").default("open").notNull(),

    filedAt: timestamp("filed_at", { withTimezone: true }),
    notes: text("notes"),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("epr_obligations_period_uq").on(
      table.brandOrganizationId,
      table.compliancePeriod,
    ),
    index("epr_obligations_status_idx").on(table.status),
    check(
      "epr_obligations_fulfilled_chk",
      sql`${table.fulfilledMassG} >= 0 and ${table.targetMassG} >= 0`,
    ),
  ],
);

/**
 * The append-only money log.
 *
 * Every credit, payout, withhold and adjustment across the platform is one row
 * here, whatever it was issued against. A withhold is a negative line rather than
 * the absence of a credit, so "why is this collector's balance not what I expect"
 * is answerable by reading rows in order instead of inferring state from what is
 * missing.
 *
 * Nothing in this table is ever updated or deleted. Corrections are new rows with
 * `reference` pointing at what they correct.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: primaryKeyId(),

    subject: ledgerSubject("subject").notNull(),

    /** Who the line belongs to. Exactly one is set, matching `subject`. */
    collectorId: uuid("collector_id").references(() => collectors.id, {
      onDelete: "set null",
    }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),

    /** What created the line, when it was a note rather than an adjustment. */
    creditNoteId: uuid("credit_note_id").references(() => creditNotes.id, {
      onDelete: "set null",
    }),
    eprCreditNoteId: uuid("epr_credit_note_id").references(
      () => eprCreditNotes.id,
      { onDelete: "set null" },
    ),

    kind: ledgerEntryKind("kind").notNull(),

    /** Signed: positive credits the subject, negative is a payout or a withhold. */
    amountPaise: money("amount_paise").notNull(),
    currency: currency(),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    /** Free-form link to whatever this line settles or corrects. */
    reference: text("reference"),
    note: text("note"),

    /** Set on lines written by a person. Null on automation. */
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    ...timestamps(),
  },
  (table) => [
    index("ledger_entries_collector_idx").on(
      table.collectorId,
      table.occurredAt,
    ),
    index("ledger_entries_organization_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
    index("ledger_entries_kind_idx").on(table.kind, table.occurredAt),
    index("ledger_entries_credit_note_idx").on(table.creditNoteId),
    index("ledger_entries_epr_note_idx").on(table.eprCreditNoteId),
    /**
     * A line must name at least one thing it is about; otherwise it is a number
     * with no owner, which is the one kind of row this table must never contain.
     */
    check(
      "ledger_entries_subject_chk",
      sql`${table.collectorId} is not null
          or ${table.organizationId} is not null
          or ${table.creditNoteId} is not null
          or ${table.eprCreditNoteId} is not null`,
    ),
  ],
);
