ALTER TABLE "ChatWidget" ADD COLUMN "defaultTheme" text DEFAULT 'light' NOT NULL;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "primaryColorDark" text;--> statement-breakpoint
ALTER TABLE "ChatWidget" ADD COLUMN "headerColorDark" text;