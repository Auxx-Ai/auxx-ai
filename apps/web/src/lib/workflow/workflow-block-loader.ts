// apps/web/src/lib/workflow/workflow-block-loader.ts

import type { AppInstallation } from '~/providers/extensions/extensions-context'
import type { AppStore } from '../extensions/app-store'
import type { WorkflowBlock } from './types'

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

/** Convert a `CatalogBlock` projection into the runtime `WorkflowBlock` shape.
 *
 * The catalog projection is a strict subset of the iframe RPC payload —
 * `inputsJsonSchema` rather than the rich `schema.inputs/outputs`, and no
 * `polling`/`category`/`hasPanel` data. Producing a degraded `WorkflowBlock`
 * here lets the picker render label / icon / color synchronously; the iframe
 * fallback (if it ever fires) registers an upgraded definition.
 */
function catalogBlockToWorkflowBlock(
  block: NonNullable<AppInstallation['workflowBlocks']>[number],
  appId: string,
  installationId: string
): WorkflowBlock {
  return {
    id: block.id,
    appId,
    installationId,
    label: block.label,
    description: block.description,
    category: 'integration',
    icon: block.iconKey ?? undefined,
    color: block.color,
    schema: {
      inputs: {},
      outputs: {},
    },
  }
}

function catalogTriggerToWorkflowBlock(
  trigger: NonNullable<AppInstallation['workflowTriggers']>[number],
  appId: string,
  installationId: string
): WorkflowBlock {
  return {
    id: trigger.triggerId,
    appId,
    installationId,
    label: trigger.label,
    description: trigger.description,
    category: 'integration',
    schema: {
      inputs: {},
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
          `[WorkflowBlockLoader] RPC fallback failed for ${installation.app.id}:`,
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

    const blocks = installation.workflowBlocks ?? []
    if (blocks.length > 0) {
      this.loadedBlocks.set(
        loadKey,
        blocks.map((b) => catalogBlockToWorkflowBlock(b, appId, installationId))
      )
    }

    const triggers = installation.workflowTriggers ?? []
    if (triggers.length > 0) {
      this.loadedTriggers.set(
        loadKey,
        triggers.map((t) => catalogTriggerToWorkflowBlock(t, appId, installationId))
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
