ALTER TYPE "public"."FavoriteNodeType" RENAME TO "SidebarNodeType";--> statement-breakpoint
ALTER TYPE "public"."SidebarNodeType" ADD VALUE 'GROUP';--> statement-breakpoint
ALTER TABLE "Favorite" RENAME TO "SidebarNode";--> statement-breakpoint
ALTER TABLE "SidebarNode" RENAME COLUMN "parentFolderId" TO "parentId";--> statement-breakpoint
ALTER TABLE "SidebarNode" DROP CONSTRAINT "Favorite_organizationId_Organization_id_fk";
--> statement-breakpoint
ALTER TABLE "SidebarNode" DROP CONSTRAINT "Favorite_organizationMemberId_OrganizationMember_id_fk";
--> statement-breakpoint
ALTER TABLE "SidebarNode" DROP CONSTRAINT "Favorite_userId_User_id_fk";
--> statement-breakpoint
ALTER TABLE "SidebarNode" DROP CONSTRAINT "Favorite_parentFolderId_Favorite_id_fk";
--> statement-breakpoint
DROP INDEX "Favorite_member_idx";--> statement-breakpoint
DROP INDEX "Favorite_organizationId_idx";--> statement-breakpoint
DROP INDEX "Favorite_parentFolderId_idx";--> statement-breakpoint
ALTER TABLE "SidebarNode" ADD COLUMN "systemKey" text;--> statement-breakpoint
ALTER TABLE "SidebarNode" ADD COLUMN "isHidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "SidebarNode" ADD CONSTRAINT "SidebarNode_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SidebarNode" ADD CONSTRAINT "SidebarNode_organizationMemberId_OrganizationMember_id_fk" FOREIGN KEY ("organizationMemberId") REFERENCES "public"."OrganizationMember"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SidebarNode" ADD CONSTRAINT "SidebarNode_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "SidebarNode" ADD CONSTRAINT "SidebarNode_parentId_SidebarNode_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."SidebarNode"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "SidebarNode_member_idx" ON "SidebarNode" USING btree ("organizationMemberId");--> statement-breakpoint
CREATE INDEX "SidebarNode_organizationId_idx" ON "SidebarNode" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "SidebarNode_parentId_idx" ON "SidebarNode" USING btree ("parentId");--> statement-breakpoint
CREATE UNIQUE INDEX "SidebarNode_member_systemKey_uq" ON "SidebarNode" USING btree ("organizationMemberId","systemKey") WHERE "SidebarNode"."systemKey" is not null;