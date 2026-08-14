// packages/lib/src/workflow-engine/parity/known-broken.ts

/**
 * Known-broken entries for the find/crud resolvability suite
 * (`find.resolvability.test.ts` / `crud.resolvability.test.ts`).
 *
 * Mirrors `apps/web/src/components/workflow/parity/contract-drift-allowlist.ts`:
 * a burn-down list, not a permanent allowance. Each entry is a documented,
 * REAL bug this suite proves exists — pin it here so the suite is green today
 * and any NEW drift (a regression, or a fix that silently breaks something
 * else) is a hard failure. Every entry is verified empirically by running the
 * suite, not predicted from reading source alone — vitest's own failure
 * output is the source of truth for exactly which declared ids resolve.
 *
 * Three families, one per invariant in `harness.ts`:
 *
 * - `matchDeclaredUnresolvablePin` — invariant 1 (declared ⊆ resolvable).
 *   The id resolves to `undefined` (or, for an array-typed id, every element
 *   resolves to `undefined`) even though it's declared.
 * - `matchWrittenUndeclaredPin` — invariant 2 (written ⊆ declared). The
 *   processor wrote this key but no declared id covers it.
 * - `matchMissingLabelPin` — invariant 3 (label coverage). The declared id
 *   has no `label`, so the picker would render the raw id segment.
 *
 * HOW TO BURN DOWN: fix the bug, delete the entry. The suite fails on a STALE
 * entry too (the pinned assertion flips: `matchDeclaredUnresolvablePin`
 * asserts the id STAYS undefined, `matchWrittenUndeclaredPin` asserts the key
 * STAYS uncovered, `matchMissingLabelPin` asserts the label STAYS absent), so
 * a fixed bug forces its own pin's removal instead of quietly rotting.
 */

import { RESOURCE_FIELD_REGISTRY } from '../../resources/registry/field-registry'
import { getFieldOutputKey } from '../../resources/registry/field-types'
import { BaseType } from '../../resources/types'

/** One pin: a predicate over the id/key, plus why it's pinned and where the fix lives. */
interface Pin {
  test: (id: string) => boolean
  reason: string
}

function findPin(pins: Pin[], id: string): string | undefined {
  const pin = pins.find((p) => p.test(id))
  return pin?.reason
}

// =============================================================================
// Invariant 1 — declared ⊆ resolvable
// =============================================================================

/**
 * Tier-A (`thread`) findOne/findMany declared field paths that are STILL
 * broken after §10b step 4 (`toOutputShape`, `resources/registry/output-shape.ts`)
 * — everything else in this family was retired by that fix.
 *
 * §3.2 (`plans/kopilot/workflow/10-variable-resolution-deep-dive.md`): the
 * palette advertises tier-A fields by `systemAttribute` (`thread_status`,
 * `assignee_id`, `message_count`, `last_message_at`, …), but find.ts used to
 * store the RAW Drizzle row (camelCase columns: `status`, `assigneeId`,
 * `messageCount`, `lastMessageAt`, …) with no key mapping at all —
 * `resolveNestedObject` looked for `row['thread_status']`, which never
 * existed. `toOutputShape` now merges `getFieldOutputKey(field) →
 * row[field.dbColumn]` aliases into the row at write time for every field
 * that HAS a `dbColumn`, which retires every scalar in this family whose
 * declared key differs from its column (`external_id`, `thread_status`,
 * `message_count`, `first_message_at`, `last_message_at`, `closed_at`,
 * `created_at`, `assignee_id`; `id`/`subject` already matched coincidentally
 * and were never broken).
 *
 * Two field shapes remain genuinely unresolvable, both because
 * `toOutputShape` only aliases a field that HAS a `dbColumn` — a field
 * without one was never a candidate for this fix:
 *
 * - **RELATION fields** (`inbox`, `ticket`, `messages`, `tags`): tier A never
 *   stores a `ResourceReference`, so there is no lazy-load lane to expand
 *   them through at all (§3.4) — the raw row simply has no property by that
 *   name, and aliasing a nonexistent scalar column wouldn't help even if one
 *   existed. Fix pointer: §10b proposal #1 (ResourceReference unification for
 *   tier A).
 * - **Scalar fields with NO `dbColumn`** (`readStatus`, the `visit*`
 *   chat-capture fields, and the mail-builder's virtual query-only fields
 *   `from`/`to`/`body`/`freeText`/`hasAttachments`/`hasDraft`/`sent`): these
 *   are FieldValue-backed or cross-table-join-resolved, never present on the
 *   raw `schema.Thread` row `find.ts` selects — there is no column for
 *   `toOutputShape` to alias FROM. Same fix pointer as RELATION (proposal #1
 *   would read these through the FieldValue/join lane instead of the raw row).
 *
 * Derived directly from the real `RESOURCE_FIELD_REGISTRY.thread` registry
 * (not hand-copied), so a future field addition can't silently drift this set.
 *
 * findMany items go through the SAME per-element `resolveNestedObject` inside
 * the array-map branch of `resolveVariablePath` — the array itself is always
 * "resolved" (a defined array), which is why the harness additionally treats
 * an array whose every element is `undefined` as unresolved (see
 * `harness.ts`'s `assertDeclaredResolvable`) — otherwise this whole family
 * would silently pass for findMany while genuinely broken.
 */
const THREAD_STILL_BROKEN_OUTPUT_KEYS = new Set(
  Object.values(RESOURCE_FIELD_REGISTRY.thread ?? {})
    .filter((field) => field.type === BaseType.RELATION || !field.dbColumn)
    .map((field) => getFieldOutputKey(field))
)

// findOne's root is `<n>.thread`, findMany's is `<n>.thread[*]` — both key on
// the canonical `resource.id` ('thread') as of §10/§10b step 5; there is no
// more `threads[*]` shape in the DECLARED tree (the legacy plural write is
// still resolvable at runtime, it's just not declared — see
// `FIND_MANY_LEGACY_PLURAL_ALIAS_REASON` below).
const TIER_A_FIELD_PATH_RE = /^[^.]+\.thread(\[\*\])?\.(.+)$/

function tierAFieldPathPin(id: string): string | undefined {
  const match = id.match(TIER_A_FIELD_PATH_RE)
  if (!match) return undefined
  const rest = match[2]!
  const firstSegment = rest.split('.')[0]!.replace(/\[\*\]$/, '')
  if (!THREAD_STILL_BROKEN_OUTPUT_KEYS.has(firstSegment)) return undefined
  return (
    '§3.2/§3.4, fixed by §10b step 4 (toOutputShape) for every scalar WITH a dbColumn — ' +
    'this key is one of the two shapes toOutputShape cannot fix: a RELATION field (tier A ' +
    'never stores a ResourceReference, so there is no lazy-load lane at all) or a scalar with ' +
    'no dbColumn at all (FieldValue-backed or cross-table-join-resolved, never on the raw row). ' +
    'Fix pointer: §10b proposal #1 (ResourceReference unification for tier A).'
  )
}

/**
 * NEW BUG (undocumented before this suite): `errorDetails` is declared
 * unconditionally for every crud mode (`generateCrudNodeVariablesFromFields`
 * always pushes it), but `executeNode`'s SUCCESS path never writes it — only
 * `handleCrudError` (the catch branch) does. A crud run that succeeds
 * outright therefore has a declared `errorDetails` id with nothing ever
 * written under it; `resolveVariablePath` correctly reports `undefined`.
 *
 * This is the shape `contract-drift-allowlist.ts`'s `KNOWN_BROKEN_FAILURE_PATH_WRITES`
 * category exists for ("every setNodeVariable call site sits inside an else
 * block") — that map is empty there because its suite checks declared-vs-written
 * statically per one fixed config, not by actually running both the success
 * and failure arms and resolving the result the way this suite does.
 *
 * Scoped to this suite's own SUCCESS-scenario node ids: the `error_strategy:
 * 'default'` scenario's forced-failure run DOES write `errorDetails` (every
 * `handleCrudError` branch sets it unconditionally), so the same id resolves
 * there — the id string alone can't distinguish "this run succeeded" from
 * "this run failed and recovered," only which scenario produced it can.
 */
function crudSuccessErrorDetailsPin(id: string): string | undefined {
  if (!id.endsWith('.errorDetails')) return undefined
  // `crud_vendor_update.` (with trailing dot) deliberately does not match the
  // `crud_vendor_update_default` scenario's node id (no dot follows
  // `crud_vendor_update` there) — see the doc comment above.
  const matchesSuccessNode =
    id.startsWith('crud_vendor_create.') ||
    id.startsWith('crud_vendor_update.') ||
    id.startsWith('crud_vendor_delete.') ||
    id.startsWith('crud_thread_update.')
  if (!matchesSuccessNode) return undefined
  return (
    "NEW BUG: errorDetails is declared unconditionally but executeNode's success path never " +
    'writes it — only handleCrudError (the catch branch) does. See doc comment above ' +
    'crudSuccessErrorDetailsPin in known-broken.ts.'
  )
}

const DECLARED_UNRESOLVABLE_PINS: Array<(id: string) => string | undefined> = [
  tierAFieldPathPin,
  crudSuccessErrorDetailsPin,
]

// A former §3.4 hop-two entry lived here (`hopTwoRelationPin`) — defined but
// deliberately never registered above, since `buildFieldPath`'s independent
// bug (reading a `RelationshipConfig` property that doesn't exist) made the
// findOne/root lane resolve to the FIRST hop's own value instead of
// `undefined`, so there was nothing to pin as "stays broken". Fixed by the
// segment-walk resolver (`plans/kopilot/workflow/11-segment-walk-resolver.md`
// §7 item 1) — `find.resolvability.test.ts`'s hop-2 scenario now asserts the
// SECOND hop's actual value directly instead.

/** Invariant 1: is `id` a documented, pinned resolution failure? Returns the reason, or `undefined`. */
export function matchDeclaredUnresolvablePin(id: string): string | undefined {
  for (const pin of DECLARED_UNRESOLVABLE_PINS) {
    const reason = pin(id)
    if (reason) return reason
  }
  return undefined
}

// =============================================================================
// Invariant 2 — written ⊆ declared
// =============================================================================

// A former `FIND_MANY_STRAY_SINGULAR_KEY` entry lived here (findMany's
// custom-entity loop called `setEntityVariables()` per item, which
// unconditionally wrote the singular `<node>.<entityDefId>` key + five
// subkeys as a side effect of building each `ResourceReference` —
// last-item-wins, zero picker coverage). RETIRED by the findMany id-keying
// change (§10/§10b step 5, `10-variable-resolution-deep-dive.md`): the array
// itself now lives at `<node>.<entityDefId>`, so that stray per-item write
// would have clobbered it — the fix removes the `setEntityVariables` call
// from the loop entirely (see `find.ts`'s findMany/custom-entity branch),
// not just the pin.

/**
 * DELIBERATE, not a bug: findMany dual-writes its result array under BOTH the
 * canonical `<node>.<resource.id>` key (declared, covered) and the legacy
 * `<node>.<resource.plural.toLowerCase()>` key — same array reference — so
 * `{{node.<plural>…}}` refs stored before the plural-rename fix
 * (§10/§10b step 5) keep resolving until the DataMigration rewrites stored
 * graphs onto the canonical key. `generateFindNodeVariablesFromFields` only
 * ever declares the id-keyed path, so the plural key is written-but-
 * undeclared by design. Retire this pin together with the legacy write in
 * `find.ts` once the migration has run everywhere.
 */
const FIND_MANY_LEGACY_PLURAL_ALIAS_REASON =
  'DELIBERATE back-compat alias (§10/§10b step 5): find.ts dual-writes the findMany array under ' +
  'both the canonical `<node>.<resource.id>` key (declared) and this legacy ' +
  '`<node>.<resource.plural.toLowerCase()>` key so pre-migration `{{…}}` refs keep resolving. ' +
  'Retire together with the dual-write once the plural→id DataMigration has run everywhere.'

/**
 * Correct by design, not a bug — same class as `contract-drift-allowlist.ts`'s
 * `EXTRACTION_BLIND_SPOTS` entries for `var-assign.myVar`/`myList`: the CRUD
 * `default` error-strategy writes one key per `default_values[].key`, which
 * is a user-configured, dynamic name (`processDefaultValues` /
 * `handleCrudError`'s `Object.entries(defaultResult).forEach(...)` loop). No
 * static manifest can declare a literal path for a name that only exists at
 * run time — `usedDefaults`/`defaultValues` (the two ALWAYS-present wrapper
 * keys) ARE declared and asserted directly in the scenario, which is the
 * actual regression-relevant surface this suite's self-check cares about.
 */
const CRUD_DEFAULT_VALUE_DYNAMIC_KEY_REASON =
  'Correct by design: default_values[].key is a user-configured, dynamic name ' +
  "(processDefaultValues/handleCrudError's Object.entries loop) — no static manifest can " +
  'declare a literal path for it. Same class as var-assign.myVar/myList in ' +
  'contract-drift-allowlist.ts EXTRACTION_BLIND_SPOTS.'

const WRITTEN_UNDECLARED_PINS: Pin[] = [
  {
    test: (key) => key === 'find_vendor_many.vendors',
    reason: FIND_MANY_LEGACY_PLURAL_ALIAS_REASON,
  },
  {
    test: (key) => key === 'find_thread_many.threads',
    reason: FIND_MANY_LEGACY_PLURAL_ALIAS_REASON,
  },
  {
    test: (key) => key === 'crud_vendor_update_default.fallbackNote',
    reason: CRUD_DEFAULT_VALUE_DYNAMIC_KEY_REASON,
  },
]

/** Invariant 2: is `key` a documented, pinned coverage gap? Returns the reason, or `undefined`. */
export function matchWrittenUndeclaredPin(key: string): string | undefined {
  return findPin(WRITTEN_UNDECLARED_PINS, key)
}

// =============================================================================
// Invariant 3 — label coverage
// =============================================================================

const MISSING_LABEL_PINS: Pin[] = []

/** Invariant 3: is `id` a documented, pinned missing-label gap? Returns the reason, or `undefined`. */
export function matchMissingLabelPin(id: string): string | undefined {
  return findPin(MISSING_LABEL_PINS, id)
}
