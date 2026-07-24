ALTER TABLE "Agent" ADD COLUMN "runAsUserId" text;--> statement-breakpoint
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_runAsUserId_User_id_fk" FOREIGN KEY ("runAsUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Agent_runAsUserId_idx" ON "Agent" USING btree ("runAsUserId");