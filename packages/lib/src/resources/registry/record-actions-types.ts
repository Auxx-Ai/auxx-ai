// packages/lib/src/resources/registry/record-actions-types.ts

/**
 * The record-action flags, shared by the detail view, the record drawer and the
 * records-table row menu — every surface that renders `RecordActionsMenu`.
 *
 * This replaces two near-duplicate interfaces (`DetailViewActions`,
 * `DrawerActions`) that overlapped on only four names and disagreed about the
 * rest, which is how the same contact ended up deletable from the table row and
 * not from its own detail page.
 *
 * ⚠ **A flag here means "this record type offers the action at all", never "this
 * member may perform it."** Authorization is the per-ROW `_access` stamp,
 * resolved once in `useRecordAccess` and applied by the menu. A flag that tries
 * to encode permission just adds a second, quieter authority that drifts from
 * the server's.
 *
 * Deliberately ABSENT, and why:
 * - **Delete / Share / Open full page / App actions** — universal.
 *   `useEntityInstanceOperations` routes every type through the generic
 *   `record.delete`, with per-type safety in the server's `deleteEntity`
 *   pre-delete hooks, so a flag could only withhold an action the member is
 *   entitled to. The old `enableDelete` is exactly why a contact was deletable
 *   from the table row and not from its own detail page.
 * - **Run workflow** — `ManualTriggerSubmenu` already disables itself when the
 *   definition has no manual workflows, which is the same question a flag would
 *   be answering, only from stale hand-maintained data.
 * - **Groups** — the button set state nothing read, and no group-assignment
 *   dialog exists anywhere in the app.
 * - **Spam** — no mutation exists to write it. SPAM is a mail/thread status;
 *   `Contact.status` carries the value but nothing in the product sets it.
 */
export interface RecordActions {
  /**
   * Offer Archive. NOT universal, unlike Delete: `invoice` withholds it because
   * invoices are ledger records for which delete is the only removal path.
   */
  enableArchive?: boolean
  /**
   * Merge this record into another.
   *
   * ⚠ Gated on the DELETE verb, not edit: a merge permanently removes the source
   * rows and the server asserts `assertCanDeleteRows` over the target and every
   * source (`routers/record.ts`).
   */
  enableMerge?: boolean
  /** Open the surface's record-editor dialog. */
  enableEdit?: boolean
  /** Focus the surface's inline title input. Drawer-only — nothing else has one. */
  enableRename?: boolean
  /** Link this record to another. */
  enableLink?: boolean
  /** Assign the record to a member. */
  enableAssign?: boolean
  /** Sequences plan §17 — "Add to sequence" opens `AddToSequenceDialog`. */
  enableAddToSequence?: boolean
}
