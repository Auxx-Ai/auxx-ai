CREATE TABLE "MailFilter" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"inboxId" text NOT NULL,
	"name" text NOT NULL,
	"order" integer NOT NULL,
	"stopProcessing" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"createdByUserId" text,
	"templateKey" text,
	"lastFiredAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "MailFilterRun" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"filterId" text NOT NULL,
	"threadId" text NOT NULL,
	"messageId" text NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"undo" jsonb,
	"undoneAt" timestamp (3),
	"source" text DEFAULT 'live' NOT NULL,
	"firedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "MailFilter" ADD CONSTRAINT "MailFilter_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MailFilter" ADD CONSTRAINT "MailFilter_inboxId_EntityInstance_id_fk" FOREIGN KEY ("inboxId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MailFilter" ADD CONSTRAINT "MailFilter_createdByUserId_User_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MailFilterRun" ADD CONSTRAINT "MailFilterRun_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "MailFilter_organizationId_inboxId_order_idx" ON "MailFilter" USING btree ("organizationId","inboxId","order");--> statement-breakpoint
CREATE INDEX "MailFilter_organizationId_inboxId_enabled_idx" ON "MailFilter" USING btree ("organizationId","inboxId") WHERE enabled;--> statement-breakpoint
CREATE UNIQUE INDEX "MailFilter_organizationId_templateKey_idx" ON "MailFilter" USING btree ("organizationId","templateKey") WHERE "templateKey" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "MailFilterRun_organizationId_filterId_firedAt_idx" ON "MailFilterRun" USING btree ("organizationId","filterId","firedAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "MailFilterRun_organizationId_threadId_firedAt_idx" ON "MailFilterRun" USING btree ("organizationId","threadId","firedAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "MailFilterRun_firedAt_idx" ON "MailFilterRun" USING btree ("firedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "MailFilterRun_filterId_messageId_source_idx" ON "MailFilterRun" USING btree ("filterId","messageId","source");