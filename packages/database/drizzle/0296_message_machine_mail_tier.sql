CREATE TYPE "public"."MachineMailTier" AS ENUM('hard', 'soft');--> statement-breakpoint
ALTER TABLE "Message" ADD COLUMN "machineMailTier" "MachineMailTier";--> statement-breakpoint
CREATE INDEX "Message_machineMailTier_idx" ON "Message" USING btree ("organizationId","machineMailTier") WHERE ("machineMailTier" IS NOT NULL);