ALTER TABLE "shops" ADD COLUMN "wb_sandbox_token" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "use_sandbox" boolean DEFAULT false NOT NULL;