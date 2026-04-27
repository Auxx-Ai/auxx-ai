CREATE TYPE "public"."FavoriteNodeType" AS ENUM('ITEM', 'FOLDER');--> statement-breakpoint
CREATE TABLE "Favorite" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"organizationMemberId" text NOT NULL,
	"userId" text NOT NULL,
	"nodeType" "FavoriteNodeType" NOT NULL,
	"title" text,
	"targetType" text,
	"targetIds" jsonb,
	"parentFolderId" text,
	"sortOrder" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_organizationMemberId_OrganizationMember_id_fk" FOREIGN KEY ("organizationMemberId") REFERENCES "public"."OrganizationMember"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_parentFolderId_Favorite_id_fk" FOREIGN KEY ("parentFolderId") REFERENCES "public"."Favorite"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Favorite_member_idx" ON "Favorite" USING btree ("organizationMemberId");--> statement-breakpoint
CREATE INDEX "Favorite_organizationId_idx" ON "Favorite" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Favorite_parentFolderId_idx" ON "Favorite" USING btree ("parentFolderId");