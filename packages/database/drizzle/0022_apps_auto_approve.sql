ALTER TABLE "App" ADD COLUMN "autoApprove" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "App_autoApprove_idx" ON "App" USING btree ("autoApprove");