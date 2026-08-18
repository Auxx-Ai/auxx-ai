DROP TYPE "public"."MessageType";--> statement-breakpoint
CREATE TYPE "public"."MessageType" AS ENUM('EMAIL', 'SMS', 'CHAT', 'CALL', 'VOICEMAIL');