ALTER TABLE "Comment" RENAME COLUMN "entityType" TO "entityDefinitionId";--> statement-breakpoint
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_threadId_Thread_id_fk";
--> statement-breakpoint
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_ticketId_Ticket_id_fk";
--> statement-breakpoint
DROP INDEX "Comment_entityId_entityType_idx";--> statement-breakpoint
DROP INDEX "Comment_threadId_idx";--> statement-breakpoint
DROP INDEX "Comment_ticketId_idx";--> statement-breakpoint
CREATE INDEX "Comment_entityId_entityDefinitionId_idx" ON "Comment" USING btree ("entityId","entityDefinitionId");--> statement-breakpoint
ALTER TABLE "Comment" DROP COLUMN "threadId";--> statement-breakpoint
ALTER TABLE "Comment" DROP COLUMN "ticketId";