CREATE TABLE "TableViewPreference" (
	"id" text PRIMARY KEY NOT NULL,
	"tableId" text NOT NULL,
	"tableViewId" text,
	"config" jsonb NOT NULL,
	"userId" text NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "TableViewPreference_org_user_table_view_key" UNIQUE NULLS NOT DISTINCT("organizationId","userId","tableId","tableViewId")
);
--> statement-breakpoint
ALTER TABLE "TableViewPreference" ADD CONSTRAINT "TableViewPreference_tableViewId_TableView_id_fk" FOREIGN KEY ("tableViewId") REFERENCES "public"."TableView"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TableViewPreference" ADD CONSTRAINT "TableViewPreference_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TableViewPreference" ADD CONSTRAINT "TableViewPreference_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "TableViewPreference_user_organization_idx" ON "TableViewPreference" USING btree ("userId","organizationId");--> statement-breakpoint
CREATE INDEX "TableViewPreference_tableViewId_idx" ON "TableViewPreference" USING btree ("tableViewId");