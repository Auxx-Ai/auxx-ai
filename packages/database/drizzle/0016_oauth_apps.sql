ALTER TABLE "App" ADD COLUMN "oauthApplicationId" text;--> statement-breakpoint
ALTER TABLE "App" ADD CONSTRAINT "App_oauthApplicationId_oauthApplication_id_fk" FOREIGN KEY ("oauthApplicationId") REFERENCES "public"."oauthApplication"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "App" DROP COLUMN "oauthRedirectUris";