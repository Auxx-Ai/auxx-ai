ALTER TABLE "CustomFieldValue" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "CustomFieldValue" CASCADE;--> statement-breakpoint
ALTER TABLE "Message" DROP CONSTRAINT "Message_signatureId_EntityInstance_id_fk";
--> statement-breakpoint
ALTER TABLE "Participant" DROP CONSTRAINT "Participant_entityInstanceId_EntityInstance_id_fk";
--> statement-breakpoint
ALTER TABLE "shopify_customers" DROP CONSTRAINT "shopify_customers_entityInstanceId_EntityInstance_id_fk";
--> statement-breakpoint
ALTER TABLE "Message" ADD CONSTRAINT "Message_signatureId_EntityInstance_id_fk" FOREIGN KEY ("signatureId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "shopify_customers" ADD CONSTRAINT "shopify_customers_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;