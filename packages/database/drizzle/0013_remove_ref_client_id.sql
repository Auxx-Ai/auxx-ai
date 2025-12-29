ALTER TABLE "oauthAccessToken" DROP CONSTRAINT "oauthAccessToken_clientId_oauthApplication_id_fk";
--> statement-breakpoint
ALTER TABLE "oauthConsent" DROP CONSTRAINT "oauthConsent_clientId_oauthApplication_id_fk";
