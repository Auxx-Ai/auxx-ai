// apps/web/src/components/global/sidebar/tree/entity-row.tsx
'use client'

import type { CustomResource } from '@auxx/lib/resources/client'
import type { ResourceNavEntry } from '@auxx/lib/sidebar-layout/client'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { Archive, Pencil, Plus, Settings, Trash2 } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { EntityIconWithConnector } from '~/components/data-connectors/ui/entity-icon-with-connector'
import { useCreateEntityStore } from '~/components/global-create/create-entity-store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { useAccess } from '~/providers/capabilities-provider'
import { SidebarNavItem } from '../sidebar-nav-item'
import { useEntityActions } from './entity-actions'
import { isPathActive } from './sidebar-access'

/** Records list url for a def: system entity types have top-level routes. */
export function entityHref(def: Pick<ResourceNavEntry, 'entityType' | 'apiSlug'>): string {
  return def.entityType ? `/app/${def.apiSlug}` : `/app/custom/${def.apiSlug}`
}

/** An ENTITY_DEFINITION row: colored entity icon + connector badge, labelled with the plural. */
export function EntityRow({ def, isSubmenu }: { def: ResourceNavEntry; isSubmenu: boolean }) {
  const pathname = usePathname()
  const href = entityHref(def)
  const resource = useResourceStore((s) =>
    s.customResources.find((r) => r.entityDefinitionId === def.id)
  )

  return (
    <SidebarNavItem
      id={def.id}
      name={def.plural}
      href={href}
      icon={
        <EntityIconWithConnector
          iconId={def.icon}
          color={def.color ?? 'gray'}
          size='sm'
          inverse
          className='-ms-0.5 inset-shadow-xs inset-shadow-black/20'
          dataConnectorId={def.dataConnectorId ?? undefined}
          connectorHref={def.dataConnectorId ? `/app/connectors/${def.dataConnectorId}` : undefined}
          tooltip={`${def.plural} are synced by a data connector`}
        />
      }
      isActive={isPathActive(pathname, href)}
      isSubmenu={isSubmenu}
      editItems={resource ? <EntityRowActions resource={resource} /> : undefined}
    />
  )
}

/** Create record, edit entity, manage fields, archive, delete — gated like the def pages. */
function EntityRowActions({ resource }: { resource: CustomResource }) {
  const router = useRouter()
  const { canAdministerDef } = useAccess()
  const actions = useEntityActions()

  const isSystemEntity = !!resource.entityType
  // Def administration is the `Full`/`admin` rung; the server enforces regardless.
  const canAdminister = canAdministerDef(resource.entityDefinitionId)
  const canRemove = !isSystemEntity && canAdminister

  return (
    <>
      <DropdownMenuItem
        onClick={() =>
          useCreateEntityStore.getState().openDialog({ entityDefinitionId: resource.id })
        }>
        <Plus /> Create {resource.label}
      </DropdownMenuItem>
      {!isSystemEntity && canAdminister && (
        <DropdownMenuItem onClick={() => actions.editEntity(resource)}>
          <Pencil /> Edit Entity
        </DropdownMenuItem>
      )}
      {canAdminister && (
        <DropdownMenuItem
          onClick={() => router.push(`/app/settings/custom-fields/${resource.apiSlug}`)}>
          <Settings /> Manage Fields
        </DropdownMenuItem>
      )}
      {canRemove && <DropdownMenuSeparator />}
      {canRemove && (
        <DropdownMenuItem onClick={() => actions.archiveEntity(resource)} variant='destructive'>
          <Archive /> Archive
        </DropdownMenuItem>
      )}
      {canRemove && (
        <DropdownMenuItem onClick={() => actions.deleteEntity(resource)} variant='destructive'>
          <Trash2 /> Delete permanently
        </DropdownMenuItem>
      )}
    </>
  )
}
