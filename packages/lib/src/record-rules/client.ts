// packages/lib/src/record-rules/client.ts
// Client-safe exports — types + pure constants only. No server dependencies.

export {
  type CachedRecordRule,
  FIELD_TRANSITIONS,
  LIFECYCLE_TRANSITIONS,
  type RecordRuleAction,
  type RecordRuleActionOutcome,
  type RecordRuleOn,
} from './types'
