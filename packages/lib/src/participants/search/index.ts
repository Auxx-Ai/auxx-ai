// packages/lib/src/participants/search/index.ts
//
// Ranked recipient search. Explicit named exports per `docs/lib-module-guide.md`.
//
// The SQL builders ship ahead of the read function that assembles them
// (`search-recipients.ts`, the participants ∪ contacts union) so the two halves
// can be reviewed apart: these are pure, testable-by-rendered-SQL fragments with
// no IO, and index-servability is a property of the text they emit.

export {
  type ParticipantSearchBinding,
  participantRecencyScore,
  participantSearchBinding,
  participantSearchPredicate,
  participantSearchRank,
} from './participant-search-sql'
export { phoneSearchPatterns } from './phone-query'
