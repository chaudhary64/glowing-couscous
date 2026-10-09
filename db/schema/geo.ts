import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { confidence, massGrams, percent, primaryKeyId, timestamps } from "./columns";
import { items } from "./catalog";
import { hotspotStatus, materialCategory } from "./enums";
import { organizations } from "./identity";
import { intakes } from "./intake";
import { pickups } from "./logistics";

/**
 * Geography: where material is coming from, and where it is piling up.
 *
 * This layer is deliberately thin about geometry. The pilot covers a handful of
 * wards with hand-placed coordinates, so there is a `map_x_pct` / `map_y_pct` pair
 * for drawing the schematic and real lat/lng for anything that has to travel. No
 * PostGIS: the extension would have to be enabled on the RDS instance, and the
 * pilot has no true polygons to put in it. When real ward boundaries arrive, that
 * is the moment to add a `geometry` column, not before.
 */

/**
 * A municipal ward — the unit the platform reports to a city corporation in.
 *
 * `code` is what the rest of the schema joins on by value (`items.ward_code`,
 * `collectors.ward_code`), which keeps intake and network above this file instead
 * of in a circle with it.
 */
export const wards = pgTable(
  "wards",
  {
    id: primaryKeyId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameHi: text("name_hi"),

    city: text("city").notNull(),
    /** The corporation this ward answers to, when one is a customer. */
    municipalityOrganizationId: uuid("municipality_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),

    population: integer("population"),
    householdCount: integer("household_count"),

    centroidLatitude: numeric("centroid_latitude", { precision: 9, scale: 6 }),
    centroidLongitude: numeric("centroid_longitude", { precision: 9, scale: 6 }),

    /**
     * Normalised schematic position, 0–100 on each axis, used by the ward map.
     * The pilot's own convention; it is not a projection and must not be treated
     * as one.
     */
    mapXPct: numeric("map_x_pct", { precision: 5, scale: 2 }),
    mapYPct: numeric("map_y_pct", { precision: 5, scale: 2 }),

    /**
     * Ward boundary, when one exists. Null on the pilot. Kept as JSONB rather than
     * a geometry type so a boundary can be stored today without committing the
     * deployment to PostGIS.
     */
    boundaryGeoJson: jsonb("boundary_geojson"),

    active: boolean("active").default(true).notNull(),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("wards_code_uq").on(table.code),
    index("wards_city_idx").on(table.city),
    index("wards_municipality_idx").on(table.municipalityOrganizationId),
  ],
);

/**
 * A single located event: where an intake was captured, or where a pickup happened.
 *
 * Kept apart from the intake and the pickup rows themselves because a location is a
 * measurement with its own accuracy, taken by its own device, and it is the thing
 * the hotspot map aggregates. The check constraint enforces that a geopoint is
 * about at least one of them — a point in space with no subject is not a datum here.
 */
export const geopoints = pgTable(
  "geopoints",
  {
    id: primaryKeyId(),

    intakeId: uuid("intake_id").references(() => intakes.id, {
      onDelete: "cascade",
    }),
    pickupId: uuid("pickup_id").references(() => pickups.id, {
      onDelete: "cascade",
    }),

    /** The ward the point was filed under, if it has been filed. */
    wardId: uuid("ward_id").references(() => wards.id, {
      onDelete: "set null",
    }),

    latitude: numeric("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: numeric("longitude", { precision: 9, scale: 6 }).notNull(),

    /** Device-reported horizontal accuracy in metres, when the device said. */
    accuracyM: integer("accuracy_m"),
    /** gps, or ward_centroid when the handset had no fix and the ward was used. */
    source: text("source").default("gps").notNull(),

    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    ...timestamps(),
  },
  (table) => [
    index("geopoints_ward_idx").on(table.wardId, table.recordedAt),
    index("geopoints_intake_idx").on(table.intakeId),
    index("geopoints_pickup_idx").on(table.pickupId),
    check(
      "geopoints_subject_chk",
      sql`${table.intakeId} is not null or ${table.pickupId} is not null`,
    ),
  ],
);

/**
 * A cluster of detections in one ward: the thing a municipality is asked to act on.
 *
 * `detections`, `density` and the flagged-site counts the fixture carries are all
 * derived from `hotspot_detections` and the ward's geopoints instead of being
 * stored here. A stored count is right until the first deletion, and then the
 * number a city corporation reads off the screen is wrong with no way to notice.
 */
export const hotspotClusters = pgTable(
  "hotspot_clusters",
  {
    id: primaryKeyId(),
    code: text("code").notNull(),

    wardId: uuid("ward_id")
      .notNull()
      .references(() => wards.id, { onDelete: "cascade" }),

    label: text("label").notNull(),
    /** The landmark an operator actually navigates by, e.g. "behind the bus depot". */
    landmark: text("landmark"),
    radiusM: integer("radius_m"),

    status: hotspotStatus("status").default("open").notNull(),

    /** The material that dominates the cluster, for the routing decision. */
    topMaterial: text("top_material"),
    topCategory: materialCategory("top_category"),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),

    vanAssignedAt: timestamp("van_assigned_at", { withTimezone: true }),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),

    /** Operator-set priority, when a van round needs arguing about. */
    priorityScore: percent("priority_score"),

    notes: text("notes"),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("hotspot_clusters_code_uq").on(table.code),
    index("hotspot_clusters_ward_idx").on(table.wardId, table.status),
    index("hotspot_clusters_status_idx").on(table.status),
  ],
);

/**
 * One item's contribution to a cluster — the row that makes a hotspot explicable.
 *
 * A cluster with 34 detections is a claim; these rows are the evidence, and they
 * are what lets the map answer "which of these came from the same collector" and
 * "how much of this is hazardous" without a second model run.
 */
export const hotspotDetections = pgTable(
  "hotspot_detections",
  {
    id: primaryKeyId(),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => hotspotClusters.id, { onDelete: "cascade" }),

    geopointId: uuid("geopoint_id").references(() => geopoints.id, {
      onDelete: "set null",
    }),
    itemId: uuid("item_id").references(() => items.id, {
      onDelete: "set null",
    }),

    category: materialCategory("category"),
    massG: massGrams("mass_g"),

    /** How sure the clustering is that this item belongs here. */
    confidence: confidence("confidence"),
    contributionPct: percent("contribution_pct"),

    detectedAt: timestamp("detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    ...timestamps(),
  },
  (table) => [
    index("hotspot_detections_cluster_idx").on(
      table.clusterId,
      table.detectedAt,
    ),
    index("hotspot_detections_item_idx").on(table.itemId),
    /** An item contributes to a cluster once, however many times it was seen. */
    uniqueIndex("hotspot_detections_item_uq").on(table.clusterId, table.itemId),
  ],
);
