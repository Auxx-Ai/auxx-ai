ALTER TABLE "MediaAssetVersion" DROP CONSTRAINT "MediaAssetVersion_derivedFromVersionId_MediaAssetVersion_id_fk";
--> statement-breakpoint
ALTER TABLE "MediaAssetVersion" ADD CONSTRAINT "MediaAssetVersion_derivedFromVersionId_MediaAssetVersion_id_fk" FOREIGN KEY ("derivedFromVersionId") REFERENCES "public"."MediaAssetVersion"("id") ON DELETE cascade ON UPDATE cascade;