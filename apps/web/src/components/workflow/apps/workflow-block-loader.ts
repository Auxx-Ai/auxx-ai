// apps/web/src/components/workflow/apps/workflow-block-loader.ts

import type { AppInstallation } from '~/components/apps/providers/apps-context'
import type { AppStore } from '~/components/apps/runtime/app-store'
import type { WorkflowBlock, WorkflowBlockField } from '~/components/workflow/types/block-types'

/**
 * Responsible for loading workflow blocks from installed apps.
 *
 * Strategy: catalog-first, iframe RPC as a dev-only fallback. The deployment's
 * static catalog (projected onto `AppInstallation.workflowBlocks` /
 * `.workflowTriggers` via the org cache envelope) provides display metadata
 * synchronously, with no iframe boot. The iframe RPC `get-workflow-blocks`
 * stays as a fallback so author iteration in dev (where the catalog may be
 * stale relative to the live SDK) still works without re-uploading.
 *
 * See plans/kopilot/agents/triggers/app-surface-implementation-plan.md §10.1.
 */
/**
 * Serialized quick action metadata. Historically returned from the app iframe;
 * now derived from the deployment catalog's `actions` projection. Kept as a
 * stable shape so existing consumers (email-editor's `QuickActionPicker`) work
 * unchanged.
 */
export interface SerializedQuickAction {
  id: string
  label: string
  description?: string
  icon?: string
  color?: string
  inputs: Record<string, any>
  outputs: Record<string, any>
  config?: Record<string, any>
  defaults?: Record<string, unknown>
  /** Enriched by loader */
  appId?: string
  installationId?: string
}

/**
 * Convert one catalog `inputsJsonSchema` field node — the SDK field `toJSON()`
 * shape `{ type, acceptsVariables, variableTypes, items, fields, _metadata }` —
 * into the flat `WorkflowBlockField` shape consumers read (label / options /
 * required at the top level). Mirrors `serializeFieldsFromJSON` in
 * `@auxx/sdk` `runtime/workflow.ts`, which produces the same shape on the
 * iframe RPC path.
 */
function catalogFieldToBlockField(name: string, fieldJson: any): WorkflowBlockField {
  const metadata = fieldJson?._metadata || {}

  const field: WorkflowBlockField = {
    name,
    label: metadata.label || name,
    type: fieldJson?.type || 'any',
    description: metadata.description,
    required: metadata.required ?? false,
    default: metadata.defaultValue,
    format: metadata.format,
    placeholder: metadata.placeholder,
    acceptsVariables: fieldJson?.acceptsVariables,
    variableTypes: fieldJson?.variableTypes,
    min: metadata.min,
    max: metadata.max,
    minLength: metadata.minLength,
    maxLength: metadata.maxLength,
    pattern: metadata.pattern,
    integer: metadata.integer,
    precision: metadata.precision,
    options: metadata.options,
    multi: metadata.multi,
    canAdd: metadata.canAdd,
    canManage: metadata.canManage,
    _fieldKind: 'input',
  }

  if (fieldJson?.type === 'array' && fieldJson.items) {
    field.items = catalogFieldToBlockField('item', fieldJson.items)
  }

  if ((fieldJson?.type === 'object' || fieldJson?.type === 'struct') && fieldJson.fields) {
    field.properties = catalogInputsToSchemaInputs(fieldJson.fields)
  }

  return field
}

/** Convert a catalog `inputsJsonSchema` map into `WorkflowBlock['schema']['inputs']`. */
function catalogInputsToSchemaInputs(
  inputsJsonSchema: Record<string, unknown> | undefined
): Record<string, WorkflowBlockField> {
  const inputs: Record<string, WorkflowBlockField> = {}
  for (const [name, fieldJson] of Object.entries(inputsJsonSchema || {})) {
    inputs[name] = catalogFieldToBlockField(name, fieldJson)
  }
  return inputs
}

/** Convert a `CatalogBlock` projection into the runtime `WorkflowBlock` shape.
 *
 * The catalog projection is a subset of the iframe RPC payload — it carries
 * `inputsJsonSchema` (hydrated into `schema.inputs` here) but no outputs,
 * `polling`, `category`, or `hasPanel` data. `schema.inputs` must be
 * populated: the single-run Input tab (`extractAppBlockVariables`) and field
 * label/type resolution both read it. Outputs stay empty — they're computed
 * per-node by the app's `computeOutputs` and merged from `_computedOutputs`.
 */
function catalogBlockToWorkflowBlock(
  block: NonNullable<AppInstallation['workflowBlocks']>[number],
  appId: string,
  installationId: string,
  appAvatarUrl?: string | null
): WorkflowBlock {
  return {
    id: block.id,
    appId,
    installationId,
    label: block.label,
    description: block.description,
    category: 'integration',
    // iconKey is currently always null in the catalog projection — fall back
    // to the app's avatar (same cascade as installed-apps-provider's agent tools)
    icon: block.iconKey ?? appAvatarUrl ?? undefined,
    color: block.color,
    schema: {
      inputs: catalogInputsToSchemaInputs(block.inputsJsonSchema),
      outputs: {},
    },
  }
}

function catalogTriggerToWorkflowBlock(
  trigger: NonNullable<AppInstallation['workflowTriggers']>[number],
  appId: string,
  installationId: string,
  appAvatarUrl?: string | null
): WorkflowBlock {
  return {
    id: trigger.triggerId,
    appId,
    installationId,
    label: trigger.label,
    description: trigger.description,
    category: 'integration',
    icon: trigger.iconKey ?? appAvatarUrl ?? undefined,
    color: trigger.color,
    schema: {
      inputs: catalogInputsToSchemaInputs(trigger.inputsJsonSchema),
      outputs: {},
    },
  }
}

export class WorkflowBlockLoader {
  private appStore: AppStore
  private loadedBlocks = new Map<string, WorkflowBlock[]>()
  private loadedTriggers = new Map<string, WorkflowBlock[]>()

  constructor(appStore: AppStore) {
    this.appStore = appStore
  }

  /**
   * Load workflow blocks from all installed apps. Catalog-first per
   * installation; iframe RPC fills in apps without catalog data (dev
   * deployments that haven't re-uploaded yet).
   */
  async loadAllBlocks(appInstallations: AppInstallation[]): Promise<void> {
    // Catalog-first: synchronously populate from cache envelope where possible.
    for (const installation of appInstallations) {
      this.loadFromCatalog(installation)
    }

    // Iframe RPC fallback for installations without catalog data.
    const needsRpc = appInstallations.filter(
      (i) => !this.hasCatalogData(i.app.id, i.installationId)
    )

    if (needsRpc.length === 0) return

    const results = await Promise.allSettled(
      needsRpc.map((installation) =>
        this.loadAppWorkflowBlocks(installation.app.id, installation.installationId)
      )
    )

    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        const installation = needsRpc[idx]
        console.warn(
          `[WorkflowBlockLoader] RPC fallback failed for ${installation?.app.id}:`,
          result.reason
        )
      }
    })
  }

  /**
   * Synchronous catalog load for one installation. Reads
   * `installation.workflowBlocks` / `.workflowTriggers` projected from
   * `AppDeployment.catalog` by the org cache envelope.
   */
  loadFromCatalog(installation: AppInstallation): void {
    const { appId, installationId } = {
      appId: installation.app.id,
      installationId: installation.installationId,
    }
    const loadKey = `${appId}:${installationId}`

    const appAvatarUrl = installation.app.avatarUrl

    const blocks = installation.workflowBlocks ?? []
    if (blocks.length > 0) {
      this.loadedBlocks.set(
        loadKey,
        blocks.map((b) => catalogBlockToWorkflowBlock(b, appId, installationId, appAvatarUrl))
      )
    }

    const triggers = installation.workflowTriggers ?? []
    if (triggers.length > 0) {
      this.loadedTriggers.set(
        loadKey,
        triggers.map((t) => catalogTriggerToWorkflowBlock(t, appId, installationId, appAvatarUrl))
      )
    }
  }

  /** Returns true if catalog data already populated either map for this key. */
  private hasCatalogData(appId: string, installationId: string): boolean {
    const key = `${appId}:${installationId}`
    return this.loadedBlocks.has(key) || this.loadedTriggers.has(key)
  }

  /**
   * Iframe RPC fallback — read full-fidelity block metadata from the live
   * app sandbox. Used when the catalog projection is missing (dev
   * deployments that haven't re-uploaded since the SDK schema changed).
   */
  async loadAppWorkflowBlocks(appId: string, installationId: string): Promise<void> {
    const loadKey = `${appId}:${installationId}`
    if (this.loadedBlocks.has(loadKey)) {
      return
    }

    try {
      const messageClient = this.appStore.getMessageClient({
        appId,
        appInstallationId: installationId,
      })

      if (!messageClient) {
        return
      }

      try {
        await messageClient.waitUntilReady()
      } catch (readyError) {
        console.warn(`[WorkflowBlockLoader] MessageClient not ready for ${appId}:`, readyError)
        return
      }

      const result = await messageClient.sendRequest<{
        blocks: Omit<WorkflowBlock, 'appId' | 'installationId'>[]
        triggers?: Omit<WorkflowBlock, 'appId' | 'installationId'>[]
      }>('get-workflow-blocks', {}, { timeout: 10000 })

      if (result.blocks && result.blocks.length > 0) {
        const enrichedBlocks: WorkflowBlock[] = result.blocks.map((block) => ({
          ...block,
          appId,
          installationId,
        }))

        this.loadedBlocks.set(loadKey, enrichedBlocks)
      }

      if (result.triggers && result.triggers.length > 0) {
        const enrichedTriggers: WorkflowBlock[] = result.triggers.map((trigger) => ({
          ...trigger,
          appId,
          installationId,
        }))

        this.loadedTriggers.set(loadKey, enrichedTriggers)
      }
    } catch (error) {
      console.warn(`[WorkflowBlockLoader] get-workflow-blocks failed for ${appId}:`, error)
    }
  }

  /**
   * Get all loaded workflow blocks
   */
  getAllBlocks(): WorkflowBlock[] {
    const allBlocks: WorkflowBlock[] = []

    for (const blocks of this.loadedBlocks.values()) {
      allBlocks.push(...blocks)
    }

    return allBlocks
  }

  /**
   * Get workflow blocks for a specific app installation
   */
  getBlocksForApp(appId: string, installationId: string): WorkflowBlock[] {
    return this.loadedBlocks.get(`${appId}:${installationId}`) || []
  }

  /**
   * Get workflow blocks by category
   */
  getBlocksByCategory(category: string): WorkflowBlock[] {
    return this.getAllBlocks().filter((block) => block.category === category)
  }

  /**
   * Get workflow triggers for a specific app installation
   */
  getTriggersForApp(appId: string, installationId: string): WorkflowBlock[] {
    return this.loadedTriggers.get(`${appId}:${installationId}`) || []
  }

  /**
   * Unload workflow blocks and triggers for an app installation
   */
  unloadAppBlocks(appId: string, installationId: string): void {
    const key = `${appId}:${installationId}`
    this.loadedBlocks.delete(key)
    this.loadedTriggers.delete(key)
  }
}
