import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { massGrams, money, percent, primaryKeyId, timestamps } from "./columns";
import { collectorTier, facilityKind, materialCategory } from "./enums";
import { organizations, users } from "./identity";

/**
 * The two-sided network: the collectors who bring material in, and the licensed
 * facilities it goes out to. Plus the waste streams that sit between them, because
 * a facility is not "authorised" in general — it is authorised for a stream.
 */

/**
 * An informal collector, digitised.
 *
 * This is the row the whole product exists to create: the platform's record of a
 * person who was previously invisible. It is deliberately not the same thing as a
 * user — most collectors reach the platform through someone else's phone, and
 * `userId` stays null until one of them signs in for themselves.
 */
export const collectors = pgTable(
  "collectors",
  {
    id: primaryKeyId(),
    /** Short id printed on the collector's card, e.g. KAB-1042. */
    code: text("code").notNull(),

    /**
     * The signed-in account, once there is one. Null is the normal case at
     * onboarding, which is why this is unique-but-nullable rather than required.
     */
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    fullName: text("full_name").notNull(),
    phone: text("phone"),
    preferredLocale: text("preferred_locale").default("hi-IN").notNull(),

    /** Languages actually used on pickups, not languages guessed from the city. */
    languages: text("languages")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),

    city: text("city"),

    tier: collectorTier("tier").default("new").notNull(),
    /** When the tier was last raised — a lead who lapsed is still worth knowing about. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),

    /** The cooperative or aggregator this collector is affiliated with, if any. */
    cooperativeOrganizationId: uuid("cooperative_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),

    /** Joins `geo.wards.code`; no foreign key, so this file stays above geo. */
    wardCode: text("ward_code"),

    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),

    /**
     * Denormalised lifetime counters, maintained by the application.
     *
     * `ledger_entries` is the source of truth and these are the roster screen's
     * cheap read of it. They are allowed to be recomputed from the ledger at any
     * time — which is the point: an aggregate that can be rebuilt cannot corrupt
     * the books, and a payout figure that only existed as this counter could.
     */
    pickupsSettled: integer("pickups_settled").default(0).notNull(),
    lifetimeCreditsPaise: money("lifetime_credits_paise").default(0).notNull(),
    lifetimeMassG: massGrams("lifetime_mass_g").default("0").notNull(),

    notes: text("notes"),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("collectors_code_uq").on(table.code),
    uniqueIndex("collectors_user_uq").on(table.userId),
    index("collectors_tier_idx").on(table.tier),
    index("collectors_ward_idx").on(table.wardCode),
    index("collectors_cooperative_idx").on(table.cooperativeOrganizationId),
  ],
);

/**
 * A stream of material with its own handling rules — PCB assemblies, lithium
 * packs, CRT glass.
 *
 * The hazardous flag here is what routes a load to a licensed facility. It is
 * separate from the per-item hazard notes on purpose: this one is a property of
 * the material type and can be relied on before anything has been photographed.
 */
export const wasteStreams = pgTable(
  "waste_streams",
  {
    id: primaryKeyId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Hindi name for the operator's phone, where the collector-facing UI is Hindi. */
    nameHi: text("name_hi"),

    category: materialCategory("category").notNull(),
    hazardous: boolean("hazardous").default(false).notNull(),

    /** Indicative rate only. Every payout is priced from a `rate_card_line`. */
    baseRatePaisePerKg: money("base_rate_paise_per_kg"),

    handlingNote: text("handling_note"),
    active: boolean("active").default(true).notNull(),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("waste_streams_code_uq").on(table.code),
    index("waste_streams_category_idx").on(table.category),
    index("waste_streams_hazardous_idx").on(table.hazardous),
  ],
);

/**
 * A physical site that receives material.
 *
 * Separate from the organization that owns it, because a recycler with two plants
 * has two CPCB licences, two capacities and two answers to "can you take a swollen
 * battery today". The organization-level number in `identity` is the company's;
 * this row's is the site's.
 */
export const facilities = pgTable(
  "facilities",
  {
    id: primaryKeyId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    kind: facilityKind("kind").notNull(),

    /** Site licence number, distinct from the company registration. */
    licenseNo: text("license_no"),

    address: text("address"),
    city: text("city"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),

    /** Daily intake the site will accept, in grams like every other mass here. */
    capacityGPerDay: massGrams("capacity_g_per_day"),

    /** Agreed turnaround for a hazardous load, in hours. */
    slaHours: integer("sla_hours"),

    partnerSince: date("partner_since"),
    /** Operator-facing quality score; null until there is enough history to mean anything. */
    ratingPct: percent("rating_pct"),

    active: boolean("active").default(true).notNull(),
    notes: text("notes"),

    ...timestamps(),
  },
  (table) => [
    index("facilities_organization_idx").on(table.organizationId),
    index("facilities_kind_idx").on(table.kind),
    index("facilities_city_idx").on(table.city),
    index("facilities_active_idx").on(table.active),
  ],
);

/**
 * Which streams a facility will actually accept.
 *
 * A join table rather than an array of stream codes, because this is the table a
 * routing query filters on: "open facilities in Pune that accept lithium packs and
 * still have capacity today" must be one indexed lookup, and a rejected stream
 * needs somewhere to record that it was considered.
 */
export const facilityStreams = pgTable(
  "facility_streams",
  {
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    streamId: uuid("stream_id")
      .notNull()
      .references(() => wasteStreams.id, { onDelete: "cascade" }),

    accepted: boolean("accepted").default(true).notNull(),

    /**
     * Site-specific ceiling for this stream, lower than the site's overall
     * capacity when one tank or one licensed line is the real limit.
     */
    capacityGPerDay: massGrams("capacity_g_per_day"),

    /** Why a stream is refused, in the site's words — kept so it can be revisited. */
    notes: text("notes"),

    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.facilityId, table.streamId] }),
    index("facility_streams_stream_idx").on(table.streamId, table.accepted),
  ],
);
