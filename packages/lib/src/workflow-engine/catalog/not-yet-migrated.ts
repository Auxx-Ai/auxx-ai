// packages/lib/src/workflow-engine/catalog/not-yet-migrated.ts

/**
 * Node types whose definitions still live ONLY in
 * `apps/web/src/components/workflow/nodes/core/<type>/schema.ts` and have no
 * catalog manifest yet.
 *
 * This list is the migration tracker and it may ONLY SHRINK, for one of two
 * reasons:
 *  - **Migrated** — register its manifest in `registry.ts`, delete its entry here.
 *  - **Retired** — the type is gone; delete its entry here AND its member from
 *    the builder's `NodeType` enum, in the SAME change. The coverage test
 *    asserts exact set equality between `NodeType` and {manifests ∪ this list}
 *    in both directions, so a half-done retirement fails the build.
 *
 * The catalog coverage test (apps/web parity suite) is what makes adding a node
 * type, migrating one, or retiring one always an explicit edit here, never
 * silent.
 *
 * Values are the persisted `data.type` strings (the builder's `NodeType` enum
 * values), listed in the enum's order.
 */
export const NOT_YET_MIGRATED: readonly string[] = [
  // Triggers
  // 'message-received' — migrated (catalog/nodes/message-received.ts)
  'webhook',
  'webhook-endpoint',
  // 'scheduled' — migrated (catalog/nodes/scheduled.ts)
  // 'manual' — migrated (catalog/nodes/manual.ts)
  // 'resource-trigger' — migrated (catalog/nodes/resource-trigger.ts)
  // The six legacy per-resource triggers ('contact-created-trigger' …
  // 'ticket-deleted-trigger') were RETIRED, not migrated: they never had a
  // schema, definition or processor, only enum members and a publish-time
  // normalization shim for old graphs that do not exist.
  // Input nodes
  // 'form-input' — migrated (catalog/nodes/form-input.ts)
  // 'number-input' / 'file-upload' — RETIRED alongside the legacy triggers.
  // Neither was ever implemented; file-upload behaviour is 'form-input' with
  // `inputType: 'file'`.
  // Condition nodes
  // 'if-else' — migrated (catalog/nodes/if-else.ts)
  // Action nodes
  // 'answer' — migrated (catalog/nodes/answer.ts)
  // 'ai' — migrated (catalog/nodes/ai.ts)
  // 'find' — migrated (catalog/nodes/find.ts)
  // 'http' — migrated (catalog/nodes/http.ts)
  // 'crud' — migrated (catalog/nodes/crud.ts)
  // 'document-extractor' — migrated (catalog/nodes/document-extractor.ts)
  // 'chunker' — migrated (catalog/nodes/chunker.ts)
  // 'dataset' — migrated (catalog/nodes/dataset.ts)
  // 'knowledge-retrieval' — migrated (catalog/nodes/knowledge-retrieval.ts)
  // Transform nodes
  // 'code' — migrated (catalog/nodes/code.ts)
  // 'text-classifier' — migrated (catalog/nodes/text-classifier.ts)
  // 'information-extractor' — migrated (catalog/nodes/information-extractor.ts)
  // 'var-assign' — migrated (catalog/nodes/var-assign.ts)
  // 'date-time' — migrated (catalog/nodes/date-time.ts)
  // 'list' — migrated (catalog/nodes/list.ts)
  // 'format' — migrated (catalog/nodes/format.ts)
  // Data nodes
  // 'note' — migrated (catalog/nodes/note.ts)
  // Control nodes
  // 'end' — migrated (catalog/nodes/end.ts)
  // 'wait' — migrated (catalog/nodes/wait.ts)
  // 'loop' — migrated (catalog/nodes/loop.ts)
  // 'human-confirmation' — migrated (catalog/nodes/human.ts)
] as const
