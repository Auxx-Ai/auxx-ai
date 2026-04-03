CREATE TABLE "AiAgentSession" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"domainState" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AiAgentSession" ADD CONSTRAINT "AiAgentSession_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AiAgentSession" ADD CONSTRAINT "AiAgentSession_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AiAgentSession_organizationId_userId_type_idx" ON "AiAgentSession" USING btree ("organizationId","userId","type");--> statement-breakpoint
CREATE INDEX "AiAgentSession_userId_type_updatedAt_idx" ON "AiAgentSession" USING btree ("userId","type","updatedAt" DESC NULLS LAST);