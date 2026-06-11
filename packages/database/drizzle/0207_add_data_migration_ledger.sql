CREATE TABLE "DataMigration" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"durationMs" integer,
	"appliedAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
