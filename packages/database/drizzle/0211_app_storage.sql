CREATE TABLE "AppStorage" (
	"id" text PRIMARY KEY NOT NULL,
	"appInstallationId" text NOT NULL,
	"connectionId" text,
	"collection" text DEFAULT '' NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"expiresAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "AppStorage_install_connection_collection_key_key" UNIQUE NULLS NOT DISTINCT("appInstallationId","connectionId","collection","key")
);
--> statement-breakpoint
ALTER TABLE "AppStorage" ADD CONSTRAINT "AppStorage_appInstallationId_AppInstallation_id_fk" FOREIGN KEY ("appInstallationId") REFERENCES "public"."AppInstallation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppStorage" ADD CONSTRAINT "AppStorage_connectionId_Credential_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."Credential"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AppStorage_appInstallationId_idx" ON "AppStorage" USING btree ("appInstallationId");--> statement-breakpoint
CREATE INDEX "AppStorage_connectionId_idx" ON "AppStorage" USING btree ("connectionId");--> statement-breakpoint
CREATE INDEX "AppStorage_expiresAt_idx" ON "AppStorage" USING btree ("expiresAt");