// packages/lib/src/signals/client.ts
// Client-safe exports — types + pure constants only. No server dependencies.

export {
  HIGH_VOLUME_SIGNAL_KINDS,
  isSignalKind,
  MESSAGE_SENT_SUBTYPES,
  type MessageSentSubtype,
  SIGNAL_KIND_LIST,
  SIGNAL_KINDS,
  type SignalKind,
  type SignalKindMeta,
} from './types'

/**
 * Reserved-id prefix for the `EntitySignalRollup` pseudo-fields the record-rules signal
 * door (`on: 'signal'`) merges into its condition snapshot (plans/signals/06-follow-ups-build.md
 * decision 6) — e.g. `'signal:openCount30d'`. Never a real field id.
 */
export const SIGNAL_PSEUDO_FIELD_PREFIX = 'signal:'

/** Field type a pseudo-field behaves as for the condition builder (number/date/text operators). */
export type SignalPseudoFieldType = 'NUMBER' | 'DATETIME' | 'TEXT'

export interface SignalRollupPseudoField {
  /** Reserved condition `fieldId` — always `signal:<key>`. */
  id: string
  label: string
  fieldType: SignalPseudoFieldType
}

/**
 * The `EntitySignalRollup` columns exposed as condition-builder pseudo-fields, offered only
 * when a rule's trigger is `on: 'signal'` (decision 6). A missing rollup row merges as
 * `undefined` for every one of these — "is empty" matches, by design.
 */
export const SIGNAL_ROLLUP_PSEUDO_FIELDS: SignalRollupPseudoField[] = [
  { id: 'signal:lastOpenedAt', label: 'Last opened', fieldType: 'DATETIME' },
  { id: 'signal:openCount30d', label: 'Opens (30d)', fieldType: 'NUMBER' },
  { id: 'signal:lastClickedAt', label: 'Last clicked', fieldType: 'DATETIME' },
  { id: 'signal:clickCount30d', label: 'Clicks (30d)', fieldType: 'NUMBER' },
  { id: 'signal:lastVisitAt', label: 'Last visit', fieldType: 'DATETIME' },
  { id: 'signal:visitCount30d', label: 'Visits (30d)', fieldType: 'NUMBER' },
  { id: 'signal:lastRepliedAt', label: 'Last replied', fieldType: 'DATETIME' },
  { id: 'signal:lastSignalAt', label: 'Last signal', fieldType: 'DATETIME' },
  { id: 'signal:unsubscribedAt', label: 'Unsubscribed at', fieldType: 'DATETIME' },
  { id: 'signal:bouncedAt', label: 'Bounced at', fieldType: 'DATETIME' },
  { id: 'signal:bounceType', label: 'Bounce type', fieldType: 'TEXT' },
]

/** Is `fieldId` one of the reserved `signal:*` rollup pseudo-fields? */
export function isSignalPseudoFieldId(fieldId: string): boolean {
  return fieldId.startsWith(SIGNAL_PSEUDO_FIELD_PREFIX)
}

/** Strip the `signal:` prefix to the `EntitySignalRollup` column key the snapshot merges under
 * (`makeSnapshotResolver`'s ref stays the full `signal:<key>` id, but `conditions/evaluate.ts`
 * treats any colon-prefixed fieldId as `entityDef:field` and strips it before resolving — the
 * merged snapshot must carry the bare key). */
export function signalPseudoFieldKey(fieldId: string): string {
  return fieldId.slice(SIGNAL_PSEUDO_FIELD_PREFIX.length)
}
