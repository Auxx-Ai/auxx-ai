CREATE TABLE "AppEventLog" (
	"id" text PRIMARY KEY NOT NULL,
	"appId" text NOT NULL,
	"workspaceSlug" text,
	"userId" text,
	"eventType" text NOT NULL,
	"eventData" jsonb,
	"requestMethod" text,
	"requestPath" text,
	"responseStatus" integer,
	"durationMs" integer,
	"timestamp" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AppMarketplaceImage" (
	"id" text PRIMARY KEY NOT NULL,
	"developerAccountId" text NOT NULL,
	"appId" text NOT NULL,
	"fileExtension" text NOT NULL,
	"sortOrder" text,
	"savedSortOrder" text,
	"uploadCompletedAt" timestamp (3),
	"lastSavedAt" timestamp (3),
	"archivedAt" timestamp (3),
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AppVersion" (
	"id" text PRIMARY KEY NOT NULL,
	"appId" text NOT NULL,
	"major" integer NOT NULL,
	"minor" integer DEFAULT 0,
	"patch" integer DEFAULT 0,
	"status" text DEFAULT 'draft',
	"releaseNotes" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"createdById" text
);
--> statement-breakpoint
CREATE TABLE "App" (
	"id" text PRIMARY KEY NOT NULL,
	"developerAccountId" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"avatarId" text,
	"avatarUrl" text,
	"category" text,
	"websiteUrl" text,
	"documentationUrl" text,
	"contactUrl" text,
	"supportSiteUrl" text,
	"termsOfServiceUrl" text,
	"overview" text,
	"contentOverview" text,
	"contentHowItWorks" text,
	"contentConfigure" text,
	"scopes" jsonb DEFAULT '[]'::jsonb,
	"hasOauth" boolean DEFAULT false,
	"oauthExternalEntrypointUrl" text,
	"oauthRedirectUris" jsonb DEFAULT '[]'::jsonb,
	"hasBundle" boolean DEFAULT false,
	"publicationStatus" text DEFAULT 'private',
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "App_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ConnectionDefinition" (
	"id" text PRIMARY KEY NOT NULL,
	"developerAccountId" text NOT NULL,
	"appId" text NOT NULL,
	"major" integer NOT NULL,
	"connectionType" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"global" boolean DEFAULT false,
	"oauth2AuthorizeUrl" text,
	"oauth2AccessTokenUrl" text,
	"oauth2Scopes" jsonb DEFAULT '[]'::jsonb,
	"oauth2ClientId" text,
	"oauth2ClientSecret" text,
	"oauth2TokenRequestAuthMethod" text DEFAULT 'request-body',
	"oauth2RefreshTokenIntervalSeconds" integer,
	"createdById" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "DeveloperAccountInvite" (
	"id" text PRIMARY KEY NOT NULL,
	"developerAccountId" text NOT NULL,
	"emailAddress" text NOT NULL,
	"accessLevel" text DEFAULT 'member' NOT NULL,
	"failedToSend" boolean DEFAULT false,
	"acceptedAt" timestamp (3),
	"createdById" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "DeveloperAccountMember" (
	"id" text PRIMARY KEY NOT NULL,
	"developerAccountId" text NOT NULL,
	"userId" text NOT NULL,
	"emailAddress" text NOT NULL,
	"accessLevel" text DEFAULT 'member' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "DeveloperAccount" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"logoId" text,
	"logoUrl" text,
	"featureFlags" jsonb DEFAULT '{"legacy-collection-scopes":false,"search-records-api":false,"find-create-meetings-api":false,"get-list-meetings-api":true,"write-call-recordings-api":false,"read-call-recordings-api":true}'::jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "DeveloperAccount_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "AppEventLog" ADD CONSTRAINT "AppEventLog_appId_App_id_fk" FOREIGN KEY ("appId") REFERENCES "public"."App"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppMarketplaceImage" ADD CONSTRAINT "AppMarketplaceImage_developerAccountId_DeveloperAccount_id_fk" FOREIGN KEY ("developerAccountId") REFERENCES "public"."DeveloperAccount"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppMarketplaceImage" ADD CONSTRAINT "AppMarketplaceImage_appId_App_id_fk" FOREIGN KEY ("appId") REFERENCES "public"."App"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppVersion" ADD CONSTRAINT "AppVersion_appId_App_id_fk" FOREIGN KEY ("appId") REFERENCES "public"."App"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AppVersion" ADD CONSTRAINT "AppVersion_createdById_DeveloperAccountMember_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."DeveloperAccountMember"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "App" ADD CONSTRAINT "App_developerAccountId_DeveloperAccount_id_fk" FOREIGN KEY ("developerAccountId") REFERENCES "public"."DeveloperAccount"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ConnectionDefinition" ADD CONSTRAINT "ConnectionDefinition_developerAccountId_DeveloperAccount_id_fk" FOREIGN KEY ("developerAccountId") REFERENCES "public"."DeveloperAccount"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ConnectionDefinition" ADD CONSTRAINT "ConnectionDefinition_appId_App_id_fk" FOREIGN KEY ("appId") REFERENCES "public"."App"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DeveloperAccountInvite" ADD CONSTRAINT "DeveloperAccountInvite_developerAccountId_DeveloperAccount_id_fk" FOREIGN KEY ("developerAccountId") REFERENCES "public"."DeveloperAccount"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DeveloperAccountMember" ADD CONSTRAINT "DeveloperAccountMember_developerAccountId_DeveloperAccount_id_fk" FOREIGN KEY ("developerAccountId") REFERENCES "public"."DeveloperAccount"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DeveloperAccountMember" ADD CONSTRAINT "DeveloperAccountMember_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "AppEventLog_appId_idx" ON "AppEventLog" USING btree ("appId");--> statement-breakpoint
CREATE INDEX "AppEventLog_timestamp_idx" ON "AppEventLog" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "AppMarketplaceImage_appId_idx" ON "AppMarketplaceImage" USING btree ("appId");--> statement-breakpoint
CREATE INDEX "AppVersion_appId_idx" ON "AppVersion" USING btree ("appId");--> statement-breakpoint
CREATE UNIQUE INDEX "App_slug_idx" ON "App" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "App_developerAccountId_idx" ON "App" USING btree ("developerAccountId");--> statement-breakpoint
CREATE INDEX "ConnectionDefinition_app_version_idx" ON "ConnectionDefinition" USING btree ("appId","major");--> statement-breakpoint
CREATE INDEX "DeveloperAccountInvite_account_idx" ON "DeveloperAccountInvite" USING btree ("developerAccountId");--> statement-breakpoint
CREATE UNIQUE INDEX "DeveloperAccountMember_unique_idx" ON "DeveloperAccountMember" USING btree ("developerAccountId","userId");--> statement-breakpoint
CREATE INDEX "DeveloperAccountMember_userId_idx" ON "DeveloperAccountMember" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "DeveloperAccount_slug_idx" ON "DeveloperAccount" USING btree ("slug");