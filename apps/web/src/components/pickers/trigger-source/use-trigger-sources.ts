// apps/web/src/components/pickers/trigger-source/use-trigger-sources.ts
// Merges the two webhook-ish trigger sources a consumer (agent / data-connector) can
// bind to — installed-app webhook triggers and generic inbound WebhookEndpoints — into
// one grouped, discriminated list for the shared TriggerSourcePicker. App triggers come
// from the cached installed-apps context (sync); endpoints from `api.webhookEndpoint.list`.

'use client'

import type { CatalogTriggerProjection } from '@auxx/database'
import { useMemo } from 'react'
import { type AppInstallation, useAppsContext } from '~/components/apps/providers/apps-context'
import { api, type RouterOutputs } from '~/trpc/react'

export type WebhookEndpointSummary = RouterOutputs['webhookEndpoint']['list'][number]

/** An installed-app webhook trigger (app's `*.webhook.ts` normalizes the payload). */
export interface AppTriggerSource {
  kind: 'app'
  installation: AppInstallation
  trigger: CatalogTriggerProjection
}

/** A generic app-less inbound webhook URL (platform verifies; raw body is the payload). */
export interface WebhookEndpointSource {
  kind: 'webhook-endpoint'
  endpoint: WebhookEndpointSummary
}

export type TriggerSource = AppTriggerSource | WebhookEndpointSource

/** Which surface's catalog triggers to read: agents use `agentTriggers`, workflows `workflowTriggers`. */
export type TriggerSurface = 'agent' | 'workflow'

export interface UseTriggerSourcesOptions {
  surface?: TriggerSurface
  /** Restrict the APP group to one app (the data-connector binds its connection's app). */
  appIdFilter?: string
}

export interface UseTriggerSourcesResult {
  appSources: AppTriggerSource[]
  endpointSources: WebhookEndpointSource[]
  isLoading: boolean
}

/** Pull an installation's triggers for the given surface (workflow falls back to agent). */
function triggersForSurface(
  inst: AppInstallation,
  surface: TriggerSurface
): CatalogTriggerProjection[] {
  if (surface === 'workflow') return inst.workflowTriggers ?? inst.agentTriggers ?? []
  return inst.agentTriggers ?? []
}

export function useTriggerSources(opts: UseTriggerSourcesOptions = {}): UseTriggerSourcesResult {
  const { surface = 'agent', appIdFilter } = opts
  const { appInstallations, isLoading: appsLoading } = useAppsContext()
  const endpoints = api.webhookEndpoint.list.useQuery()

  const appSources = useMemo<AppTriggerSource[]>(() => {
    const out: AppTriggerSource[] = []
    for (const inst of appInstallations) {
      if (appIdFilter && inst.app.id !== appIdFilter) continue
      for (const trigger of triggersForSurface(inst, surface)) {
        out.push({ kind: 'app', installation: inst, trigger })
      }
    }
    return out
  }, [appInstallations, surface, appIdFilter])

  const endpointSources = useMemo<WebhookEndpointSource[]>(
    () => (endpoints.data ?? []).map((endpoint) => ({ kind: 'webhook-endpoint', endpoint })),
    [endpoints.data]
  )

  return {
    appSources,
    endpointSources,
    isLoading: appsLoading || endpoints.isLoading,
  }
}
