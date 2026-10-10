import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { confidence, primaryKeyId, timestamps } from "./columns";
import { extractionSource, intakeMode } from "./enums";
import { users } from "./identity";
import { collectors } from "./network";

/**
 * Intake: what the collector actually handed over — a photograph or a Hindi voice
 * note — and what the model read out of it.
 *
 * Two rules shape this layer. The raw asset is kept, unmodified, because it is the
 * only evidence that a valuation was based on something real. And an extracted
 * field is stored beside the transcript span it came from, so a wrong rupee figure
 * can be traced back to the sentence that produced it rather than to a model
 * version number.
 */

/**
 * An uploaded photo or voice note, as stored.
 *
 * Nothing here is derived: `storage_key` points at the object in S3 and the rest
 * describes the bytes. Keeping the raw transcript on the asset, rather than only
 * on the intake, means the extraction can be re-run against the original audio
 * without asking the collector to record it again.
 */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: primaryKeyId(),

    /** Photo or voice, reusing the intake mode — it is the same distinction. */
    kind: intakeMode("kind").notNull(),

    /** S3 object key. The bucket and region are configuration, not data. */
    storageKey: text("storage_key").notNull(),

    mimeType: text("mime_type"),
    byteSize: integer("byte_size"),
    /** Content hash, so the same file uploaded twice is recognisable as one file. */
    checksumSha256: text("checksum_sha256"),

    /* --- voice --- */
    /** BCP-47 tag the audio model was asked for, e.g. hi-IN. */
    language: text("language"),
    durationSeconds: integer("duration_seconds"),
    /** Verbatim machine transcript. Evidence: never edited, never translated in place. */
    transcript: text("transcript"),
    /** English translation, kept alongside so the Hindi original survives. */
    translation: text("translation"),
    wordCount: integer("word_count"),

    /* --- photo --- */
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),

    /**
     * Who uploaded it and on whose behalf. Both nullable: a voice note arrives
     * through an operator's phone for a collector who has no account of their own.
     */
    uploaderUserId: uuid("uploader_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    collectorId: uuid("collector_id").references(() => collectors.id, {
      onDelete: "set null",
    }),

    capturedAt: timestamp("captured_at", { withTimezone: true }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("media_assets_storage_key_uq").on(table.storageKey),
    index("media_assets_collector_idx").on(table.collectorId),
    index("media_assets_uploaded_idx").on(table.uploadedAt),
  ],
);

/**
 * One submission: a collector's photo or voice note, and everything the pipeline
 * read from it.
 *
 * The intake is the unit of work an operator sees. Its outcome — the item it
 * resolved to — is recorded on the item side (`items.intake_id`), so there is
 * exactly one place that says an intake was resolved.
 */
export const intakes = pgTable(
  "intakes",
  {
    id: primaryKeyId(),
    /** Sample id shown in the UI, e.g. SMP-0001. */
    code: text("code").notNull(),

    /**
     * The collector whose material this is, once anybody knows who they are.
     *
     * Nullable for the same reason `media_assets.collector_id` is: a submission
     * arrives through an operator's own phone, and the request that carries it says
     * nothing about whose material it is — the collector is standing in the lane, not
     * holding a session. Refusing the row because the person is unknown would lose the
     * only link from a priced submission back to its photograph, which is exactly the
     * evidence this table exists to keep. `items.collector_id` stays `notNull`: an
     * item is a thing somebody is paid for, and that somebody has to be named.
     */
    collectorId: uuid("collector_id").references(() => collectors.id, {
      onDelete: "cascade",
    }),

    mode: intakeMode("mode").notNull(),

    /** The primary asset. Unique: a re-upload is a new intake, not a second asset here. */
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),

    /** One line describing what this submission is, in the operator's words. */
    summary: text("summary"),

    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    /**
     * Captured with no signal at all, then synced. Recorded because a submission
     * that arrives a day late must not look like a submission made a day late.
     */
    submittedOffline: boolean("submitted_offline").default(false).notNull(),

    /* --- where it was captured --- */
    wardCode: text("ward_code"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),

    /* --- how it was read --- */
    /** Model that did the extraction, e.g. bedrock:claude-3-5-sonnet. */
    extractionModel: text("extraction_model"),
    extractionConfidence: confidence("extraction_confidence"),
    extractionLatencyMs: integer("extraction_latency_ms"),

    notes: text("notes"),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex("intakes_code_uq").on(table.code),
    uniqueIndex("intakes_media_uq").on(table.mediaId),
    index("intakes_collector_idx").on(table.collectorId),
    index("intakes_submitted_idx").on(table.submittedAt),
    index("intakes_ward_idx").on(table.wardCode),
  ],
);

/**
 * A field the model extracted from the asset: brand plate, device class, weight.
 *
 * `valueText` holds the value as read rather than a typed number, because the
 * model's answer is a string with a unit attached ("1.45 kg", "Dell"), and
 * normalising it at write time would throw away what was actually seen. The
 * parsed number lives on the item, which is where it is priced.
 */
export const intakeFields = pgTable(
  "intake_fields",
  {
    id: primaryKeyId(),
    intakeId: uuid("intake_id")
      .notNull()
      .references(() => intakes.id, { onDelete: "cascade" }),

    /** Display label, e.g. "Brand plate". */
    label: text("label").notNull(),
    valueText: text("value_text").notNull(),
    unit: text("unit"),

    confidence: confidence("confidence").notNull(),

    /**
     * Photo or voice. Which modal read this field decides how much it can be
     * trusted: a weight read off a photo is an estimate, one spoken aloud is a claim.
     */
    source: extractionSource("source").notNull(),

    /**
     * The transcript sentence or image region this value came from. Evidence, so a
     * disputed field can be shown to the person who submitted it.
     */
    evidence: text("evidence"),

    ordinal: integer("ordinal").default(0).notNull(),

    ...timestamps(),
  },
  (table) => [
    index("intake_fields_intake_idx").on(table.intakeId),
    uniqueIndex("intake_fields_label_uq").on(table.intakeId, table.label),
  ],
);
