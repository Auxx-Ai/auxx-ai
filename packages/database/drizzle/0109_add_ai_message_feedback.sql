CREATE TABLE "AiMessageFeedback" (
	"id" text PRIMARY KEY NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"sessionId" text NOT NULL,
	"messageId" text NOT NULL,
	"isPositive" boolean NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "AiMessageFeedback" ADD CONSTRAINT "AiMessageFeedback_sessionId_AiAgentSession_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."AiAgentSession"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AiMessageFeedback" ADD CONSTRAINT "AiMessageFeedback_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AiMessageFeedback" ADD CONSTRAINT "AiMessageFeedback_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "AiMessageFeedback_sessionId_messageId_userId_key" ON "AiMessageFeedback" USING btree ("sessionId","messageId","userId");--> statement-breakpoint
CREATE INDEX "AiMessageFeedback_organizationId_idx" ON "AiMessageFeedback" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "AiMessageFeedback_isPositive_idx" ON "AiMessageFeedback" USING btree ("isPositive");