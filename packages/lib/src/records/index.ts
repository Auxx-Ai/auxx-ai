// packages/lib/src/records/index.ts

// Contact name casing repair (plans/records/contact-name-casing-plan.md). The pre-hook
// itself is registered in `field-hooks/register-hooks.ts` and imported directly from
// `./name-case/hook` — it is not re-exported here, so nothing can call it by hand.
export type {
  NameCaseBackfillOptions,
  NameCaseBackfillSummary,
  NameCaseChange,
} from './name-case/backfill'
export { backfillContactNameCasing } from './name-case/backfill'
export type { SequenceScope } from './record-numbering'
export { recordNumbering, SEQUENCE_SCOPES } from './record-numbering'
