// packages/lib/src/workflow-engine/catalog/not-yet-migrated.ts

/**
 * Node types whose definitions still live ONLY in
 * `apps/web/src/components/workflow/nodes/core/<type>/schema.ts` and have no
 * catalog manifest yet.
 *
 * **The list is EMPTY: every builder `NodeType` now has a manifest.** The
 * mechanism stays, because it is what makes the *next* change explicit rather
 * than silent — see below.
 *
 * This list is the migration tracker and it may ONLY SHRINK, for one of two
 * reasons:
 *  - **Migrated** — register its manifest in `registry.ts`, delete its entry here.
 *  - **Retired** — the type is gone; delete its entry here AND its member from
 *    the builder's `NodeType` enum, in the SAME change. The coverage test
 *    asserts exact set equality between `NodeType` and {manifests ∪ this list}
 *    in both directions, so a half-done retirement fails the build.
 *
 * A NEW node type may not be parked here — the list only shrinks. Land it with
 * its manifest, which is the whole point of the catalog: adding a node type,
 * migrating one, or retiring one is always an explicit edit the coverage test
 * (apps/web parity suite) forces.
 *
 * Two retirements happened during the burn-down and are recorded here because
 * nothing else explains why those enum members are absent:
 *  - The six legacy per-resource triggers ('contact-created-trigger' …
 *    'ticket-deleted-trigger') were RETIRED, not migrated: they never had a
 *    schema, definition or processor, only enum members and a publish-time
 *    normalization shim for old graphs that do not exist.
 *  - 'number-input' / 'file-upload' were RETIRED alongside them. Neither was
 *    ever implemented; file-upload behaviour is 'form-input' with
 *    `inputType: 'file'`.
 *
 * Values are the persisted `data.type` strings (the builder's `NodeType` enum
 * values).
 */
export const NOT_YET_MIGRATED: readonly string[] = [] as const
