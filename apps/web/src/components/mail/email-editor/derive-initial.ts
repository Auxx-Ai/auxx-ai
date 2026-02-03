import type {
  EditorMode,
  RecipientState,
  EditorThread,
  MessageType,
  DraftMessageType,
  DraftMetadata,
  EditorPresetValues,
} from './types'
import { ParticipantRole } from '@auxx/database/enums'

/**
 * Deduplicate recipients by identifier to prevent duplicate entries
 */
function deduplicateRecipients(recipients: RecipientState[]): RecipientState[] {
  const seen = new Set<string>()
  return recipients.filter((r) => {
    if (seen.has(r.identifier)) return false
    seen.add(r.identifier)
    return true
  })
}

/**
 * Validate and sanitize preset values to ensure data integrity
 */
function validatePresetValues(
  presetValues?: EditorPresetValues
): EditorPresetValues | undefined {
  if (!presetValues) return undefined

  const sanitized: EditorPresetValues = {}

  // Validate recipients - ensure they have required fields
  if (presetValues.to) {
    sanitized.to = presetValues.to.filter((r) => r.identifier && r.identifierType)
  }
  if (presetValues.cc) {
    sanitized.cc = presetValues.cc.filter((r) => r.identifier && r.identifierType)
  }
  if (presetValues.bcc) {
    sanitized.bcc = presetValues.bcc.filter((r) => r.identifier && r.identifierType)
  }

  // Validate subject (trim whitespace)
  if (presetValues.subject !== undefined) {
    sanitized.subject = presetValues.subject.trim()
  }

  // Validate contentHtml (ensure valid HTML structure)
  if (presetValues.contentHtml) {
    const content = presetValues.contentHtml.trim()
    sanitized.contentHtml = content || '<p></p>'
  }

  // Pass through other fields as-is
  if (presetValues.integrationId) sanitized.integrationId = presetValues.integrationId
  if (presetValues.signatureId !== undefined) sanitized.signatureId = presetValues.signatureId
  if (presetValues.includePreviousMessage !== undefined) {
    sanitized.includePreviousMessage = presetValues.includePreviousMessage
  }
  if (presetValues.sourceMessage) sanitized.sourceMessage = presetValues.sourceMessage
  if (presetValues.attachments) sanitized.attachments = presetValues.attachments

  return sanitized
}

export interface InitState {
  to: RecipientState[]
  cc: RecipientState[]
  bcc: RecipientState[]
  subject: string
  contentHtml: string
  signatureId: string | null
  includePrev: boolean
  draftId: string | null
  threadId: string | null
  sourceMessageId: string | null
  integrationId: string
}
/**
 * Pure function that derives the initial state for the email editor.
 * No side effects, no editor access, no logs - just pure data transformation.
 * Presets are applied after deriving base state, but are ignored if a draft exists.
 */
export function deriveInitialState({
  mode,
  thread,
  sourceMessage,
  draft,
  defaultIntegrationId,
  presetValues,
}: {
  mode: EditorMode
  thread?: EditorThread | null
  sourceMessage?: MessageType | null
  draft?: DraftMessageType | null
  defaultIntegrationId?: string
  presetValues?: EditorPresetValues
}): InitState {
  // 1) If there's a draft, load everything from it and return early
  if (draft) {
    const to: RecipientState[] = []
    const cc: RecipientState[] = []
    const bcc: RecipientState[] = []
    draft.participants?.forEach((p) => {
      const participant = p.participant
      if (!participant) {
        return
      }
      const recipient: RecipientState = {
        id: participant.id,
        identifier: participant.identifier,
        identifierType: participant.identifierType,
        name: participant.name,
      }
      if (p.role === ParticipantRole.TO) to.push(recipient)
      else if (p.role === ParticipantRole.CC) cc.push(recipient)
      else if (p.role === ParticipantRole.BCC) bcc.push(recipient)
    })
    const metadata = (draft.metadata ?? {}) as DraftMetadata
    return {
      to,
      cc,
      bcc,
      subject: draft.subject ?? '',
      contentHtml: draft.textHtml ?? `<p>${draft.textPlain?.replace(/\n/g, '<br>') ?? ''}</p>`,
      signatureId: draft.signatureId ?? null,
      includePrev: !!metadata.includePreviousMessage,
      draftId: draft.id,
      threadId: draft.threadId ?? thread?.id ?? null,
      sourceMessageId: metadata.sourceMessageId ?? null,
      integrationId: thread?.integrationId ?? defaultIntegrationId ?? '',
    }
  }
  // 2) No draft: build from message context depending on mode
  const baseSubject = sourceMessage?.subject ?? thread?.subject ?? ''
  let subject = baseSubject
  if (mode === 'reply' || mode === 'replyAll') {
    if (!baseSubject.toLowerCase().startsWith('re:')) {
      subject = `Re: ${baseSubject}`
    }
  } else if (mode === 'forward') {
    if (!baseSubject.toLowerCase().startsWith('fwd:')) {
      subject = `Fwd: ${baseSubject}`
    }
  }
  const to: RecipientState[] = []
  const cc: RecipientState[] = []
  const bcc: RecipientState[] = []
  if (sourceMessage && (mode === 'reply' || mode === 'replyAll')) {
    // Add sender to TO field
    const from = sourceMessage.from
    if (from) {
      to.push({
        id: from.id,
        identifier: from.identifier,
        identifierType: from.identifierType,
        name: from.name,
      })
    }
    // For reply all, add other participants to CC
    if (mode === 'replyAll') {
      const addedIds = new Set(to.map((r) => r.id))
      sourceMessage.participants?.forEach((p) => {
        const participant = p.participant
        if (!participant || addedIds.has(participant.id)) return
        if (p.role === ParticipantRole.TO || p.role === ParticipantRole.CC) {
          cc.push({
            id: participant.id,
            identifier: participant.identifier,
            identifierType: participant.identifierType,
            name: participant.name,
          })
          addedIds.add(participant.id)
        }
      })
    }
  }
  // 3) Build base state from derived values
  const baseState: InitState = {
    to,
    cc,
    bcc,
    subject: mode === 'new' ? '' : subject,
    contentHtml: '<p></p>',
    signatureId: null,
    includePrev: !!(
      sourceMessage &&
      (mode === 'reply' || mode === 'replyAll' || mode === 'forward')
    ),
    draftId: null,
    threadId: thread?.id ?? null,
    sourceMessageId: sourceMessage?.id ?? null,
    integrationId: thread?.integrationId ?? (mode === 'new' ? (defaultIntegrationId ?? '') : ''),
  }

  // 4) Apply preset values if provided (validated and deduplicated)
  const validatedPresets = validatePresetValues(presetValues)
  if (validatedPresets) {
    return {
      ...baseState,
      to: validatedPresets.to ? deduplicateRecipients(validatedPresets.to) : baseState.to,
      cc: validatedPresets.cc ? deduplicateRecipients(validatedPresets.cc) : baseState.cc,
      bcc: validatedPresets.bcc ? deduplicateRecipients(validatedPresets.bcc) : baseState.bcc,
      subject: validatedPresets.subject ?? baseState.subject,
      contentHtml: validatedPresets.contentHtml ?? baseState.contentHtml,
      integrationId: validatedPresets.integrationId ?? baseState.integrationId,
      signatureId: validatedPresets.signatureId ?? baseState.signatureId,
      includePrev: validatedPresets.includePreviousMessage ?? baseState.includePrev,
      sourceMessageId: validatedPresets.sourceMessage?.id ?? baseState.sourceMessageId,
    }
  }

  return baseState
}
