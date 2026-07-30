DROP INDEX "ApprovalRequest_organizationId_assigneeGroups_idx";--> statement-breakpoint
DROP INDEX "ApprovalRequest_organizationId_assigneeUsers_idx";--> statement-breakpoint
CREATE INDEX "ApprovalRequest_assigneeUsers_pending_gin" ON "ApprovalRequest" USING gin ("assigneeUsers") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "ApprovalRequest_assigneeGroups_pending_gin" ON "ApprovalRequest" USING gin ("assigneeGroups") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "ApprovalRequest_access_instance_denied_idx" ON "ApprovalRequest" USING btree ("organizationId","requesterId","entityDefinitionId","entityInstanceId","createdAt" DESC NULLS LAST) WHERE kind = 'access' AND status = 'denied' AND "targetKind" = 'instance';