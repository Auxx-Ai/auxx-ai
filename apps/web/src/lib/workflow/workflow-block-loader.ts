// apps/web/src/lib/workflow/workflow-block-loader.ts

import type { AppInstallation } from '~/providers/extensions/extensions-context'
import type { AppStore } from '../extensions/app-store'
import type { WorkflowBlock } from './types'

/**
 * Responsible for loading workflow blocks from installed apps
 */
export class WorkflowBlockLoader {
  private appStore: AppStore
  private loadedBlocks = new Map<string, WorkflowBlock[]>()

  constructor(appStore: AppStore) {
    this.appStore = appStore
  }

  /**
   * Load workflow blocks from all installed apps
   * @param appInstallations - List of installed apps from ExtensionsContext
   */
  async loadAllBlocks(appInstallations: AppInstallation[]): Promise<void> {
    // Use allSettled to handle failures gracefully - one failed app won't block others
    const results = await Promise.allSettled(
      appInstallations.map((installation) => {
        return this.loadAppWorkflowBlocks(installation.app.id, installation.installationId)
      })
    )

    // Handle failures without blocking successful loads
    const failures: Array<{ appId: string; error: any }> = []
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        const installation = appInstallations[idx]
        failures.push({ appId: installation.app.id, error: result.reason })
      }
    })
  }

  /**
   * Load workflow blocks from a specific app
   */
  async loadAppWorkflowBlocks(appId: string, installationId: string): Promise<void> {
    // Check if already loaded
    if (this.loadedBlocks.has(appId)) {
      return
    }

    try {
      // Get or create message client for this app
      const messageClient = this.appStore.getMessageClient({
        appId,
        appInstallationId: installationId,
      })

      if (!messageClient) {
        return // Don't throw - let it fail gracefully
      }

      // Wait for client to be ready (iframe load + SDK ready)
      try {
        await messageClient.waitUntilReady()
      } catch (readyError) {
        return // Don't throw - let it fail gracefully
      }

      // Request workflow blocks from iframe
      try {
        const result = await messageClient.sendRequest<{
          blocks: Omit<WorkflowBlock, 'appId' | 'installationId'>[]
        }>('get-workflow-blocks', {}, { timeout: 10000 })

        if (result.blocks && result.blocks.length > 0) {
          // Enrich blocks with appId and installationId
          const enrichedBlocks: WorkflowBlock[] = result.blocks.map((block) => ({
            ...block,
            appId,
            installationId,
          }))

          this.loadedBlocks.set(appId, enrichedBlocks)
        }
      } catch (requestError) {
        return // Don't throw - let it fail gracefully
      }
    } catch (error) {
      // Don't throw - already handled by Promise.allSettled
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
   * Get workflow blocks for a specific app
   */
  getBlocksForApp(appId: string): WorkflowBlock[] {
    return this.loadedBlocks.get(appId) || []
  }

  /**
   * Get workflow blocks by category
   */
  getBlocksByCategory(category: string): WorkflowBlock[] {
    return this.getAllBlocks().filter((block) => block.category === category)
  }

  /**
   * Unload workflow blocks for an app
   */
  unloadAppBlocks(appId: string): void {
    this.loadedBlocks.delete(appId)
  }
}
