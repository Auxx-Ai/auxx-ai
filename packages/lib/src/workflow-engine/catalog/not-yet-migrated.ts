// packages/lib/src/workflow-engine/catalog/not-yet-migrated.ts

/**
 * Node types whose definitions still live ONLY in
 * `apps/web/src/components/workflow/nodes/core/<type>/schema.ts` and have no
 * catalog manifest yet.
 *
 * This list is the migration tracker and it may ONLY SHRINK: migrating a type
 * means registering its manifest in `registry.ts` and deleting its entry
 * here. The catalog coverage test (apps/web parity suite) asserts that every
 * builder `NodeType` value is in exactly one of {registered manifests, this
 * list} — so adding a node type, migrating one, or retiring one is always an
 * explicit edit here, never silent.
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
  // Legacy per-resource triggers (kept for backwards compatibility)
  'contact-created-trigger',
  'contact-updated-trigger',
  'contact-deleted-trigger',
  'ticket-created-trigger',
  'ticket-updated-trigger',
  'ticket-deleted-trigger',
  // Input nodes
  'form-input',
  'number-input',
  'file-upload',
  // Condition nodes
  // 'if-else' — migrated (catalog/nodes/if-else.ts)
  // Action nodes
  // 'answer' — migrated (catalog/nodes/answer.ts)
  // 'ai' — migrated (catalog/nodes/ai.ts)
  'find',
  // 'http' — migrated (catalog/nodes/http.ts)
  'crud',
  'document-extractor',
  'chunker',
  'dataset',
  'knowledge-retrieval',
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
