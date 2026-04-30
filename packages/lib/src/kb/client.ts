// packages/lib/src/kb/client.ts
// Client-safe exports for the KB module. This file MUST NOT pull in any
// server-only dependencies (Drizzle, tRPC, BullMQ, etc.).

export {
  DRAFT_SECTION_FIELDS,
  type DraftSection,
  draftedSections,
  hasUnpublishedSettings,
  type KBDraftSettings,
  mergeDraftOverLive,
} from './draft-settings'
