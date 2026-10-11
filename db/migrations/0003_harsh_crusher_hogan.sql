CREATE TABLE "rate_card_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"cpcb" text,
	"handling_fee_paise" bigint NOT NULL,
	"epr_credit_paise" bigint NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_card_classes_handling_chk" CHECK ("rate_card_classes"."handling_fee_paise" >= 0),
	CONSTRAINT "rate_card_classes_epr_chk" CHECK ("rate_card_classes"."epr_credit_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "rate_card_lines" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "rate_card_classes" ADD CONSTRAINT "rate_card_classes_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_card_classes_code_uq" ON "rate_card_classes" USING btree ("rate_card_id","code");