ALTER TABLE "ChatWidget" ADD COLUMN "homeGreetingTemplate" text;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "homeShowRecentMessage" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "homeShowSendMessageCta" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "brandingFooterEnabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "expandedWidthPx" integer DEFAULT 720 NOT NULL;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "knowledgeBaseId" text;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "featuredArticleIds" text[];--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "allowDownloadTranscript" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD CONSTRAINT "ChatWidget_knowledgeBaseId_KnowledgeBase_id_fk" FOREIGN KEY ("knowledgeBaseId") REFERENCES "public"."KnowledgeBase"("id") ON DELETE set null ON UPDATE cascade;