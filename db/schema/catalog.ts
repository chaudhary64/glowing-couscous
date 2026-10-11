import { sql } from "drizzle-orm";
import {
  boolean,
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

import { massGrams, money, percent, primaryKeyId, timestamps } from "./columns";
import { itemCondition, materialCategory } from "./enums";
import { users } from "./identity";
import { intakes } from "./intake";
import { collectors, wasteStreams } from "./network";

/**
 * The catalog: what an item *is*, what it is made of, and what those materials
 * are worth.
 *
 * This is the layer the valuation reads from. The intake says what the collector
 * described; the catalog turns that into a bill of materials with a rupee figure
 * on every line, and the rate card is the only place a price is allowed to come
 * from — a rate typed into a valuation directly would be untraceable a month
 * later when a brand disputes the credit.
 */

/**
 * A resolved e-waste item. One per intake in practice, but a standalone row is
 * legal: an item photographed twice, or entered by an operator from paperwork, is
 * still one item.
 *
 * Deliberately no `status` column. An item's state is already recorded, once each,
 * by the gatekeeper verdict (verified / rejected / review), the validation decision
 * that clears a hold, and the pickup that carries it away. A status column here
 * would be a fourth copy of the same fact and the first thing to disagree with the
 * other three. Where the UI wants one word, it reads the verdict.
 */
export const items = pgTable(
  "items",
  {
    id: primaryKeyId(),
    /** Human-facing id used everywhere in the UI and on the credit note. */
    code: text("code").notNull(),

    /**
     * The intake this item was resolved from.
     *
     * This single column is the whole intake↔item relationship. There is no
     * `resolved_item_id` back on `intakes`, which would have been a second copy of
     * the same fact and a circular foreign key between the two tables. Unique,
     * because one intake resolves to one item — a second item from the same
     * submission means a re-run of extraction, which supersedes rather than adds.
     */
    intakeId: uuid("intake_id")
      .notNull()
      .references(() => intakes.id, { onDelete: "cascade" }),

    /**
     * Who is paid for this item. Nullable since `0002_stormy_thunderbird.sql`,
     * for the same reason `intakes.collector_id` is: the request that prices an item
     * arrives with an operator's session and a photograph, and says nothing about whose
     * material it is. The choice is between refusing the price — losing the only link
     * from a kept evidence trail to the money it was worth — and recording it with the
     * person unknown. Provisioning a collector at submission time is the job that closes
     * this, and `collectors.user_id` is the column that will connect the two.
     */
    collectorId: uuid("collector_id").references(() => collectors.id, {
      onDelete: "cascade",
    }),

    /**
     * The waste stream this item was classified into (PCB, battery, CRT glass…).
     * Nullable, because classification follows extraction and an item can exist
     * before an operator has settled the stream by hand.
     */
    streamId: uuid("stream_id").references(() => wasteStreams.id, {
      onDelete: "set null",
    }),

    /** What the operator sees, e.g. "Dell laptop mainboard". */
    deviceLabel: text("device_label").notNull(),
    /** The generic class behind the label, e.g. "Laptop mainboard". */
    deviceCategory: text("device_category").notNull(),

    /**
     * The brand plate read, which is what the EPR credit is eventually booked
     * against. Nullable and never guessed: an unread plate is a real outcome (see
     * the bottle marked "Unread"), and inventing a brand here would book compliance
     * credit against the wrong company.
     */
    brand: text("brand"),
    model: text("model"),

    condition: itemCondition("condition").notNull(),
    massG: massGrams("mass_g").notNull(),

    /** Ward code, joining `geo.wards.code`. Not a foreign key, so this file stays above geo. */
    wardCode: text("ward_code"),

    /** Where the item physically was when it was photographed. */
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),

    recoveredAt: timestamp("recovered_at", { withTimezone: true }),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("items_code_uq").on(table.code),
    /** Enforces the sentence above: one intake resolves to exactly one item. */
    uniqueIndex("items_intake_uq").on(table.intakeId),
    index("items_collector_idx").on(table.collectorId),
    index("items_stream_idx").on(table.streamId),
    index("items_brand_idx").on(table.brand),
    index("items_ward_idx").on(table.wardCode),
    index("items_recovered_idx").on(table.recoveredAt),
    check("items_mass_chk", sql`${table.massG} >= 0`),
  ],
);

/**
 * Hazard notes a recycler must be told before accepting the load — leaded glass,
 * a swollen cell, charged capacitors.
 *
 * A table rather than a text[] column because these are routed on: "which open
 * pickups contain leaded glass" has to be a query, and a hazard has an operator
 * who confirmed it. Written by the gatekeeper, never by the collector's own words.
 */
export const itemHazards = pgTable(
  "item_hazards",
  {
    id: primaryKeyId(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),

    label: text("label").notNull(),
    /** The rule or model signal that flagged it, so a false alarm is traceable. */
    source: text("source"),
    ordinal: integer("ordinal").default(0).notNull(),

    ...timestamps(),
  },
  (table) => [index("item_hazards_item_idx").on(table.itemId)],
);

/**
 * One material line of an item's assay: mass, rate, and the value that follows.
 *
 * `valuePaise` is stored rather than computed on read because a line is priced at
 * the moment of valuation, against the rate card in force then. Recomputing from
 * today's rate would silently restate yesterday's payout.
 */
export const materialLines = pgTable(
  "material_lines",
  {
    id: primaryKeyId(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),

    materialName: text("material_name").notNull(),
    /** Chemical symbol for the mono marker in the UI; null when there is none. */
    symbol: text("symbol"),
    category: materialCategory("category").notNull(),

    massG: massGrams("mass_g").notNull(),
    shareOfItemPct: percent("share_of_item_pct"),

    /**
     * A rate of 0 is a real datum, not a missing one: hazardous and inert lines
     * carry no scrap value and only cost money to handle. That is why this column
     * is not nullable — a null here would be indistinguishable from "not yet priced".
     */
    ratePaisePerKg: money("rate_paise_per_kg").notNull(),
    valuePaise: money("value_paise").notNull(),

    /** How the material is actually recovered, in the operator's words. */
    handlingNote: text("handling_note"),

    hazardous: boolean("hazardous").default(false).notNull(),
    ordinal: integer("ordinal").default(0).notNull(),

    ...timestamps(),
  },
  (table) => [
    index("material_lines_item_idx").on(table.itemId),
    index("material_lines_category_idx").on(table.category),
    check("material_lines_mass_chk", sql`${table.massG} >= 0`),
    check("material_lines_value_chk", sql`${table.valuePaise} >= 0`),
  ],
);

/**
 * A dated set of rates. Every price in the system traces back to exactly one row
 * here, which is what makes a payout defensible when a brand asks why a board was
 * worth ₹1,368 in October and something else in December.
 */
export const rateCards = pgTable(
  "rate_cards",
  {
    id: primaryKeyId(),
    code: text("code").notNull(),
    name: text("name").notNull(),

    /** Where the numbers came from — an IMD benchmark, a smelter quote, a tender. */
    basis: text("basis"),

    effectiveFrom: date("effective_from").notNull(),
    /** Null means "still current" — the open-ended card, not an expired one. */
    effectiveTo: date("effective_to"),

    active: boolean("active").default(true).notNull(),

    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    notes: text("notes"),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("rate_cards_code_uq").on(table.code),
    index("rate_cards_active_idx").on(table.active),
    index("rate_cards_effective_idx").on(table.effectiveFrom),
    check(
      "rate_cards_window_chk",
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

/**
 * A rate for one material on one card. Kept as free text in `material_name`
 * rather than a foreign key into a material dictionary, because rates arrive from
 * outside in whatever words the smelter used, and forcing them into our own
 * vocabulary before they can be stored loses the original.
 */
export const rateCardLines = pgTable(
  "rate_card_lines",
  {
    id: primaryKeyId(),
    rateCardId: uuid("rate_card_id")
      .notNull()
      .references(() => rateCards.id, { onDelete: "cascade" }),

    /**
     * The material's id in the pricing vocabulary (`cu`, `au`, `pb-glass`), which is what
     * the identification model returns and `priceProposal` looks a line up by. Nullable
     * because a line can arrive from a smelter with no id of ours — the name is then the
     * only key, exactly as this column's neighbourhood describes.
     */
    code: text("code"),

    materialName: text("material_name").notNull(),
    symbol: text("symbol"),
    category: materialCategory("category").notNull(),

    ratePaisePerKg: money("rate_paise_per_kg").notNull(),

    /**
     * The lowest rate an operator may negotiate down to without an approval. A
     * floor in the data is the only thing that stops a doorstep haggle from
     * quietly undercutting the published card.
     */
    floorPaisePerKg: money("floor_paise_per_kg"),

    /** What hazardous handling costs the platform on top of the material value. */
    handlingCostPaisePerKg: money("handling_cost_paise_per_kg"),

    notes: text("notes"),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("rate_card_lines_material_uq").on(
      table.rateCardId,
      table.materialName,
    ),
    check("rate_card_lines_rate_chk", sql`${table.ratePaisePerKg} >= 0`),
  ],
);

/**
 * The per-class schedule: the handling fee taken off the material value, and the EPR
 * credit the brand can book.
 *
 * Kept beside `rate_card_lines` because the two are one card: an item is priced by its
 * material lines against the rates, then its class decides the fee and the compliance
 * credit. The class schedule used to live only in `lib/data/rate-card.ts`, which meant
 * `/rates` could show one number while `priceProposal` used another. Both now read this.
 */
export const rateCardClasses = pgTable(
  "rate_card_classes",
  {
    id: primaryKeyId(),
    rateCardId: uuid("rate_card_id")
      .notNull()
      .references(() => rateCards.id, { onDelete: "cascade" }),

    /** The pricing vocabulary's class code, e.g. `board_it` — what the model returns. */
    code: text("code").notNull(),

    /** What the class is called on a screen, e.g. "IT & telecom board assembly". */
    label: text("label").notNull(),
    /** The CPCB category it maps onto, e.g. "E-waste · Class E2 IT & telecom". */
    cpcb: text("cpcb"),

    handlingFeePaise: money("handling_fee_paise").notNull(),
    eprCreditPaise: money("epr_credit_paise").notNull(),

    displayOrder: integer("display_order").default(0).notNull(),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("rate_card_classes_code_uq").on(table.rateCardId, table.code),
    check("rate_card_classes_handling_chk", sql`${table.handlingFeePaise} >= 0`),
    check("rate_card_classes_epr_chk", sql`${table.eprCreditPaise} >= 0`),
  ],
);
