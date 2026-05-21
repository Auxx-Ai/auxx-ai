ALTER TYPE "public"."IdentifierType" ADD VALUE 'CHAT_VISITOR';--> statement-breakpoint
CREATE TABLE "MessageReceipt" (
	"id" text PRIMARY KEY NOT NULL,
	"messageId" text NOT NULL,
	"recipientParticipantId" text NOT NULL,
	"deliveredAt" timestamp (3),
	"readAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Message" ALTER COLUMN "subject" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "agentId" text;--> statement-breakpoint
ALTER TABLE "MessageReceipt" ADD CONSTRAINT "MessageReceipt_messageId_Message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MessageReceipt" ADD CONSTRAINT "MessageReceipt_recipientParticipantId_Participant_id_fk" FOREIGN KEY ("recipientParticipantId") REFERENCES "public"."Participant"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "MessageReceipt_message_recipient_key" ON "MessageReceipt" USING btree ("messageId","recipientParticipantId");--> statement-breakpoint
CREATE INDEX "MessageReceipt_messageId_idx" ON "MessageReceipt" USING btree ("messageId");--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD CONSTRAINT "ChatWidget_agentId_Agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ChatWidget" DROP COLUMN "useAi";--> statement-breakpoint
ALTER TABLE "ChatWidget" DROP COLUMN "aiModel";--> statement-breakpoint
ALTER TABLE "ChatWidget" DROP COLUMN "aiInstructions";