ALTER TABLE "User" DROP CONSTRAINT "User_avatarAssetId_MediaAsset_id_fk";
--> statement-breakpoint
ALTER TABLE "User" ADD CONSTRAINT "User_avatarAssetId_MediaAsset_id_fk" FOREIGN KEY ("avatarAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE set null ON UPDATE cascade;