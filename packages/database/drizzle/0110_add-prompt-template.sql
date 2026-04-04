CREATE TABLE "PromptTemplate" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"prompt" text NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"icon" jsonb,
	"organizationId" text,
	"createdById" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "PromptTemplate_organizationId_idx" ON "PromptTemplate" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "PromptTemplate_categories_idx" ON "PromptTemplate" USING gin ("categories");