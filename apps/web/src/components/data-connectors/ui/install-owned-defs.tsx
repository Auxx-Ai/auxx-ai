// apps/web/src/components/data-connectors/ui/install-owned-defs.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Boxes, Link2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  EntityTemplateDialog,
  type EntityTemplateInstallResult,
} from '~/components/custom-fields/ui/entity-template-dialog'
import { useResources } from '~/components/resources/hooks/use-resources'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { bindInstalledOwnedDefs } from '../lib/bind-installed-owned-defs'
import { getConnectorDraftState, useConnectorDraftStore } from '../stores/connector-draft-store'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>

/**
 * The Map-step affordance for an app connector's OWNED record types (v6 —
 * install-target-defs-via-templates). Renders up to two banners:
 *
 * - **Install** — for owned mappings still UNBOUND (`entityDefinitionId == null`):
 *   installs the app's record-type definitions through the reused `EntityTemplateDialog`
 *   (stamping connector/app ownership via `installContext`), then binds each owned mapping
 *   to its freshly-installed def + concrete field refs in the draft.
 * - **Reusing existing** — for owned mappings that were ADOPTED at setup (bound to a def
 *   another connector already owns, e.g. GitHub Issues repo 1 + repo 2 sharing one def).
 *   Read-only note so the user knows records join an existing table, not that a step was
 *   skipped. See plans/data-connectors/v6/shared-definitions-across-connectors-plan.md.
 *
 * Hidden when neither applies.
 */
export function InstallOwnedDefs({ connector }: { connector: Connector }) {
  const [open, setOpen] = useState(false)
  const { data } = api.dataConnector.ownedTargets.useQuery(
    { id: connector.id },
    { enabled: connector.type.startsWith('app:') }
  )

  // Owned mappings read off the DRAFT so both banners react the moment a binding lands
  // (no refetch). Tombstoned rows don't count.
  const draftStreams = useConnectorDraftStore((s) => s.draft.streams)
  const hasUnboundOwned = useMemo(
    () =>
      draftStreams.some((st) =>
        st.mappings.some(
          (m) => !m._deleted && m.targetMode === 'owned' && m.entityDefinitionId == null
        )
      ),
    [draftStreams]
  )
  const boundOwnedDefIds = useMemo(
    () =>
      new Set(
        draftStreams.flatMap((st) =>
          st.mappings
            .filter((m) => !m._deleted && m.targetMode === 'owned' && m.entityDefinitionId != null)
            .map((m) => m.entityDefinitionId as string)
        )
      ),
    [draftStreams]
  )

  // Adopted = an owned mapping bound to a def ANOTHER connector owns (shared, not forked).
  // A null-owner def (user/template pick) is deliberately excluded — that's a different flow.
  const { customResources } = useResources()
  const connectors = api.dataConnector.list.useQuery()
  const connectorNameById = useMemo(
    () => new Map((connectors.data ?? []).map((c) => [c.id, c.name])),
    [connectors.data]
  )
  const adoptedDefs = useMemo(() => {
    const out: Array<{ id: string; label: string; ownerName: string | null }> = []
    for (const r of customResources) {
      if (!boundOwnedDefIds.has(r.id)) continue
      if (r.dataConnectorId == null || r.dataConnectorId === connector.id) continue
      out.push({
        id: r.id,
        label: r.label,
        ownerName: connectorNameById.get(r.dataConnectorId) ?? null,
      })
    }
    return out
  }, [customResources, boundOwnedDefIds, connector.id, connectorNameById])

  // One template per owned key (a key shared by a def + a reference mapping installs once).
  const templateIds = useMemo(
    () => [...new Set((data?.targets ?? []).map((t) => t.templateId))],
    [data]
  )

  const showInstall = !!data?.appSlug && templateIds.length > 0 && hasUnboundOwned
  if (!showInstall && adoptedDefs.length === 0) return null

  const appTitle = data?.appTitle ?? data?.appSlug ?? 'This app'
  const count = templateIds.length

  const adoptedList = adoptedDefs
    .map((d) => (d.ownerName ? `${d.label} (from ${d.ownerName})` : d.label))
    .join(', ')

  // Bind every owned mapping to its installed def + repointed refs in ONE store
  // mutation (one re-render / dirty tick), then close.
  const applyBindings = (result: EntityTemplateInstallResult) => {
    if (!data?.appSlug) return
    const { draft, updateMappings } = getConnectorDraftState()
    const bindings = bindInstalledOwnedDefs({
      appSlug: data.appSlug,
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
    <div className='flex flex-col gap-2'>
      {adoptedDefs.length > 0 && (
        <div className='flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50/50 px-3 py-2.5 dark:border-sky-300/30 dark:bg-sky-300/10'>
          <Link2 className='size-4 shrink-0 text-sky-600 dark:text-sky-300' />
          <div className='flex min-w-0 flex-1 flex-col'>
            <span className='text-sm font-medium'>
              Reusing{' '}
              {adoptedDefs.length === 1 ? 'an existing record type' : 'existing record types'}
            </span>
            <span className='text-xs text-muted-foreground'>
              {adoptedList} already {adoptedDefs.length === 1 ? 'exists' : 'exist'} — new records
              will be added to {adoptedDefs.length === 1 ? 'it' : 'them'}, not duplicated.
            </span>
          </div>
        </div>
      )}

      {showInstall && (
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
      )}

      {showInstall && (
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
      )}
    </div>
  )
}
