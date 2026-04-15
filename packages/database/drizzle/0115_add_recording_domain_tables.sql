CREATE TYPE "public"."CalendarEventStatus" AS ENUM('confirmed', 'tentative', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."CalendarProvider" AS ENUM('google', 'outlook');--> statement-breakpoint
CREATE TYPE "public"."InsightStatus" AS ENUM('processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."InsightTemplateStatus" AS ENUM('enabled', 'disabled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."MeetingPlatform" AS ENUM('google_meet', 'teams', 'zoom', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."RecordingProvider" AS ENUM('recall', 'babl', 'self_hosted');--> statement-breakpoint
CREATE TYPE "public"."RecordingStatus" AS ENUM('created', 'joining', 'waiting', 'admitted', 'recording', 'processing', 'completed', 'failed', 'kicked', 'denied', 'timeout', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."RsvpStatus" AS ENUM('accepted', 'declined', 'tentative', 'needs_action');--> statement-breakpoint
CREATE TYPE "public"."TranscriptStatus" AS ENUM('processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."TranscriptType" AS ENUM('realtime', 'async');--> statement-breakpoint
CREATE TYPE "public"."TranscriptionProvider" AS ENUM('deepgram', 'whisper', 'assemblyai', 'gladia', 'meeting_captions');--> statement-breakpoint
ALTER TYPE "public"."SettingScope" ADD VALUE 'RECORDING';--> statement-breakpoint
CREATE TABLE "CalendarEvent" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"provider" "CalendarProvider" NOT NULL,
	"externalId" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"startTime" timestamp (3) with time zone NOT NULL,
	"endTime" timestamp (3) with time zone NOT NULL,
	"timezone" text NOT NULL,
	"meetingUrl" text,
	"meetingPlatform" "MeetingPlatform",
	"location" text,
	"isAllDay" boolean DEFAULT false NOT NULL,
	"status" "CalendarEventStatus" DEFAULT 'confirmed' NOT NULL,
	"organizer" jsonb NOT NULL,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isExternal" boolean DEFAULT false NOT NULL,
	"recurringEventId" text,
	"rawData" jsonb,
	"syncedAt" timestamp (3) with time zone NOT NULL,
	"entityInstanceId" text,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CallRecording" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"meetingId" text NOT NULL,
	"calendarEventId" text,
	"provider" "RecordingProvider" NOT NULL,
	"meetingPlatform" "MeetingPlatform" NOT NULL,
	"externalBotId" text NOT NULL,
	"status" "RecordingStatus" DEFAULT 'created' NOT NULL,
	"videoFileId" text,
	"audioFileId" text,
	"videoPreviewFileId" text,
	"videoStoryboardFileId" text,
	"durationSeconds" integer,
	"botName" text NOT NULL,
	"consentMessage" text,
	"startedAt" timestamp (3) with time zone,
	"endedAt" timestamp (3) with time zone,
	"failureReason" text,
	"metadata" jsonb,
	"createdById" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "InsightTemplate" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"title" text NOT NULL,
	"aiTitle" text,
	"status" "InsightTemplateStatus" DEFAULT 'enabled' NOT NULL,
	"sections" jsonb NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"sortOrder" text NOT NULL,
	"createdById" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "MeetingParticipant" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"meetingId" text NOT NULL,
	"calendarEventId" text,
	"userId" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailDomain" text NOT NULL,
	"contactEntityInstanceId" text,
	"companyEntityInstanceId" text,
	"isOrganizer" boolean DEFAULT false NOT NULL,
	"rsvpStatus" "RsvpStatus" DEFAULT 'needs_action' NOT NULL,
	"isBot" boolean DEFAULT false NOT NULL,
	"isExternal" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RecordingChapter" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"callRecordingId" text NOT NULL,
	"title" text NOT NULL,
	"startMs" integer NOT NULL,
	"endMs" integer NOT NULL,
	"sortOrder" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RecordingInsight" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"callRecordingId" text NOT NULL,
	"insightTemplateId" text NOT NULL,
	"status" "InsightStatus" DEFAULT 'processing' NOT NULL,
	"sections" jsonb,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "RecordingShareLink" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"callRecordingId" text NOT NULL,
	"publicId" text NOT NULL,
	"expiresAt" timestamp (3) with time zone,
	"password" text,
	"includeVideo" boolean DEFAULT true NOT NULL,
	"includeTranscript" boolean DEFAULT true NOT NULL,
	"includeInsights" boolean DEFAULT false NOT NULL,
	"createdById" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Transcript" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"callRecordingId" text NOT NULL,
	"transcriptionProvider" "TranscriptionProvider" NOT NULL,
	"type" "TranscriptType" NOT NULL,
	"language" text,
	"status" "TranscriptStatus" DEFAULT 'processing' NOT NULL,
	"externalJobId" text,
	"fullText" text,
	"wordCount" integer,
	"confidence" double precision,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TranscriptSpeaker" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"transcriptId" text NOT NULL,
	"callRecordingId" text NOT NULL,
	"name" text NOT NULL,
	"isHost" boolean,
	"participantId" text,
	"manualParticipantId" text,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TranscriptUtterance" (
	"id" text PRIMARY KEY NOT NULL,
	"organizationId" text NOT NULL,
	"transcriptId" text NOT NULL,
	"speakerId" text NOT NULL,
	"startMs" integer NOT NULL,
	"endMs" integer NOT NULL,
	"text" text NOT NULL,
	"confidence" double precision,
	"sortOrder" integer NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_entityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("entityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_meetingId_EntityInstance_id_fk" FOREIGN KEY ("meetingId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_calendarEventId_CalendarEvent_id_fk" FOREIGN KEY ("calendarEventId") REFERENCES "public"."CalendarEvent"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_videoFileId_File_id_fk" FOREIGN KEY ("videoFileId") REFERENCES "public"."File"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_audioFileId_File_id_fk" FOREIGN KEY ("audioFileId") REFERENCES "public"."File"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_videoPreviewFileId_File_id_fk" FOREIGN KEY ("videoPreviewFileId") REFERENCES "public"."File"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_videoStoryboardFileId_File_id_fk" FOREIGN KEY ("videoStoryboardFileId") REFERENCES "public"."File"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CallRecording" ADD CONSTRAINT "CallRecording_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InsightTemplate" ADD CONSTRAINT "InsightTemplate_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InsightTemplate" ADD CONSTRAINT "InsightTemplate_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_EntityInstance_id_fk" FOREIGN KEY ("meetingId") REFERENCES "public"."EntityInstance"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_calendarEventId_CalendarEvent_id_fk" FOREIGN KEY ("calendarEventId") REFERENCES "public"."CalendarEvent"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_contactEntityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("contactEntityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_companyEntityInstanceId_EntityInstance_id_fk" FOREIGN KEY ("companyEntityInstanceId") REFERENCES "public"."EntityInstance"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordingChapter" ADD CONSTRAINT "RecordingChapter_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordingChapter" ADD CONSTRAINT "RecordingChapter_callRecordingId_CallRecording_id_fk" FOREIGN KEY ("callRecordingId") REFERENCES "public"."CallRecording"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordingInsight" ADD CONSTRAINT "RecordingInsight_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordingInsight" ADD CONSTRAINT "RecordingInsight_callRecordingId_CallRecording_id_fk" FOREIGN KEY ("callRecordingId") REFERENCES "public"."CallRecording"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordingInsight" ADD CONSTRAINT "RecordingInsight_insightTemplateId_InsightTemplate_id_fk" FOREIGN KEY ("insightTemplateId") REFERENCES "public"."InsightTemplate"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordingShareLink" ADD CONSTRAINT "RecordingShareLink_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordingShareLink" ADD CONSTRAINT "RecordingShareLink_callRecordingId_CallRecording_id_fk" FOREIGN KEY ("callRecordingId") REFERENCES "public"."CallRecording"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "RecordingShareLink" ADD CONSTRAINT "RecordingShareLink_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_callRecordingId_CallRecording_id_fk" FOREIGN KEY ("callRecordingId") REFERENCES "public"."CallRecording"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TranscriptSpeaker" ADD CONSTRAINT "TranscriptSpeaker_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TranscriptSpeaker" ADD CONSTRAINT "TranscriptSpeaker_transcriptId_Transcript_id_fk" FOREIGN KEY ("transcriptId") REFERENCES "public"."Transcript"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TranscriptSpeaker" ADD CONSTRAINT "TranscriptSpeaker_callRecordingId_CallRecording_id_fk" FOREIGN KEY ("callRecordingId") REFERENCES "public"."CallRecording"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TranscriptSpeaker" ADD CONSTRAINT "TranscriptSpeaker_participantId_MeetingParticipant_id_fk" FOREIGN KEY ("participantId") REFERENCES "public"."MeetingParticipant"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TranscriptSpeaker" ADD CONSTRAINT "TranscriptSpeaker_manualParticipantId_MeetingParticipant_id_fk" FOREIGN KEY ("manualParticipantId") REFERENCES "public"."MeetingParticipant"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TranscriptUtterance" ADD CONSTRAINT "TranscriptUtterance_organizationId_Organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TranscriptUtterance" ADD CONSTRAINT "TranscriptUtterance_transcriptId_Transcript_id_fk" FOREIGN KEY ("transcriptId") REFERENCES "public"."Transcript"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TranscriptUtterance" ADD CONSTRAINT "TranscriptUtterance_speakerId_TranscriptSpeaker_id_fk" FOREIGN KEY ("speakerId") REFERENCES "public"."TranscriptSpeaker"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "CalendarEvent_org_provider_externalId_key" ON "CalendarEvent" USING btree ("organizationId","provider","externalId");--> statement-breakpoint
CREATE INDEX "CalendarEvent_organizationId_idx" ON "CalendarEvent" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "CalendarEvent_userId_idx" ON "CalendarEvent" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "CalendarEvent_startTime_endTime_idx" ON "CalendarEvent" USING btree ("startTime","endTime");--> statement-breakpoint
CREATE INDEX "CalendarEvent_entityInstanceId_idx" ON "CalendarEvent" USING btree ("entityInstanceId");--> statement-breakpoint
CREATE INDEX "CallRecording_organizationId_idx" ON "CallRecording" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "CallRecording_meetingId_idx" ON "CallRecording" USING btree ("meetingId");--> statement-breakpoint
CREATE INDEX "CallRecording_calendarEventId_idx" ON "CallRecording" USING btree ("calendarEventId");--> statement-breakpoint
CREATE INDEX "CallRecording_status_idx" ON "CallRecording" USING btree ("status");--> statement-breakpoint
CREATE INDEX "CallRecording_organizationId_status_idx" ON "CallRecording" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX "CallRecording_externalBotId_idx" ON "CallRecording" USING btree ("externalBotId");--> statement-breakpoint
CREATE INDEX "CallRecording_createdById_idx" ON "CallRecording" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "InsightTemplate_organizationId_idx" ON "InsightTemplate" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "InsightTemplate_organizationId_status_idx" ON "InsightTemplate" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX "MeetingParticipant_organizationId_idx" ON "MeetingParticipant" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "MeetingParticipant_meetingId_idx" ON "MeetingParticipant" USING btree ("meetingId");--> statement-breakpoint
CREATE INDEX "MeetingParticipant_calendarEventId_idx" ON "MeetingParticipant" USING btree ("calendarEventId");--> statement-breakpoint
CREATE INDEX "MeetingParticipant_email_idx" ON "MeetingParticipant" USING btree ("email");--> statement-breakpoint
CREATE INDEX "MeetingParticipant_emailDomain_idx" ON "MeetingParticipant" USING btree ("emailDomain");--> statement-breakpoint
CREATE INDEX "MeetingParticipant_contactEntityInstanceId_idx" ON "MeetingParticipant" USING btree ("contactEntityInstanceId");--> statement-breakpoint
CREATE INDEX "MeetingParticipant_companyEntityInstanceId_idx" ON "MeetingParticipant" USING btree ("companyEntityInstanceId");--> statement-breakpoint
CREATE INDEX "RecordingChapter_callRecordingId_sortOrder_idx" ON "RecordingChapter" USING btree ("callRecordingId","sortOrder");--> statement-breakpoint
CREATE INDEX "RecordingInsight_callRecordingId_idx" ON "RecordingInsight" USING btree ("callRecordingId");--> statement-breakpoint
CREATE INDEX "RecordingInsight_insightTemplateId_idx" ON "RecordingInsight" USING btree ("insightTemplateId");--> statement-breakpoint
CREATE INDEX "RecordingInsight_organizationId_idx" ON "RecordingInsight" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "RecordingShareLink_publicId_key" ON "RecordingShareLink" USING btree ("publicId");--> statement-breakpoint
CREATE INDEX "RecordingShareLink_callRecordingId_idx" ON "RecordingShareLink" USING btree ("callRecordingId");--> statement-breakpoint
CREATE INDEX "Transcript_organizationId_idx" ON "Transcript" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Transcript_callRecordingId_idx" ON "Transcript" USING btree ("callRecordingId");--> statement-breakpoint
CREATE INDEX "Transcript_status_idx" ON "Transcript" USING btree ("status");--> statement-breakpoint
CREATE INDEX "TranscriptSpeaker_transcriptId_idx" ON "TranscriptSpeaker" USING btree ("transcriptId");--> statement-breakpoint
CREATE INDEX "TranscriptSpeaker_callRecordingId_idx" ON "TranscriptSpeaker" USING btree ("callRecordingId");--> statement-breakpoint
CREATE INDEX "TranscriptUtterance_transcriptId_sortOrder_idx" ON "TranscriptUtterance" USING btree ("transcriptId","sortOrder");--> statement-breakpoint
CREATE INDEX "TranscriptUtterance_speakerId_idx" ON "TranscriptUtterance" USING btree ("speakerId");