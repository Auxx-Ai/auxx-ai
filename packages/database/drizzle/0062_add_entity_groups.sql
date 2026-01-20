CREATE TABLE "EntityGroupMember" (
	"id" text PRIMARY KEY NOT NULL,
	"groupInstanceId" text NOT NULL,
	"memberType" text NOT NULL,
	"memberRefId" text NOT NULL,
	"addedById" text,
	"sortKey" text DEFAULT 'a0' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "EntityGroupPermission" (
	"id" text PRIMARY KEY NOT NULL,
	"groupInstanceId" text NOT NULL,
	"granteeType" text NOT NULL,
	"granteeId" text NOT NULL,
	"permission" text NOT NULL,
	"grantedById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "EntityGroupMember" ADD CONSTRAINT "EntityGroupMember_groupInstanceId_EntityInstance_id_fk" FOREIGN KEY ("groupInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntityGroupMember" ADD CONSTRAINT "EntityGroupMember_addedById_User_id_fk" FOREIGN KEY ("addedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntityGroupPermission" ADD CONSTRAINT "EntityGroupPermission_groupInstanceId_EntityInstance_id_fk" FOREIGN KEY ("groupInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EntityGroupPermission" ADD CONSTRAINT "EntityGroupPermission_grantedById_User_id_fk" FOREIGN KEY ("grantedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "EntityGroupMember_group_member_key" ON "EntityGroupMember" USING btree ("groupInstanceId","memberType","memberRefId");--> statement-breakpoint
CREATE INDEX "EntityGroupMember_group_idx" ON "EntityGroupMember" USING btree ("groupInstanceId");--> statement-breakpoint
CREATE INDEX "EntityGroupMember_member_idx" ON "EntityGroupMember" USING btree ("memberType","memberRefId");--> statement-breakpoint
CREATE UNIQUE INDEX "EntityGroupPermission_group_grantee_key" ON "EntityGroupPermission" USING btree ("groupInstanceId","granteeType","granteeId");--> statement-breakpoint
CREATE INDEX "EntityGroupPermission_group_idx" ON "EntityGroupPermission" USING btree ("groupInstanceId");--> statement-breakpoint
CREATE INDEX "EntityGroupPermission_grantee_idx" ON "EntityGroupPermission" USING btree ("granteeType","granteeId");