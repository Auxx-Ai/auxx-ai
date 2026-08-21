// packages/lib/src/resources/lookup/index.ts

export type {
  LookupByFieldResult,
  LookupCandidate,
  LookupEntitiesByFieldValueParams,
  LookupMatch,
} from './lookup-entities-by-field-value'
export {
  AmbiguousLookupError,
  buildLookupCondition,
  lookupEntitiesByFieldValue,
  parseExternalIdentity,
} from './lookup-entities-by-field-value'
