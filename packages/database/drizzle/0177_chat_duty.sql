ALTER TABLE "OrganizationMember" ADD COLUMN "onChatDuty" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "OrganizationMember" ADD COLUMN "chatDutyUpdatedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "OrganizationMember" ADD COLUMN "chatDutyUpdatedById" text;--> statement-breakpoint
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_chatDutyUpdatedById_User_id_fk" FOREIGN KEY ("chatDutyUpdatedById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;