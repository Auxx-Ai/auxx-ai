ALTER TABLE "DataConnectorRun" ADD COLUMN "recordFilter" jsonb;--> statement-breakpoint
ALTER TABLE "DataConnectorRun" ADD COLUMN "initiatedBy" text;--> statement-breakpoint
ALTER TABLE "DataConnectorRun" ADD CONSTRAINT "DataConnectorRun_initiatedBy_User_id_fk" FOREIGN KEY ("initiatedBy") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;