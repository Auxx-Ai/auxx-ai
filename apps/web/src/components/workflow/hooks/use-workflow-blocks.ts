// apps/web/src/components/workflow/hooks/use-workflow-blocks.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '~/lib/extensions/use-app-store'
import { AppWorkflowNode } from '~/lib/workflow/components/app-workflow-node'
import { WorkflowBlockLoader } from '~/lib/workflow/workflow-block-loader'
import { WorkflowBlockRegistry } from '~/lib/workflow/workflow-block-registry'
import { useDehydratedOrganizationId } from '~/providers/dehydrated-state-provider'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import { unifiedNodeRegistry } from '../nodes/unified-registry'

/**
 * Hook to load and register workflow blocks from installed apps
 * @returns Loading state and error if any
 */
export function useWorkflowBlocks() {
  const organizationId = useDehydratedOrganizationId()
  const appStore = useAppStore()
  const { appInstallations, isLoading: isLoadingInstallations } = useExtensionsContext()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // Keep refs to avoid recreating instances
  const loaderRef = useRef<WorkflowBlockLoader | null>(null)
  const registryRef = useRef<WorkflowBlockRegistry | null>(null)

  // Initialize loader and registry once
  if (!loaderRef.current) {
    loaderRef.current = new WorkflowBlockLoader(appStore)
  }
  if (!registryRef.current) {
    registryRef.current = new WorkflowBlockRegistry()
  }

  const loader = loaderRef.current
  const registry = registryRef.current

  /**
   * Load all workflow blocks from installed apps
   */
  const loadBlocks = useCallback(async () => {
    if (!organizationId) {
      setIsLoading(false)
      return
    }

    // Wait for app installations to load before attempting to load blocks
    if (isLoadingInstallations) {
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      // Check cache and register cached blocks immediately
      for (const installation of appInstallations) {
        const cachedBlocks = registry.getCachedBlocks(
          installation.app.id,
          installation.installationId
        )

        const appMeta = {
          appSlug: installation.app.slug,
          installationType: installation.installationType,
        } as const

        if (cachedBlocks) {
          const nodeDefinitions = registry.registerBlocks(
            installation.app.id,
            installation.installationId,
            cachedBlocks,
            appMeta
          )

          // Register with unified registry
          for (const def of nodeDefinitions) {
            unifiedNodeRegistry.registerOrUpdate({
              ...def,
              component: AppWorkflowNode,
            })
          }
        }
      }

      // Load blocks from all apps (handles failures gracefully)
      await loader.loadAllBlocks(appInstallations)

      // Register loaded blocks
      const loadedBlocks = loader.getAllBlocks()
      const blocksByInstall = new Map<
        string,
        { appId: string; installationId: string; blocks: any[] }
      >()

      for (const block of loadedBlocks) {
        const key = `${block.appId}:${block.installationId}`
        if (!blocksByInstall.has(key)) {
          blocksByInstall.set(key, {
            appId: block.appId,
            installationId: block.installationId,
            blocks: [],
          })
        }
        blocksByInstall.get(key)!.blocks.push(block)
      }

      // Register each installation's blocks
      for (const [, { appId, installationId, blocks }] of blocksByInstall) {
        // Resolve app metadata for this installation
        const inst = appInstallations.find(
          (i) => i.app.id === appId && i.installationId === installationId
        )
        const meta = inst
          ? ({ appSlug: inst.app.slug, installationType: inst.installationType } as const)
          : undefined

        const nodeDefinitions = registry.registerBlocks(appId, installationId, blocks, meta)

        // Register with unified registry
        for (const def of nodeDefinitions) {
          unifiedNodeRegistry.registerOrUpdate({
            ...def,
            component: AppWorkflowNode,
          })
        }

        // Register triggers for this installation
        const appTriggers = loader.getTriggersForApp(appId, installationId)
        if (appTriggers.length > 0) {
          const triggerDefinitions = registry.registerTriggers(
            appId,
            installationId,
            appTriggers,
            meta
          )
          for (const def of triggerDefinitions) {
            unifiedNodeRegistry.registerOrUpdate({
              ...def,
              component: AppWorkflowNode,
            })
          }
        }
      }
    } catch (err) {
      console.error('[useWorkflowBlocks] Failed to load workflow blocks:', err)
      setError(err as Error)
    } finally {
      setIsLoading(false)
    }
  }, [organizationId, loader, registry, appInstallations, isLoadingInstallations])

  // Load blocks on mount and when dependencies change
  useEffect(() => {
    loadBlocks()
  }, [loadBlocks])

  // Subscribe to MessageClient registration events
  // When a MessageClient is registered (even late), reload blocks for that app
  useEffect(() => {
    const unsubscribe = appStore.events.messageClientChanged.addListener(
      async ({ appId, appInstallationId }) => {
        // Find the installation for this app
        const installation = appInstallations.find(
          (inst) => inst.app.id === appId && inst.installationId === appInstallationId
        )

        if (!installation) {
          return
        }

        try {
          // Clear any previous failed attempts for this installation
          loader.unloadAppBlocks(appId, appInstallationId)

          // Load blocks from the newly registered app
          await loader.loadAppWorkflowBlocks(appId, appInstallationId)

          // Get the loaded blocks
          const appBlocks = loader.getBlocksForApp(appId, appInstallationId)

          const lateAppMeta = installation
            ? ({
                appSlug: installation.app.slug,
                installationType: installation.installationType,
              } as const)
            : undefined

          if (appBlocks.length > 0) {
            // Register blocks with local registry
            const nodeDefinitions = registry.registerBlocks(
              appId,
              appInstallationId,
              appBlocks,
              lateAppMeta
            )

            // Register with unified registry
            for (const def of nodeDefinitions) {
              unifiedNodeRegistry.registerOrUpdate({
                ...def,
                component: AppWorkflowNode,
              })
            }
          }

          // Register triggers
          const appTriggers = loader.getTriggersForApp(appId, appInstallationId)
          if (appTriggers.length > 0) {
            const triggerDefinitions = registry.registerTriggers(
              appId,
              appInstallationId,
              appTriggers,
              lateAppMeta
            )
            for (const def of triggerDefinitions) {
              unifiedNodeRegistry.registerOrUpdate({
                ...def,
                component: AppWorkflowNode,
              })
            }
          }
        } catch (err) {
          console.error('[useWorkflowBlocks] Failed to load blocks for', installation.app.slug, err)
        }
      }
    )

    return unsubscribe
  }, [appStore, appInstallations, loader, registry])

  return {
    isLoading: isLoading || isLoadingInstallations,
    error,
    reload: loadBlocks,
  }
}
