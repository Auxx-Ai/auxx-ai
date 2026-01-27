ALTER TABLE "Participant" DROP CONSTRAINT "Participant_contactId_Contact_id_fk";
--> statement-breakpoint
DROP INDEX "Participant_contactId_idx";--> statement-breakpoint
ALTER TABLE "Participant" ADD COLUMN "entityInstanceId" text;--> statement-breakpoint
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Participant_entityInstanceId_idx" ON "Participant" USING btree ("entityInstanceId");--> statement-breakpoint
ALTER TABLE "Participant" DROP COLUMN "contactId";