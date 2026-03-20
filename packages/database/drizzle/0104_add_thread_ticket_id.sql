ALTER TABLE "Thread" ADD COLUMN "ticketId" text;--> statement-breakpoint
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_ticketId_EntityInstance_id_fk" FOREIGN KEY ("ticketId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Thread_ticketId_idx" ON "Thread" USING btree ("ticketId");