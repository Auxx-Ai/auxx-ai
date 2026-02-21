CREATE TABLE "KeyValuePair" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"type" text NOT NULL,
	"isEncrypted" text DEFAULT 'false' NOT NULL,
	"organizationId" text,
	"userId" text,
	"updatedById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "KeyValuePair" ADD CONSTRAINT "KeyValuePair_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "KeyValuePair" ADD CONSTRAINT "KeyValuePair_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "KeyValuePair" ADD CONSTRAINT "KeyValuePair_updatedById_User_id_fk" FOREIGN KEY ("updatedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "KeyValuePair_key_userId_organizationId_key" ON "KeyValuePair" USING btree ("key","userId","organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "KeyValuePair_key_organizationId_null_userId_key" ON "KeyValuePair" USING btree ("key","organizationId") WHERE "userId" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "KeyValuePair_key_userId_null_organizationId_key" ON "KeyValuePair" USING btree ("key","userId") WHERE "organizationId" IS NULL;--> statement-breakpoint
CREATE INDEX "KeyValuePair_type_idx" ON "KeyValuePair" USING btree ("type");--> statement-breakpoint
CREATE INDEX "KeyValuePair_organizationId_idx" ON "KeyValuePair" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "KeyValuePair_userId_idx" ON "KeyValuePair" USING btree ("userId");