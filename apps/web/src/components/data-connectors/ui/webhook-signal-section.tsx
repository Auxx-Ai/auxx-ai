// apps/web/src/components/data-connectors/ui/webhook-signal-section.tsx
'use client'

import { TreeRow } from '@auxx/ui/components/tree-row'
import { Webhook } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import {
  type TriggerSource,
  TriggerSourcePickerPopover,
  TriggerSourceRow,
  useTriggerSources,
} from '~/components/pickers/trigger-source'
import { WebhookEndpointInspector } from '~/components/webhooks/ui/webhook-endpoint-inspector'
import { AppTriggerTestSection } from '~/components/workflow/apps/trigger/app-trigger-test-section'
import type { RouterOutputs } from '~/trpc/react'
import { getConnectorDraftState, useConnectorDraftStore } from '../stores/connector-draft-store'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>

/** The connector-level webhook SIGNAL (v7): exactly one of an app trigger / endpoint. */
type WebhookSignal = { triggerId?: string; webhookEndpointId?: string }
type BoundSource =
  | { kind: 'app'; triggerId: string }
  | { kind: 'webhook-endpoint'; webhookEndpointId: string }

function savedSource(signal: WebhookSignal | undefined): BoundSource | null {
  if (signal?.webhookEndpointId) {
    return { kind: 'webhook-endpoint', webhookEndpointId: signal.webhookEndpointId }
  }
  if (signal?.triggerId) return { kind: 'app', triggerId: signal.triggerId }
  return null
}

/**
 * Connector-level webhook signal picker (v7). The SIGNAL — which inbound event drives
 * this connector (an installed-app webhook trigger OR a generic WebhookEndpoint) — is one
 * per connector (a connector fetches from a single provider), so it lives on
 * `connector.config.webhookTrigger`, not per-stream. Per-stream topic/token STEERING lives
 * in {@link WebhookSteeringSection}. Persists immediately via `dataConnector.update`
 * (merged into the existing config). Rendered inline inside the Schedule section's webhook
 * branch for generic-REST connectors only (app connectors can't consume a steered webhook)
 * — it is NOT its own section, so it carries no `Section` wrapper.
 */
export function WebhookSignalSection({ connector }: { connector: Connector }) {
  const { appInstallations, appConnections } = useAppsContext()

  // Resolve the app installation behind this connector's connection (if any) so app
  // triggers can be scoped to it. Endpoints are app-less, so this may be null.
  const installationId = useMemo(() => {
    if (connector.appInstallationId) return connector.appInstallationId
    const conn = appConnections.find((c) => c.id === connector.credentialId)
    return conn?.appInstallationId ?? null
  }, [connector.appInstallationId, connector.credentialId, appConnections])

  const appId = useMemo(
    () => appInstallations.find((i) => i.installationId === installationId)?.app.id,
    [appInstallations, installationId]
  )

  const { appSources, endpointSources } = useTriggerSources({
    surface: 'workflow',
    appIdFilter: appId,
  })

  // Read the signal from the DRAFT config so an unsaved pick is reflected; the unified
  // save bar persists it with everything else (plans/data-connectors/v4).
  const draftConfig = useConnectorDraftStore((s) => s.draft.config)
  const saved = (draftConfig as { webhookTrigger?: WebhookSignal }).webhookTrigger
  const [source, setSource] = useState<BoundSource | null>(() => savedSource(saved))
  const [pickerOpen, setPickerOpen] = useState(false)

  const selectedAppTrigger =
    source?.kind === 'app'
      ? (appSources.find((s) => s.trigger.triggerId === source.triggerId)?.trigger ?? null)
      : null
  const selectedEndpoint =
    source?.kind === 'webhook-endpoint'
      ? (endpointSources.find((s) => s.endpoint.id === source.webhookEndpointId)?.endpoint ?? null)
      : null

  const sourceLabel =
    source?.kind === 'app'
      ? (selectedAppTrigger?.label ?? source.triggerId)
      : source?.kind === 'webhook-endpoint'
        ? (selectedEndpoint?.name ?? source.webhookEndpointId)
        : null

  // Write the signal (or clear it) into the DRAFT config.webhookTrigger, merged so the
  // rest of the connector config (endpoint/filters/backfillWindowSpan) survives. The save
  // bar commits it — nothing persists on pick.
  const persist = (next: BoundSource | null) => {
    setSource(next)
    const signal: WebhookSignal | undefined = !next
      ? undefined
      : next.kind === 'app'
        ? { triggerId: next.triggerId }
        : { webhookEndpointId: next.webhookEndpointId }
    const cur = getConnectorDraftState().draft.config
    getConnectorDraftState().setConfig({ ...cur, webhookTrigger: signal })
  }

  const handlePick = (picked: TriggerSource) => {
    setPickerOpen(false)
    persist(
      picked.kind === 'app'
        ? { kind: 'app', triggerId: picked.trigger.triggerId }
        : { kind: 'webhook-endpoint', webhookEndpointId: picked.endpoint.id }
    )
  }

  return (
    <div className='flex flex-col gap-1.5'>
      <TriggerSourcePickerPopover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handlePick}
        surface='workflow'
        appIdFilter={appId}
        isSelected={(picked) =>
          picked.kind === 'app'
            ? source?.kind === 'app' && source.triggerId === picked.trigger.triggerId
            : source?.kind === 'webhook-endpoint' && source.webhookEndpointId === picked.endpoint.id
        }
        align='start'
        matchTriggerWidth
        trigger={
          // The visible row IS the popover trigger — clicking it opens the picker. The row's
          // Delete button stops propagation (TreeRow's actions cluster), so it won't re-open.
          <div className='cursor-pointer'>
            {source && sourceLabel ? (
              <TriggerSourceRow
                icon={<Webhook className='size-4 text-muted-foreground' />}
                title={sourceLabel}
                secondary={selectedEndpoint?.url ?? selectedAppTrigger?.description}
                onDelete={() => void persist(null)}
              />
            ) : (
              <TreeRow
                rowClassName='border-dashed border bg-primary-50'
                icon={<Webhook className='size-4 text-muted-foreground' />}
                title='Select a trigger'
              />
            )}
          </div>
        }
      />
    </div>
  )
}

/**
 * The live delivery inspector for the connector's bound signal (v7) — an app trigger's
 * test/listen panel or a WebhookEndpoint's delivery inspector. Both render their own
 * {@link Section}, so this is kept OUT of {@link WebhookSignalSection} (which is inlined
 * Section-less in the Schedule body) and rendered as a sibling section below it. Driven by
 * the persisted `config.webhookTrigger` so it follows whatever the picker last saved.
 */
export function WebhookSignalInspector({ connector }: { connector: Connector }) {
  const { appConnections } = useAppsContext()

  const installationId =
    connector.appInstallationId ??
    appConnections.find((c) => c.id === connector.credentialId)?.appInstallationId ??
    null

  const saved = (connector.config as { webhookTrigger?: WebhookSignal } | null)?.webhookTrigger
  const source = savedSource(saved)

  // These inspectors render their own `Section`; inside the connector's scroll column the
  // section's `p-3` right edge runs under the floating scrollbar, so bump the inner padding
  // on the right (the class targets the Section's inner padded div, not the wrapper).
  const sectionClassName = '[&_[data-slot=section]]:pr-5'

  if (source?.kind === 'app' && installationId) {
    return (
      <AppTriggerTestSection
        installationId={installationId}
        triggerId={source.triggerId}
        className={sectionClassName}
      />
    )
  }
  if (source?.kind === 'webhook-endpoint') {
    return (
      <WebhookEndpointInspector
        endpointId={source.webhookEndpointId}
        description='Live deliveries to this endpoint.'
        className={sectionClassName}
      />
    )
  }
  return null
}
