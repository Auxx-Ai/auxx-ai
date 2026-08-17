// packages/lib/src/participants/search/index.ts
//
// Ranked recipient search: participants ∪ contacts. Explicit named exports per
// `docs/lib-module-guide.md`.
//
// `searchRecipients` is the entry point; the SQL builders are exported too
// because they are the reviewable unit — index-servability is a property of the
// text they emit, and they are pinned by rendered-SQL tests that the read
// function's own integration path cannot express.

export {
  type ParticipantSearchBinding,
  participantRecencyScore,
  participantSearchBinding,
  participantSearchPredicate,
  participantSearchRank,
} from './participant-search-sql'
export { phoneSearchPatterns } from './phone-query'
export {
  type RecipientCandidate,
  type RecipientSearchResult,
  type SearchRecipientsParams,
  searchRecipients,
} from './search-recipients'
