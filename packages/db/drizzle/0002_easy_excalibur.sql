CREATE TYPE "public"."telegram_chat_type" AS ENUM('private', 'group', 'supergroup');--> statement-breakpoint
CREATE TABLE "tenant_chats" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_telegram_user_id" bigint NOT NULL,
	"chat_type" "telegram_chat_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_telegram_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_owner_telegram_user_id_unique" UNIQUE("owner_telegram_user_id")
);
--> statement-breakpoint
ALTER TABLE "shops" DROP CONSTRAINT "shops_name_unique";--> statement-breakpoint
DROP INDEX "job_runs_job_type_started_idx";--> statement-breakpoint
DROP INDEX "job_runs_status_started_idx";--> statement-breakpoint
DROP INDEX "product_cards_shop_wb_updated_idx";--> statement-breakpoint
ALTER TABLE "sync_state" DROP CONSTRAINT "sync_state_pkey";--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN "tenant_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "product_cards" ADD COLUMN "tenant_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "tenant_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "tenant_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_tenant_id_shop_id_pk" PRIMARY KEY("tenant_id","shop_id");--> statement-breakpoint
ALTER TABLE "tenant_chats" ADD CONSTRAINT "tenant_chats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_chats_tenant_idx" ON "tenant_chats" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_cards" ADD CONSTRAINT "product_cards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_state" ADD CONSTRAINT "sync_state_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_runs_tenant_job_type_started_idx" ON "job_runs" USING btree ("tenant_id","job_type","started_at");--> statement-breakpoint
CREATE INDEX "job_runs_tenant_status_started_idx" ON "job_runs" USING btree ("tenant_id","status","started_at");--> statement-breakpoint
CREATE INDEX "product_cards_tenant_shop_wb_updated_idx" ON "product_cards" USING btree ("tenant_id","shop_id","wb_updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shops_tenant_name_unique_idx" ON "shops" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "shops_tenant_created_idx" ON "shops" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_state_tenant_shop_idx" ON "sync_state" USING btree ("tenant_id","shop_id");--> statement-breakpoint
ALTER TABLE "shops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shops" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "shops_tenant_rls" ON "shops"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
ALTER TABLE "product_cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_cards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "product_cards_tenant_rls" ON "product_cards"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
ALTER TABLE "sync_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_state" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sync_state_tenant_rls" ON "sync_state"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
ALTER TABLE "job_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "job_runs_tenant_rls" ON "job_runs"
USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
