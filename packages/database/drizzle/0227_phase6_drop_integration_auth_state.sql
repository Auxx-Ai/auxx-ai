ALTER TABLE "Integration" DROP COLUMN "expiresAt";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "authStatus";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "requiresReauth";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "lastAuthError";--> statement-breakpoint
ALTER TABLE "Integration" DROP COLUMN "lastAuthErrorAt";--> statement-breakpoint
DROP TYPE "public"."IntegrationAuthStatus";