// apps/web/src/components/data-connectors/ui/install-owned-defs.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Boxes } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  EntityTemplateDialog,
  type EntityTemplateInstallResult,
} from '~/components/custom-fields/ui/entity-template-dialog'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { bindInstalledOwnedDefs } from '../lib/bind-installed-owned-defs'
import { getConnectorDraftState, useConnectorDraftStore } from '../stores/connector-draft-store'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>

/**
 * The Map-step affordance for an app connector whose OWNED record types don't exist yet
 * (v6 — install-target-defs-via-templates). The connector seeds its owned mappings
 * UNBOUND; this banner installs the app's record-type definitions through the reused
 * `EntityTemplateDialog` (stamping connector/app ownership via `installContext`), then
 * binds each owned mapping to its freshly-installed def + concrete field refs in the
 * draft (committed with the connector save). Hidden once every owned mapping is bound,
 * or for a connector that declares no owned targets.
 */
export function InstallOwnedDefs({ connector }: { connector: Connector }) {
  const [open, setOpen] = useState(false)
  const { data } = api.dataConnector.ownedTargets.useQuery(
    { id: connector.id },
    { enabled: connector.type.startsWith('app:') }
  )

  // Any owned mapping still unbound? Read off the DRAFT so the banner vanishes the
  // moment the install's binding lands (no refetch). Tombstoned rows don't count.
  const hasUnboundOwned = useConnectorDraftStore((s) =>
    s.draft.streams.some((st) =>
      st.mappings.some(
        (m) => !m._deleted && m.targetMode === 'owned' && m.entityDefinitionId == null
      )
    )
  )

  // One template per owned key (a key shared by a def + a reference mapping installs once).
  const templateIds = useMemo(
    () => [...new Set((data?.targets ?? []).map((t) => t.templateId))],
    [data]
  )

  if (!data || !data.appSlug || templateIds.length === 0 || !hasUnboundOwned) return null

  const appTitle = data.appTitle ?? data.appSlug
  const count = templateIds.length

  // Bind every owned mapping to its installed def + repointed refs in ONE store
  // mutation (one re-render / dirty tick), then close.
  const applyBindings = (result: EntityTemplateInstallResult) => {
    const { draft, updateMappings } = getConnectorDraftState()
    const bindings = bindInstalledOwnedDefs({
      appSlug: data.appSlug!,
      result,
      ownedTargets: data.targets,
      draftStreams: draft.streams,
    })
    updateMappings(
      bindings.map((b) => ({
        streamId: b.streamId,
        mappingId: b.mappingId,
        patch: { entityDefinitionId: b.entityDefinitionId, fieldMappings: b.fieldMappings },
      }))
    )
    setOpen(false)
  }

  return (
    <>
      <div className='flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2.5 dark:border-violet-300/30 dark:bg-violet-300/10'>
        <Boxes className='size-4 shrink-0 text-violet-600 dark:text-violet-300' />
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='text-sm font-medium'>
            {appTitle}{' '}
            {count === 1 ? 'creates a new record type' : `creates ${count} new record types`}
          </span>
          <span className='text-xs text-muted-foreground'>
            Install {count === 1 ? 'it' : 'them'} to map this connector — or pick an existing
            definition per stream below.
          </span>
        </div>
        <Button variant='outline' size='xs' className='shrink-0' onClick={() => setOpen(true)}>
          Install definitions
        </Button>
      </div>
      <EntityTemplateDialog
        open={open}
        onOpenChange={setOpen}
        preSelectedTemplateIds={templateIds}
        installContext={{
          dataConnectorId: connector.id,
          appInstallationId: connector.appInstallationId ?? undefined,
        }}
        onComplete={applyBindings}
      />
    </>
  )
}
