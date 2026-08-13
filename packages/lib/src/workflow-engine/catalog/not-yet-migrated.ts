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
  'message-received',
  'webhook',
  'webhook-endpoint',
  'scheduled',
  'manual',
  'resource-trigger',
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
  'if-else',
  // Action nodes
  'answer',
  'ai',
  'find',
  'http',
  'crud',
  'document-extractor',
  'chunker',
  'dataset',
  'knowledge-retrieval',
  // Transform nodes
  'code',
  'text-classifier',
  'information-extractor',
  // 'var-assign' — migrated (catalog/nodes/var-assign.ts)
  'date-time',
  'list',
  'format',
  // Data nodes
  // 'note' — migrated (catalog/nodes/note.ts)
  // Control nodes
  // 'end' — migrated (catalog/nodes/end.ts)
  // 'wait' — migrated (catalog/nodes/wait.ts)
  'loop',
  'human-confirmation',
] as const
