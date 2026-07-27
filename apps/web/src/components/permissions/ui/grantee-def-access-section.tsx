// apps/web/src/components/permissions/ui/grantee-def-access-section.tsx
'use client'

import { ButtonSwitch } from '@auxx/ui/components/button-switch'
import { InputSearch } from '@auxx/ui/components/input-search'
import { EmptySection } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import {
  type GranteeKind,
  type GranteePrincipal,
  useGranteeDefAccess,
} from '../hooks/use-grantee-def-access'
import { GranteeDefAccessRows } from './grantee-def-access-rows'

const COPY: Partial<Record<GranteeKind, { description: string }>> = {
  user: {
    description:
      'Access to individual record types. Each row shows what this member gets by default; pick a level to override it for that type.',
  },
  group: {
    description:
      'Access to individual record types. Each row shows what this team gets by default; pick a level to override it for that type.',
  },
}

/**
 * Agent copy. An agent's default per type is Full unless its Records area was
 * lowered above, or the type itself is restricted workspace-wide.
 */
const AGENT_DESCRIPTION =
  'Access to individual record types. Each row shows what this agent gets by default. Pick a level to override it for that type.'

/** Neutral copy for a grantee kind this section does not model (e.g. `profile`). */
const FALLBACK_DESCRIPTION =
  'Access to individual record types. Each row shows what this grantee gets by default; pick a level to override it for that type.'

/**
 * Total copy lookup — `COPY[granteeKind].description` on an unlisted kind throws
 * during render, and this section is the record-access half of a member/team
 * detail page.
 */
function descriptionFor(granteeKind: string): string {
  return COPY[granteeKind as GranteeKind]?.description ?? FALLBACK_DESCRIPTION
}

/**
 * The grantee-centric entity-def **Access** section (capability layer v2
 * grantee-def-access) — the transpose of the per-def Permissions tab. Lists every
 * in-scope CRM record type with an `Inherit / Read / Edit / Full` picker scoped to
 * one grantee (a member or a team), editing the same type-level `ResourceAccess`
 * rows the per-def UI writes. `canEdit` (the `granularPermissions` gate) is owned
 * by the host tab; the page is already admin-only and the endpoint enforces admin
 * independently.
 *
 * This is the Layer-3 overlay on the Records area (shown above). Each row's picker
 * resolves the "Inherit" option to what the grantee gets by default (the def's
 * workspace baseline if configured, else their general Records level); picking a
 * level writes an explicit override. Restricted defs (baseline = No Access) carry a
 * lock; an override that lifts nothing above the default is tagged "no effect".
 */
export function GranteeDefAccessSection({
  granteeKind,
  granteeId,
  canEdit,
  principal = 'member',
}: {
  granteeKind: GranteeKind
  granteeId: string
  canEdit: boolean
  /**
   * `agent` switches the "Inherit" fall-through to the agent SET-semantics
   * default (Full) and the copy with it — see {@link GranteePrincipal}.
   */
  principal?: GranteePrincipal
}) {
  const { isLoading, rows, setLevel } = useGranteeDefAccess(granteeKind, granteeId, principal)

  const [search, setSearch] = useState('')
  const [overridesOnly, setOverridesOnly] = useState(false)

  const query = search.trim().toLowerCase()

  /** Rows narrowed by the search query and the "overrides only" toggle. */
  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (overridesOnly && row.grantLevel === undefined) return false
        if (!query) return true
        const { plural, label } = row.resource
        return plural.toLowerCase().includes(query) || label.toLowerCase().includes(query)
      }),
    [rows, query, overridesOnly]
  )

  return (
    <SettingsSection
      icon={ShieldCheck}
      title='Record access'
      description={principal === 'agent' ? AGENT_DESCRIPTION : descriptionFor(granteeKind)}>
      {isLoading ? (
        <div className='border p-1 rounded-xl space-y-1'>
          <Skeleton className='h-9 w-full rounded-lg' />
          <Skeleton className='h-9 w-full rounded-lg' />
          <Skeleton className='h-9 w-full rounded-lg' />
        </div>
      ) : rows.length === 0 ? (
        <EmptySection
          orientation='horizontal'
          icon={<ShieldCheck />}
          title='No record types'
          description='There are no record types to configure access for yet.'
        />
      ) : (
        <div className='flex flex-col gap-3'>
          <div className='flex items-center gap-2'>
            <InputSearch
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search record types...'
            />
            <ButtonSwitch
              label='Overrides only'
              checked={overridesOnly}
              onCheckedChange={setOverridesOnly}
              disabled={!canEdit}
            />
          </div>

          {filteredRows.length === 0 ? (
            <EmptySection
              orientation='horizontal'
              icon={<ShieldCheck />}
              title='No matches'
              description='No record types match your search.'
            />
          ) : (
            <div className='border p-1 rounded-xl'>
              <GranteeDefAccessRows
                rows={filteredRows}
                canEdit={canEdit}
                principal={principal}
                depth={0}
                onChange={(entityDefinitionId, level) => setLevel(entityDefinitionId, level)}
              />
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  )
}
