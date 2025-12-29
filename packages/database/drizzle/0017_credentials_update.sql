ALTER TABLE "WorkflowCredentials" ADD COLUMN "userId" text;--> statement-breakpoint
ALTER TABLE "WorkflowCredentials" ADD COLUMN "appId" text;--> statement-breakpoint
ALTER TABLE "WorkflowCredentials" ADD COLUMN "appInstallationId" text;--> statement-breakpoint
ALTER TABLE "WorkflowCredentials" ADD CONSTRAINT "WorkflowCredentials_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkflowCredentials" ADD CONSTRAINT "WorkflowCredentials_appId_App_id_fk" FOREIGN KEY ("appId") REFERENCES "public"."App"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "WorkflowCredentials" ADD CONSTRAINT "WorkflowCredentials_appInstallationId_AppInstallation_id_fk" FOREIGN KEY ("appInstallationId") REFERENCES "public"."AppInstallation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "WorkflowCredentials_appId_organizationId_idx" ON "WorkflowCredentials" USING btree ("appId","organizationId");--> statement-breakpoint
CREATE INDEX "WorkflowCredentials_userId_appId_idx" ON "WorkflowCredentials" USING btree ("userId","appId");--> statement-breakpoint
CREATE INDEX "WorkflowCredentials_appInstallationId_idx" ON "WorkflowCredentials" USING btree ("appInstallationId");