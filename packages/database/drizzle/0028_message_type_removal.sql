ALTER TABLE "Message" RENAME COLUMN "createdTime" TO "createdAt";--> statement-breakpoint
ALTER TABLE "Message" RENAME COLUMN "lastModifiedTime" TO "updatedAt";--> statement-breakpoint
ALTER TABLE "Thread" DROP CONSTRAINT "Thread_inboxId_Inbox_id_fk";
--> statement-breakpoint
DROP INDEX "Message_emailLabel_idx";--> statement-breakpoint
DROP INDEX "Thread_inboxId_idx";--> statement-breakpoint
DROP INDEX "Thread_organizationId_messageType_status_idx";--> statement-breakpoint
DROP INDEX "thread_participants_idx";--> statement-breakpoint
ALTER TABLE "Message" DROP COLUMN "integrationType";--> statement-breakpoint
ALTER TABLE "Message" DROP COLUMN "messageType";--> statement-breakpoint
ALTER TABLE "Message" DROP COLUMN "isAutoReply";--> statement-breakpoint
ALTER TABLE "Message" DROP COLUMN "isAIGenerated";--> statement-breakpoint
ALTER TABLE "Message" DROP COLUMN "keywords";--> statement-breakpoint
ALTER TABLE "Message" DROP COLUMN "inReplyTo";--> statement-breakpoint
ALTER TABLE "Message" DROP COLUMN "references";--> statement-breakpoint
ALTER TABLE "Message" DROP COLUMN "threadIndex";--> statement-breakpoint
ALTER TABLE "Message" DROP COLUMN "internetHeaders";--> statement-breakpoint
ALTER TABLE "Message" DROP COLUMN "folderId";--> statement-breakpoint
ALTER TABLE "Message" DROP COLUMN "emailLabel";--> statement-breakpoint
ALTER TABLE "Thread" DROP COLUMN "participantIds";--> statement-breakpoint
ALTER TABLE "Thread" DROP COLUMN "integrationType";--> statement-breakpoint
ALTER TABLE "Thread" DROP COLUMN "messageType";--> statement-breakpoint
ALTER TABLE "Thread" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "Thread" DROP COLUMN "inboxId";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "routingEnabled";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "routingId";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "routingDomain";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "destinationEmail";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "refreshTokenExpiresIn";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "customerId";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "settings";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "messageType";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "lastAuthError";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "lastAuthErrorAt";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "requiresReauth";