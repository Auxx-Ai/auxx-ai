ALTER TABLE "ChatWidget" ADD COLUMN "logoLight" text;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "logoDark" text;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "logoLightId" text;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "logoDarkId" text;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD CONSTRAINT "ChatWidget_logoLightId_MediaAsset_id_fk" FOREIGN KEY ("logoLightId") REFERENCES "public"."MediaAsset"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD CONSTRAINT "ChatWidget_logoDarkId_MediaAsset_id_fk" FOREIGN KEY ("logoDarkId") REFERENCES "public"."MediaAsset"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "ChatWidget_logoLightId_key" ON "ChatWidget" USING btree ("logoLightId");--> statement-breakpoint
CREATE UNIQUE INDEX "ChatWidget_logoDarkId_key" ON "ChatWidget" USING btree ("logoDarkId");--> statement-breakpoint
ALTER TABLE "ChatWidget" DROP COLUMN "logoUrl";