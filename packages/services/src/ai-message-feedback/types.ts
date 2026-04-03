// packages/services/src/ai-message-feedback/types.ts

export interface UpsertMessageFeedbackInput {
  sessionId: string
  messageId: string
  /** true = thumbs up, false = thumbs down, null = delete feedback */
  isPositive: boolean | null
  organizationId: string
  userId: string
}

export interface GetSessionFeedbackInput {
  sessionId: string
  organizationId: string
}
