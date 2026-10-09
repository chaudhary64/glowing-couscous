CREATE TYPE "public"."activity_kind" AS ENUM('intake', 'valuation', 'validation', 'pickup', 'settled');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_kind" AS ENUM('user', 'system', 'integration');--> statement-breakpoint
CREATE TYPE "public"."channel_status" AS ENUM('shipped', 'next', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."collector_tier" AS ENUM('new', 'verified', 'lead');--> statement-breakpoint
CREATE TYPE "public"."credit_note_status" AS ENUM('issued', 'settled', 'withheld');--> statement-breakpoint
CREATE TYPE "public"."decision_kind" AS ENUM('approved_recyclable', 'sent_to_reuse', 'rejected_non_ewaste');--> statement-breakpoint
CREATE TYPE "public"."epr_note_status" AS ENUM('created', 'withheld', 'booked');--> statement-breakpoint
CREATE TYPE "public"."epr_obligation_status" AS ENUM('open', 'at_risk', 'met', 'filed');--> statement-breakpoint
CREATE TYPE "public"."extraction_source" AS ENUM('photo', 'voice');--> statement-breakpoint
CREATE TYPE "public"."facility_kind" AS ENUM('recycling', 'reuse', 'collection');--> statement-breakpoint
CREATE TYPE "public"."hotspot_status" AS ENUM('open', 'van_assigned', 'cleared');--> statement-breakpoint
CREATE TYPE "public"."intake_mode" AS ENUM('photo', 'voice');--> statement-breakpoint
CREATE TYPE "public"."item_condition" AS ENUM('working', 'dead', 'damaged');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_kind" AS ENUM('credit', 'payout', 'withhold', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."ledger_subject" AS ENUM('collector', 'brand', 'platform');--> statement-breakpoint
CREATE TYPE "public"."material_category" AS ENUM('precious', 'base', 'hazardous', 'inert');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'officer', 'operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."metric_direction" AS ENUM('min', 'max');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('push', 'sms', 'whatsapp', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."organization_kind" AS ENUM('brand', 'recycler', 'municipality', 'cooperative', 'platform');--> statement-breakpoint
CREATE TYPE "public"."pickup_status" AS ENUM('requested', 'assigned', 'in_transit', 'received', 'settled');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."verdict_kind" AS ENUM('verified', 'rejected', 'review');--> statement-breakpoint
CREATE TABLE "organization_members" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'viewer' NOT NULL,
	"invited_by_user_id" uuid,
	"invited_at" timestamp with time zone,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "organization_kind" NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"gstin" text,
	"cpcb_registration_no" text,
	"city" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cognito_sub" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone" text,
	"full_name" text NOT NULL,
	"preferred_locale" text DEFAULT 'hi-IN' NOT NULL,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"phone" text,
	"preferred_locale" text DEFAULT 'hi-IN' NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"city" text,
	"tier" "collector_tier" DEFAULT 'new' NOT NULL,
	"verified_at" timestamp with time zone,
	"cooperative_organization_id" uuid,
	"ward_code" text,
	"last_active_at" timestamp with time zone,
	"pickups_settled" integer DEFAULT 0 NOT NULL,
	"lifetime_credits_paise" bigint DEFAULT 0 NOT NULL,
	"lifetime_mass_g" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "facility_kind" NOT NULL,
	"license_no" text,
	"address" text,
	"city" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"capacity_g_per_day" numeric(12, 2),
	"sla_hours" integer,
	"partner_since" date,
	"rating_pct" numeric(5, 2),
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facility_streams" (
	"facility_id" uuid NOT NULL,
	"stream_id" uuid NOT NULL,
	"accepted" boolean DEFAULT true NOT NULL,
	"capacity_g_per_day" numeric(12, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facility_streams_facility_id_stream_id_pk" PRIMARY KEY("facility_id","stream_id")
);
--> statement-breakpoint
CREATE TABLE "waste_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_hi" text,
	"category" "material_category" NOT NULL,
	"hazardous" boolean DEFAULT false NOT NULL,
	"base_rate_paise_per_kg" bigint,
	"handling_note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intake_id" uuid NOT NULL,
	"label" text NOT NULL,
	"value_text" text NOT NULL,
	"unit" text,
	"confidence" numeric(4, 3) NOT NULL,
	"source" "extraction_source" NOT NULL,
	"evidence" text,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"collector_id" uuid NOT NULL,
	"mode" "intake_mode" NOT NULL,
	"media_id" uuid NOT NULL,
	"summary" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_offline" boolean DEFAULT false NOT NULL,
	"ward_code" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"extraction_model" text,
	"extraction_confidence" numeric(4, 3),
	"extraction_latency_ms" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "intake_mode" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text,
	"byte_size" integer,
	"checksum_sha256" text,
	"language" text,
	"duration_seconds" integer,
	"transcript" text,
	"translation" text,
	"word_count" integer,
	"width_px" integer,
	"height_px" integer,
	"uploader_user_id" uuid,
	"collector_id" uuid,
	"captured_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_hazards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"label" text NOT NULL,
	"source" text,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"intake_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"stream_id" uuid,
	"device_label" text NOT NULL,
	"device_category" text NOT NULL,
	"brand" text,
	"model" text,
	"condition" "item_condition" NOT NULL,
	"mass_g" numeric(12, 2) NOT NULL,
	"ward_code" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"recovered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_mass_chk" CHECK ("items"."mass_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "material_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"material_name" text NOT NULL,
	"symbol" text,
	"category" "material_category" NOT NULL,
	"mass_g" numeric(12, 2) NOT NULL,
	"share_of_item_pct" numeric(5, 2),
	"rate_paise_per_kg" bigint NOT NULL,
	"value_paise" bigint NOT NULL,
	"handling_note" text,
	"hazardous" boolean DEFAULT false NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_lines_mass_chk" CHECK ("material_lines"."mass_g" >= 0),
	CONSTRAINT "material_lines_value_chk" CHECK ("material_lines"."value_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rate_card_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"material_name" text NOT NULL,
	"symbol" text,
	"category" "material_category" NOT NULL,
	"rate_paise_per_kg" bigint NOT NULL,
	"floor_paise_per_kg" bigint,
	"handling_cost_paise_per_kg" bigint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_card_lines_rate_chk" CHECK ("rate_card_lines"."rate_paise_per_kg" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"basis" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_cards_window_chk" CHECK ("rate_cards"."effective_to" is null or "rate_cards"."effective_to" > "rate_cards"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "gatekeeper_verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"verdict" "verdict_kind" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"model_version" text NOT NULL,
	"matched_class" text,
	"reason" text,
	"image_quality_pct" numeric(5, 2),
	"latency_ms" integer,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gatekeeper_verdicts_confidence_chk" CHECK ("gatekeeper_verdicts"."confidence" >= 0 and "gatekeeper_verdicts"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "model_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"model_version_id" uuid,
	"value" numeric(4, 3) NOT NULL,
	"target" numeric(4, 3),
	"unit" text DEFAULT 'raw' NOT NULL,
	"direction" "metric_direction" DEFAULT 'min' NOT NULL,
	"evaluated_on" date NOT NULL,
	"holdout_size" integer,
	"notes" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"trained_at" date,
	"labelled_items" integer,
	"holdout_size" integer,
	"reviewed_by" text,
	"active" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reject_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"rule" text NOT NULL,
	"note" text,
	"hard_block" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"item_id" uuid,
	"prevented_value_paise" bigint DEFAULT 0 NOT NULL,
	"blocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"verdict_id" uuid,
	"decision" "decision_kind" NOT NULL,
	"reason" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "validation_decisions_undo_chk" CHECK ("validation_decisions"."undone_at" is null or "validation_decisions"."undone_at" >= "validation_decisions"."decided_at")
);
--> statement-breakpoint
CREATE TABLE "valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"rate_card_id" uuid,
	"gross_value_paise" bigint NOT NULL,
	"handling_fee_paise" bigint DEFAULT 0 NOT NULL,
	"net_to_collector_paise" bigint NOT NULL,
	"epr_credit_paise" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"rate_basis" text,
	"valid_until" timestamp with time zone,
	"summary" text,
	"confidence" numeric(4, 3),
	"model" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valuations_net_chk" CHECK ("valuations"."net_to_collector_paise" >= 0),
	CONSTRAINT "valuations_gross_chk" CHECK ("valuations"."gross_value_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "verdict_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verdict_id" uuid NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"weight_pct" numeric(5, 2),
	"ordinal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"pickup_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"status" "credit_note_status" DEFAULT 'issued' NOT NULL,
	"amount_paise" bigint NOT NULL,
	"mass_g" numeric(12, 2),
	"currency" text DEFAULT 'INR' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"settled_via" text,
	"issued_by_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_amount_chk" CHECK ("credit_notes"."amount_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "epr_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"item_id" uuid NOT NULL,
	"brand_organization_id" uuid NOT NULL,
	"category" "material_category",
	"mass_g" numeric(12, 2),
	"credited_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "epr_note_status" DEFAULT 'created' NOT NULL,
	"compliance_period" date NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"booked_at" timestamp with time zone,
	"cpcb_form" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "epr_credit_notes_credited_chk" CHECK ("epr_credit_notes"."credited_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "epr_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_organization_id" uuid NOT NULL,
	"compliance_period" date NOT NULL,
	"target_mass_g" numeric(12, 2) NOT NULL,
	"fulfilled_mass_g" numeric(12, 2) DEFAULT '0' NOT NULL,
	"target_credits_paise" bigint,
	"fulfilled_credits_paise" bigint DEFAULT 0 NOT NULL,
	"status" "epr_obligation_status" DEFAULT 'open' NOT NULL,
	"filed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "epr_obligations_fulfilled_chk" CHECK ("epr_obligations"."fulfilled_mass_g" >= 0 and "epr_obligations"."target_mass_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" "ledger_subject" NOT NULL,
	"collector_id" uuid,
	"organization_id" uuid,
	"credit_note_id" uuid,
	"epr_credit_note_id" uuid,
	"kind" "ledger_entry_kind" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reference" text,
	"note" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_subject_chk" CHECK ("ledger_entries"."collector_id" is not null
          or "ledger_entries"."organization_id" is not null
          or "ledger_entries"."credit_note_id" is not null
          or "ledger_entries"."epr_credit_note_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "pickup_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pickup_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	"detail" text,
	"at" timestamp with time zone,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pickups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"item_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"facility_id" uuid,
	"status" "pickup_status" DEFAULT 'requested' NOT NULL,
	"ward_code" text,
	"route_label" text,
	"distance_km" numeric(6, 2),
	"eta_minutes" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_for" timestamp with time zone,
	"assigned_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pickups_distance_chk" CHECK ("pickups"."distance_km" is null or "pickups"."distance_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "geopoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intake_id" uuid,
	"pickup_id" uuid,
	"ward_id" uuid,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"accuracy_m" integer,
	"source" text DEFAULT 'gps' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "geopoints_subject_chk" CHECK ("geopoints"."intake_id" is not null or "geopoints"."pickup_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "hotspot_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"ward_id" uuid NOT NULL,
	"label" text NOT NULL,
	"landmark" text,
	"radius_m" integer,
	"status" "hotspot_status" DEFAULT 'open' NOT NULL,
	"top_material" text,
	"top_category" "material_category",
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"van_assigned_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	"priority_score" numeric(5, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotspot_detections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"geopoint_id" uuid,
	"item_id" uuid,
	"category" "material_category",
	"mass_g" numeric(12, 2),
	"confidence" numeric(4, 3),
	"contribution_pct" numeric(5, 2),
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_hi" text,
	"city" text NOT NULL,
	"municipality_organization_id" uuid,
	"population" integer,
	"household_count" integer,
	"centroid_latitude" numeric(9, 6),
	"centroid_longitude" numeric(9, 6),
	"map_x_pct" numeric(5, 2),
	"map_y_pct" numeric(5, 2),
	"boundary_geojson" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "activity_kind" NOT NULL,
	"headline" text NOT NULL,
	"detail" text,
	"ward_code" text,
	"collector_id" uuid,
	"intake_id" uuid,
	"item_id" uuid,
	"pickup_id" uuid,
	"credit_note_id" uuid,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_kind" "audit_actor_kind" NOT NULL,
	"actor_user_id" uuid,
	"actor_organization_id" uuid,
	"action" text NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_blockers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"label" text NOT NULL,
	"detail" text,
	"blocking" boolean DEFAULT true NOT NULL,
	"owner_role" text,
	"resolved_at" timestamp with time zone,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"headline" text NOT NULL,
	"cost_of_building" text,
	"cost_of_skipping" text,
	"demo_line" text,
	"decided_at" date,
	"decided_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"rank" integer,
	"status" "channel_status" NOT NULL,
	"effort" text,
	"reach" text,
	"rationale" text,
	"decided_at" date,
	"decided_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_channels_rank_chk" CHECK ("delivery_channels"."rank" is null or "delivery_channels"."rank" >= 1)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"collector_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"template" text NOT NULL,
	"payload" jsonb,
	"locale" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_attempts_chk" CHECK ("notifications"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_cooperative_organization_id_organizations_id_fk" FOREIGN KEY ("cooperative_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_streams" ADD CONSTRAINT "facility_streams_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_streams" ADD CONSTRAINT "facility_streams_stream_id_waste_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."waste_streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_fields" ADD CONSTRAINT "intake_fields_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_hazards" ADD CONSTRAINT "item_hazards_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_stream_id_waste_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."waste_streams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_lines" ADD CONSTRAINT "material_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card_lines" ADD CONSTRAINT "rate_card_lines_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gatekeeper_verdicts" ADD CONSTRAINT "gatekeeper_verdicts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gatekeeper_verdicts" ADD CONSTRAINT "gatekeeper_verdicts_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_metrics" ADD CONSTRAINT "model_metrics_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_blocks" ADD CONSTRAINT "rule_blocks_rule_id_reject_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."reject_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_blocks" ADD CONSTRAINT "rule_blocks_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_decisions" ADD CONSTRAINT "validation_decisions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_decisions" ADD CONSTRAINT "validation_decisions_verdict_id_gatekeeper_verdicts_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."gatekeeper_verdicts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_decisions" ADD CONSTRAINT "validation_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_decisions" ADD CONSTRAINT "validation_decisions_undone_by_user_id_users_id_fk" FOREIGN KEY ("undone_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdict_signals" ADD CONSTRAINT "verdict_signals_verdict_id_gatekeeper_verdicts_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."gatekeeper_verdicts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_pickup_id_pickups_id_fk" FOREIGN KEY ("pickup_id") REFERENCES "public"."pickups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epr_credit_notes" ADD CONSTRAINT "epr_credit_notes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epr_credit_notes" ADD CONSTRAINT "epr_credit_notes_brand_organization_id_organizations_id_fk" FOREIGN KEY ("brand_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epr_obligations" ADD CONSTRAINT "epr_obligations_brand_organization_id_organizations_id_fk" FOREIGN KEY ("brand_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_epr_credit_note_id_epr_credit_notes_id_fk" FOREIGN KEY ("epr_credit_note_id") REFERENCES "public"."epr_credit_notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_steps" ADD CONSTRAINT "pickup_steps_pickup_id_pickups_id_fk" FOREIGN KEY ("pickup_id") REFERENCES "public"."pickups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_steps" ADD CONSTRAINT "pickup_steps_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geopoints" ADD CONSTRAINT "geopoints_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geopoints" ADD CONSTRAINT "geopoints_pickup_id_pickups_id_fk" FOREIGN KEY ("pickup_id") REFERENCES "public"."pickups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geopoints" ADD CONSTRAINT "geopoints_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotspot_clusters" ADD CONSTRAINT "hotspot_clusters_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotspot_detections" ADD CONSTRAINT "hotspot_detections_cluster_id_hotspot_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."hotspot_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotspot_detections" ADD CONSTRAINT "hotspot_detections_geopoint_id_geopoints_id_fk" FOREIGN KEY ("geopoint_id") REFERENCES "public"."geopoints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotspot_detections" ADD CONSTRAINT "hotspot_detections_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wards" ADD CONSTRAINT "wards_municipality_organization_id_organizations_id_fk" FOREIGN KEY ("municipality_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_pickup_id_pickups_id_fk" FOREIGN KEY ("pickup_id") REFERENCES "public"."pickups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_organization_id_organizations_id_fk" FOREIGN KEY ("actor_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_blockers" ADD CONSTRAINT "channel_blockers_channel_id_delivery_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."delivery_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_decisions" ADD CONSTRAINT "channel_decisions_channel_id_delivery_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."delivery_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_decisions" ADD CONSTRAINT "channel_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_channels" ADD CONSTRAINT "delivery_channels_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organization_members_role_idx" ON "organization_members" USING btree ("organization_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_gstin_uq" ON "organizations" USING btree ("gstin");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_cpcb_no_uq" ON "organizations" USING btree ("cpcb_registration_no");--> statement-breakpoint
CREATE INDEX "organizations_kind_idx" ON "organizations" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "users_cognito_sub_uq" ON "users" USING btree ("cognito_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "collectors_code_uq" ON "collectors" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "collectors_user_uq" ON "collectors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "collectors_tier_idx" ON "collectors" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "collectors_ward_idx" ON "collectors" USING btree ("ward_code");--> statement-breakpoint
CREATE INDEX "collectors_cooperative_idx" ON "collectors" USING btree ("cooperative_organization_id");--> statement-breakpoint
CREATE INDEX "facilities_organization_idx" ON "facilities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "facilities_kind_idx" ON "facilities" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "facilities_city_idx" ON "facilities" USING btree ("city");--> statement-breakpoint
CREATE INDEX "facilities_active_idx" ON "facilities" USING btree ("active");--> statement-breakpoint
CREATE INDEX "facility_streams_stream_idx" ON "facility_streams" USING btree ("stream_id","accepted");--> statement-breakpoint
CREATE UNIQUE INDEX "waste_streams_code_uq" ON "waste_streams" USING btree ("code");--> statement-breakpoint
CREATE INDEX "waste_streams_category_idx" ON "waste_streams" USING btree ("category");--> statement-breakpoint
CREATE INDEX "waste_streams_hazardous_idx" ON "waste_streams" USING btree ("hazardous");--> statement-breakpoint
CREATE INDEX "intake_fields_intake_idx" ON "intake_fields" USING btree ("intake_id");--> statement-breakpoint
CREATE UNIQUE INDEX "intake_fields_label_uq" ON "intake_fields" USING btree ("intake_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "intakes_code_uq" ON "intakes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "intakes_media_uq" ON "intakes" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "intakes_collector_idx" ON "intakes" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "intakes_submitted_idx" ON "intakes" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "intakes_ward_idx" ON "intakes" USING btree ("ward_code");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_storage_key_uq" ON "media_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_assets_collector_idx" ON "media_assets" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "media_assets_uploaded_idx" ON "media_assets" USING btree ("uploaded_at");--> statement-breakpoint
CREATE INDEX "item_hazards_item_idx" ON "item_hazards" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_code_uq" ON "items" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "items_intake_uq" ON "items" USING btree ("intake_id");--> statement-breakpoint
CREATE INDEX "items_collector_idx" ON "items" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "items_stream_idx" ON "items" USING btree ("stream_id");--> statement-breakpoint
CREATE INDEX "items_brand_idx" ON "items" USING btree ("brand");--> statement-breakpoint
CREATE INDEX "items_ward_idx" ON "items" USING btree ("ward_code");--> statement-breakpoint
CREATE INDEX "items_recovered_idx" ON "items" USING btree ("recovered_at");--> statement-breakpoint
CREATE INDEX "material_lines_item_idx" ON "material_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "material_lines_category_idx" ON "material_lines" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_card_lines_material_uq" ON "rate_card_lines" USING btree ("rate_card_id","material_name");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_cards_code_uq" ON "rate_cards" USING btree ("code");--> statement-breakpoint
CREATE INDEX "rate_cards_active_idx" ON "rate_cards" USING btree ("active");--> statement-breakpoint
CREATE INDEX "rate_cards_effective_idx" ON "rate_cards" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "gatekeeper_verdicts_item_idx" ON "gatekeeper_verdicts" USING btree ("item_id","checked_at");--> statement-breakpoint
CREATE INDEX "gatekeeper_verdicts_verdict_idx" ON "gatekeeper_verdicts" USING btree ("verdict");--> statement-breakpoint
CREATE UNIQUE INDEX "model_metrics_label_period_uq" ON "model_metrics" USING btree ("label","evaluated_on");--> statement-breakpoint
CREATE INDEX "model_metrics_version_idx" ON "model_metrics" USING btree ("model_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_versions_version_uq" ON "model_versions" USING btree ("version");--> statement-breakpoint
CREATE INDEX "model_versions_active_idx" ON "model_versions" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "reject_rules_code_uq" ON "reject_rules" USING btree ("code");--> statement-breakpoint
CREATE INDEX "reject_rules_active_idx" ON "reject_rules" USING btree ("active");--> statement-breakpoint
CREATE INDEX "rule_blocks_rule_idx" ON "rule_blocks" USING btree ("rule_id","blocked_at");--> statement-breakpoint
CREATE INDEX "rule_blocks_item_idx" ON "rule_blocks" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "validation_decisions_item_idx" ON "validation_decisions" USING btree ("item_id","decided_at");--> statement-breakpoint
CREATE INDEX "validation_decisions_decision_idx" ON "validation_decisions" USING btree ("decision");--> statement-breakpoint
CREATE UNIQUE INDEX "valuations_item_version_uq" ON "valuations" USING btree ("item_id","version");--> statement-breakpoint
CREATE INDEX "verdict_signals_verdict_idx" ON "verdict_signals" USING btree ("verdict_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_code_uq" ON "credit_notes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_pickup_uq" ON "credit_notes" USING btree ("pickup_id");--> statement-breakpoint
CREATE INDEX "credit_notes_collector_idx" ON "credit_notes" USING btree ("collector_id","issued_at");--> statement-breakpoint
CREATE INDEX "credit_notes_status_idx" ON "credit_notes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "epr_credit_notes_code_uq" ON "epr_credit_notes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "epr_credit_notes_item_uq" ON "epr_credit_notes" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "epr_credit_notes_brand_idx" ON "epr_credit_notes" USING btree ("brand_organization_id","compliance_period");--> statement-breakpoint
CREATE INDEX "epr_credit_notes_status_idx" ON "epr_credit_notes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "epr_obligations_period_uq" ON "epr_obligations" USING btree ("brand_organization_id","compliance_period");--> statement-breakpoint
CREATE INDEX "epr_obligations_status_idx" ON "epr_obligations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ledger_entries_collector_idx" ON "ledger_entries" USING btree ("collector_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_organization_idx" ON "ledger_entries" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_kind_idx" ON "ledger_entries" USING btree ("kind","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_credit_note_idx" ON "ledger_entries" USING btree ("credit_note_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_epr_note_idx" ON "ledger_entries" USING btree ("epr_credit_note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_steps_order_uq" ON "pickup_steps" USING btree ("pickup_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "pickups_code_uq" ON "pickups" USING btree ("code");--> statement-breakpoint
CREATE INDEX "pickups_item_idx" ON "pickups" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "pickups_collector_idx" ON "pickups" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "pickups_facility_idx" ON "pickups" USING btree ("facility_id");--> statement-breakpoint
CREATE INDEX "pickups_status_idx" ON "pickups" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "geopoints_ward_idx" ON "geopoints" USING btree ("ward_id","recorded_at");--> statement-breakpoint
CREATE INDEX "geopoints_intake_idx" ON "geopoints" USING btree ("intake_id");--> statement-breakpoint
CREATE INDEX "geopoints_pickup_idx" ON "geopoints" USING btree ("pickup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hotspot_clusters_code_uq" ON "hotspot_clusters" USING btree ("code");--> statement-breakpoint
CREATE INDEX "hotspot_clusters_ward_idx" ON "hotspot_clusters" USING btree ("ward_id","status");--> statement-breakpoint
CREATE INDEX "hotspot_clusters_status_idx" ON "hotspot_clusters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hotspot_detections_cluster_idx" ON "hotspot_detections" USING btree ("cluster_id","detected_at");--> statement-breakpoint
CREATE INDEX "hotspot_detections_item_idx" ON "hotspot_detections" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hotspot_detections_item_uq" ON "hotspot_detections" USING btree ("cluster_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wards_code_uq" ON "wards" USING btree ("code");--> statement-breakpoint
CREATE INDEX "wards_city_idx" ON "wards" USING btree ("city");--> statement-breakpoint
CREATE INDEX "wards_municipality_idx" ON "wards" USING btree ("municipality_organization_id");--> statement-breakpoint
CREATE INDEX "activity_events_occurred_idx" ON "activity_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_kind_idx" ON "activity_events" USING btree ("kind","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_collector_idx" ON "activity_events" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "activity_events_item_idx" ON "activity_events" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","at");--> statement-breakpoint
CREATE INDEX "channel_blockers_channel_idx" ON "channel_blockers" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "channel_decisions_channel_idx" ON "channel_decisions" USING btree ("channel_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_channels_code_uq" ON "delivery_channels" USING btree ("code");--> statement-breakpoint
CREATE INDEX "delivery_channels_status_idx" ON "delivery_channels" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_collector_idx" ON "notifications" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status","channel");