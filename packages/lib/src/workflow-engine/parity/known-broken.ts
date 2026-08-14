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
 * Tier-A (`thread`) findOne/findMany declared field paths, EXCEPT the two
 * coincidental matches (`id`, `subject`, whose `systemAttribute` string
 * happens to equal the raw Drizzle column name).
 *
 * §3.2 (`plans/kopilot/workflow/10-variable-resolution-deep-dive.md`): the
 * palette advertises tier-A fields by `systemAttribute` (`thread_status`,
 * `assignee_id`, `message_count`, `last_message_at`, …), but find.ts stores
 * the RAW Drizzle row (camelCase columns: `status`, `assigneeId`,
 * `messageCount`, `lastMessageAt`, …) and tier-A resolution has no key
 * mapping — `resolveNestedObject` looks for `row['thread_status']`, which
 * doesn't exist. Confirmed by the real `RESOURCE_FIELD_REGISTRY.thread`
 * entries (`thread-fields.ts`): `status.systemAttribute === 'thread_status'`
 * but `status.dbColumn === 'status'`; same divergence for `assignee`,
 * `messageCount`, `lastMessageAt`, `firstMessageAt`, `closedAt`, `externalId`.
 *
 * Tier-A RELATION fields (`inbox`, `ticket`, `messages`, `tags`) are broken
 * for the compounding, structural reason in §3.4: tier A never stores a
 * `ResourceReference`, so there is no lazy-load lane to expand them through
 * at all — the raw row simply has no property by that name.
 *
 * Fix pointer: §10b step 4 — `toOutputShape(row, fields)` re-keys the row by
 * `getFieldOutputKey` at write time (the cheap, do-now fix); the full fix
 * (§10b proposal #1) unifies tier A onto the same `ResourceReference` lane
 * tier B/C already uses, which would additionally fix the relation fields.
 *
 * findMany items go through the SAME per-element `resolveNestedObject` inside
 * the array-map branch of `resolveVariablePath` — the array itself is always
 * "resolved" (a defined array), which is why the harness additionally treats
 * an array whose every element is `undefined` as unresolved (see
 * `harness.ts`'s `assertDeclaredResolvable`) — otherwise this whole family
 * would silently pass for findMany while genuinely broken.
 */
const TIER_A_FIELD_PATH_RE = /^[^.]+\.(thread|threads\[\*\])\.(.+)$/

function tierAFieldPathPin(id: string): string | undefined {
  const match = id.match(TIER_A_FIELD_PATH_RE)
  if (!match) return undefined
  const rest = match[2]!
  const firstSegment = rest.split('.')[0]!.replace(/\[\*\]$/, '')
  if (firstSegment === 'id' || firstSegment === 'subject') return undefined
  return (
    '§3.2/§3.4: tier-A (thread) stores the raw Drizzle row, not a ResourceReference — ' +
    'nested field access has no systemAttribute→dbColumn mapping (scalars) and no lazy-load ' +
    'lane at all (relations). Fix: §10b step 4 (toOutputShape) for scalars, proposal #1 ' +
    '(ResourceReference unification) for relations.'
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

/**
 * NEW BUG (undocumented before this suite): findMany on a custom entity
 * writes the SINGULAR resource-type key too, not just the plural array.
 *
 * `find.ts`'s findMany/custom-entity branch calls `setEntityVariables(resourceType,
 * entityData, contextManager, node.nodeId)` inside the per-item loop that
 * builds `ResourceReference`s for the plural array — but `setEntityVariables`
 * unconditionally writes `${nodeId}.${resourceType}` (the SAME key findOne
 * uses as its root) as a side effect of building each item's reference. Every
 * iteration overwrites it, so the final value is whichever item ran last.
 * `generateFindNodeVariablesFromFields`'s findMany branch never declares this
 * key — only findOne does — so it's a real, always-present write with zero
 * picker coverage on every custom-entity findMany.
 *
 * Fix (not made here): findMany's loop should call whatever piece of
 * `setEntityVariables` builds the `ResourceReference` and caches base data,
 * without the side-effecting `${nodeId}.${resourceType}` write meant for the
 * findOne singular case.
 *
 * Scoped to this suite's own node ids (`find_vendor_many`) rather than a bare
 * entity-def-id pattern, because the SAME key IS correctly declared and
 * covered for the findOne scenario — the id string alone can't tell the two
 * apart, only which scenario produced it can.
 */
const FIND_MANY_STRAY_SINGULAR_KEY_REASON =
  "NEW BUG: find.ts's findMany/custom-entity branch calls setEntityVariables() per item, which " +
  'unconditionally writes the singular `<node>.<entityDefId>` key (and its `.record_id`/`.created_at`/' +
  '`.updated_at`/`.entityDefinitionId`/`.id` children) as a side effect of building each ' +
  "ResourceReference — but generateFindNodeVariablesFromFields's findMany branch never declares " +
  'that key, only findOne does. Last-item-wins, always present, zero picker coverage.'

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
    test: (key) =>
      key.startsWith('find_vendor_many.vendorentitydefcuid00001') ||
      key.startsWith('find_vendor_many.regionentitydefcuid00001'),
    reason: FIND_MANY_STRAY_SINGULAR_KEY_REASON,
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
