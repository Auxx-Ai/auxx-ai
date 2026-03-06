// packages/lib/src/workflow-engine/nodes/trigger-nodes/extract-user-inputs.ts

const METADATA_FIELDS = new Set([
  'id',
  'type',
  'appId',
  'appSlug',
  'blockId',
  'triggerId',
  'installationId',
  'connectionId',
  'config',
  'title',
  'name',
  'desc',
  'description',
  'color',
  'icon',
  'isEnabled',
  'disabled',
  'isValid',
  'isInLoop',
  'errors',
  'fieldModes',
  'triggerFilters',
  'metadata',
])

/**
 * Extract user-configured input fields from trigger node data,
 * stripping platform metadata so only app-specific inputs remain.
 */
export function extractUserInputs(data: Record<string, unknown>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (METADATA_FIELDS.has(key) || key.startsWith('_')) continue
    inputs[key] = value
  }
  return inputs
}
