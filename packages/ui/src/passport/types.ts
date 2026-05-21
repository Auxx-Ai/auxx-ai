// packages/ui/src/passport/types.ts

/**
 * Passport data returned from a backend issuance endpoint.
 */
export interface PassportData {
  /** Signed JWT */
  passport: string
  /** Subject id (endUserId for workflows, visitor Participant.id for chat) */
  subjectId: string
  /** ISO timestamp */
  expiresAt: string
}

/**
 * Persisted passport blob (same shape as {@link PassportData}).
 */
export type StoredPassport = PassportData

/**
 * Async fetcher that returns a fresh passport for a given scope key
 * (shareToken / channelId / …).
 */
export type FetchPassport = (scopeKey: string) => Promise<PassportData>

/**
 * Shape returned by {@link usePassport}.
 */
export interface PassportContextValue {
  passport: string | null
  subjectId: string | null
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}
