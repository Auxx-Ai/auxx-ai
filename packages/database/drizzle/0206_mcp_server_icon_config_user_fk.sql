ALTER TABLE "McpServer" ADD COLUMN "icon" jsonb;--> statement-breakpoint
ALTER TABLE "McpServer" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "McpServer" ADD CONSTRAINT "McpServer_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "McpServer" DROP COLUMN "iconUrl";