CREATE TABLE "MailSuggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"inboxId" text NOT NULL,
	"userId" text,
	"kind" text NOT NULL,
	"subjectKey" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"proposedConditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposedActions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"dismissedAt" timestamp (3),
	"acceptedAt" timestamp (3),
	"acceptedFilterId" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "MailSuggestion_org_inbox_user_kind_subject_key" UNIQUE NULLS NOT DISTINCT("organizationId","inboxId","userId","kind","subjectKey")
);
--> statement-breakpoint
CREATE TABLE "MailUnsubscribe" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"inboxId" text NOT NULL,
	"subjectKey" text NOT NULL,
	"method" text NOT NULL,
	"requestedByUserId" text,
	"requestedAt" timestamp (3) DEFAULT now() NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"lastSeenAfterAt" timestamp (3),
	"messagesSeenAfter" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Message" ADD COLUMN "listId" text;--> statement-breakpoint
ALTER TABLE "Message" ADD COLUMN "senderDomain" text;--> statement-breakpoint
ALTER TABLE "Message" ADD COLUMN "unsubscribeMeta" jsonb;--> statement-breakpoint
ALTER TABLE "Message" ADD COLUMN "senderAuthenticated" boolean;--> statement-breakpoint
ALTER TABLE "MailSuggestion" ADD CONSTRAINT "MailSuggestion_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MailSuggestion" ADD CONSTRAINT "MailSuggestion_inboxId_EntityInstance_id_fk" FOREIGN KEY ("inboxId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MailSuggestion" ADD CONSTRAINT "MailSuggestion_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MailUnsubscribe" ADD CONSTRAINT "MailUnsubscribe_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MailUnsubscribe" ADD CONSTRAINT "MailUnsubscribe_inboxId_EntityInstance_id_fk" FOREIGN KEY ("inboxId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MailUnsubscribe" ADD CONSTRAINT "MailUnsubscribe_requestedByUserId_User_id_fk" FOREIGN KEY ("requestedByUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "MailSuggestion_organizationId_inboxId_status_idx" ON "MailSuggestion" USING btree ("organizationId","inboxId","status");--> statement-breakpoint
CREATE INDEX "MailSuggestion_createdAt_idx" ON "MailSuggestion" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "MailUnsubscribe_org_inbox_subject_idx" ON "MailUnsubscribe" USING btree ("organizationId","inboxId","subjectKey");--> statement-breakpoint
CREATE INDEX "Message_organizationId_listId_idx" ON "Message" USING btree ("organizationId","listId") WHERE ("listId" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "Message_organizationId_senderDomain_idx" ON "Message" USING btree ("organizationId","senderDomain");--> statement-breakpoint
CREATE INDEX "Message_listId_threadId_idx" ON "Message" USING btree ("listId","threadId") WHERE ("listId" IS NOT NULL);