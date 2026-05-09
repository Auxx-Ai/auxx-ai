ALTER TABLE "ArticleRevision" ADD COLUMN "coverImage" text;--> statement-breakpoint
ALTER TABLE "ArticleRevision" ADD COLUMN "coverImageId" text;--> statement-breakpoint
ALTER TABLE "Article" ADD COLUMN "aiEnabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ArticleRevision" ADD CONSTRAINT "ArticleRevision_coverImageId_MediaAsset_id_fk" FOREIGN KEY ("coverImageId") REFERENCES "public"."MediaAsset"("id") ON DELETE no action ON UPDATE cascade;