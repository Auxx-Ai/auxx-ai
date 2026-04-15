ALTER TABLE "CallRecording" RENAME COLUMN "videoFileId" TO "videoAssetId";--> statement-breakpoint
ALTER TABLE "CallRecording" RENAME COLUMN "audioFileId" TO "audioAssetId";--> statement-breakpoint
ALTER TABLE "CallRecording" RENAME COLUMN "videoPreviewFileId" TO "videoPreviewAssetId";--> statement-breakpoint
ALTER TABLE "CallRecording" RENAME COLUMN "videoStoryboardFileId" TO "videoStoryboardAssetId";--> statement-breakpoint
ALTER TABLE "CallRecording" DROP CONSTRAINT "CallRecording_videoFileId_File_id_fk";
--> statement-breakpoint
ALTER TABLE "CallRecording" DROP CONSTRAINT "CallRecording_audioFileId_File_id_fk";
--> statement-breakpoint
ALTER TABLE "CallRecording" DROP CONSTRAINT "CallRecording_videoPreviewFileId_File_id_fk";
--> statement-breakpoint
ALTER TABLE "CallRecording" DROP CONSTRAINT "CallRecording_videoStoryboardFileId_File_id_fk";
--> statement-breakpoint
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_videoAssetId_MediaAsset_id_fk" FOREIGN KEY ("videoAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_audioAssetId_MediaAsset_id_fk" FOREIGN KEY ("audioAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_videoPreviewAssetId_MediaAsset_id_fk" FOREIGN KEY ("videoPreviewAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_videoStoryboardAssetId_MediaAsset_id_fk" FOREIGN KEY ("videoStoryboardAssetId") REFERENCES "public"."MediaAsset"("id") ON DELETE set null ON UPDATE cascade;