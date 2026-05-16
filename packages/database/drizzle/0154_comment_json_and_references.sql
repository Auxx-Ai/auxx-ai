-- Pre-launch: no production users yet. Existing Comment rows are dev/seed only;
-- truncate them so `ALTER TABLE ... ADD COLUMN ... NOT NULL` doesn't trip on
-- rows that lack a contentJson. CASCADE clears CommentReaction etc. too.
TRUNCATE TABLE "Comment" CASCADE;
--> statement-breakpoint
CREATE TABLE "CommentReference" (
	"id" text PRIMARY KEY NOT NULL,
	"commentId" text NOT NULL,
	"entityDefinitionId" text NOT NULL,
	"entityInstanceId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "CommentMention" CASCADE;--> statement-breakpoint
ALTER TABLE "Comment" ADD COLUMN "contentJson" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "CommentReference" ADD CONSTRAINT "CommentReference_commentId_Comment_id_fk" FOREIGN KEY ("commentId") REFERENCES "public"."Comment"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "CommentReference_commentId_idx" ON "CommentReference" USING btree ("commentId");--> statement-breakpoint
CREATE UNIQUE INDEX "CommentReference_commentId_def_inst_key" ON "CommentReference" USING btree ("commentId","entityDefinitionId","entityInstanceId");--> statement-breakpoint
CREATE INDEX "CommentReference_def_inst_idx" ON "CommentReference" USING btree ("entityDefinitionId","entityInstanceId");--> statement-breakpoint
ALTER TABLE "Comment" DROP COLUMN "content";