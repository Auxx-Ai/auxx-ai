// packages/lib/src/workflow-engine/nodes/sequence-send-email/types.ts
// Config/trigger-data shapes for the `sequence-send-email` node (Sequences
// plan §3.2/§3.3). Server-registered only — never exposed in the user-facing
// node palette. `publishSequence` (Phase 2) is the sole writer of a compiled
// step node's `data`; nothing in the UI authors this shape directly.

import type { TiptapDoc } from '../../../tiptap'

/** A compiled sequence step's node config — written by `publishSequence`. */
export interface SequenceSendEmailNodeConfig {
  sequenceId: string
  stepId: string
  /** 1-based position in the compiled step chain. */
  stepIndex: number
  /** Used only when this step opens the thread (step 1 / no `threadId` yet). */
  subject?: string | null
  /** Immutable TipTap snapshot — placeholder nodes resolve structurally at send time. */
  bodyJson: TiptapDoc
  attachmentIds: string[]
  /** Pinned sending mailbox (`Sequence.integrationId`). */
  integrationId: string
  signatureId?: string | null
}

/** `sys.triggerData` shape for a sequence's system workflow run (§3.3). */
export interface SequenceTriggerData {
  sequenceRunId: string
  sequenceId: string
  recipientEntityInstanceId: string
  recipientEmail: string
}
