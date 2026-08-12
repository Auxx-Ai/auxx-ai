// packages/lib/src/workflow-engine/nodes/utils/app-input-fields.ts

/**
 * The single definition of "which `node.data` keys belong to the app".
 *
 * Deliberately dependency-free: this module has no imports. Both the app-block processor and
 * the app-trigger input extractor need it, and the extractor is a leaf consumed from outside
 * the engine (`workflows/polling-trigger-service.ts`). Routing it through
 * `nodes/app-workflow-block-processor.ts` would drag `BaseNodeProcessor`, the `core/errors`
 * hierarchy and `core/types` into that graph purely to obtain a `Set`, and would park a leaf
 * one edge from the `node-processor-registry` cluster — the neighbourhood where a static
 * import already yields `BaseAiNodeProcessor undefined`.
 */

/**
 * Node-data keys owned by the workflow builder / persistence layer rather than by the app.
 *
 * The builder stores an app node's user inputs flat on `node.data`, alongside its own
 * bookkeeping. Nothing here is ever an app input, so nothing here may reach the app runtime:
 *
 * - identity & block binding — stamped by `node-factory.ts` and `workflow-block-registry.tsx`
 *   (`id`, `type`, `appId`, `appSlug`, `blockId`, `triggerId`, `installationId`, `connectionId`)
 * - presentation — `title`/`desc` and their `BaseNodeData` aliases
 * - builder bookkeeping — validation, canvas, loop-context and panel state
 *
 * UI-only keys are `_`-prefixed and stripped separately (see {@link isAppInputField}).
 *
 * **This one set covers both app blocks and app triggers.** They are produced by the same
 * `node-factory.ts` and the same `workflow-block-registry.tsx`, so their `node.data` shape is
 * identical; the two paths merely populate different subsets of it (`blockId` for blocks;
 * `triggerId`, `config.polling` and `triggerFilters` for triggers). Every one of those is
 * platform-owned on both paths, so neither path needs a key the other must exclude.
 *
 * Note the deliberate trade-off on generic names (`config`, `name`, `width`, `height`, …):
 * the builder already writes these itself, so an app input sharing the name is clobbered on
 * the builder side regardless. Denylisting them drops a value the app would not have received
 * intact anyway. When a block ships a real `schema.inputs`, the allowlist wins and the app gets
 * the field back.
 */
export const PLATFORM_NODE_DATA_KEYS: ReadonlySet<string> = new Set([
  // Identity and block binding
  'id',
  'type',
  'appId',
  'appSlug',
  'blockId',
  'triggerId',
  'installationId',
  'connectionId',
  // Presentation
  'title',
  'name',
  'desc',
  'description',
  'icon',
  'color',
  // Builder bookkeeping
  'config',
  'fieldModes',
  'triggerFilters',
  'metadata',
  'isValid',
  'errors',
  'disabled',
  'isEnabled',
  'selected',
  'collapsed',
  'width',
  'height',
  'isInLoop',
  'loopId',
  'isInIteration',
  'iterationId',
  'inputNodes',
  'inferredSchema',
  'outputVariables',
  'credentialId',
  'errorStrategy',
  'retryConfig',
])

/**
 * The single definition of "is this `node.data` key an app input field?".
 *
 * Every site that walks an app node's `node.data` must use this, so that the set of fields
 * forwarded to the app runtime and the set scanned for required variables can never disagree.
 *
 * Resolution order:
 * 1. `_`-prefixed keys are ephemeral builder UI state — never an input.
 * 2. When the node ships a non-empty `schema.inputs`, that schema is authoritative
 *    (allowlist): a declared field is an input, anything else is not.
 * 3. Otherwise — the permissive-defaults path in `fetchBlockMetadata`, which is what runs in
 *    practice today because the backend has no access to app runtime schemas — fall back to
 *    the {@link PLATFORM_NODE_DATA_KEYS} denylist so all app-authored fields still flow.
 *
 * @param fieldName - key from `node.data`
 * @param schemaInputs - the node's declared `schema.inputs`, if any
 */
export function isAppInputField(
  fieldName: string,
  schemaInputs?: Record<string, unknown>
): boolean {
  if (fieldName.startsWith('_')) return false

  if (schemaInputs && Object.keys(schemaInputs).length > 0) {
    return Object.hasOwn(schemaInputs, fieldName)
  }

  return !PLATFORM_NODE_DATA_KEYS.has(fieldName)
}
