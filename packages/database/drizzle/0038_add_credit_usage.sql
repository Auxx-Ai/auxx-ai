CREATE TYPE "public"."CredentialSource" AS ENUM('SYSTEM', 'CUSTOM', 'MODEL_SPECIFIC', 'LOAD_BALANCED');--> statement-breakpoint
ALTER TABLE "AiUsage" ADD COLUMN "creditsUsed" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "AiUsage" ADD COLUMN "providerType" "ProviderType";--> statement-breakpoint
ALTER TABLE "AiUsage" ADD COLUMN "credentialSource" "CredentialSource";