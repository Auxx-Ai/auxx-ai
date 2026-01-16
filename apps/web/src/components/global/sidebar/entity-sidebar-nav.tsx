// apps/web/src/components/global/sidebar/entity-sidebar-nav.tsx
'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { api } from '~/trpc/react'
import { Archive, Calculator, PackagePlus, Pencil, Plus, Settings, UserPlus } from 'lucide-react'
import { useResources } from '~/components/resources/hooks'
import type { CustomResource } from '@auxx/lib/resources/client'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '@auxx/ui/components/sidebar'
import { SidebarGroupHeader } from '~/components/global/sidebar/sidebar-group-header'
import { useSidebarStateContext } from './sidebar-state-context'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import { SidebarItem } from './sidebar-item'
import { EntityIcon, getIcon } from '@auxx/ui/components/icons'
import { EntityDefinitionDialog } from '~/components/custom-fields/ui/entity-definition-dialog'
import { useConfirm } from '~/hooks/use-confirm'
import { useEntityDefinitionMutations } from '~/components/resources/hooks'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'

/** Entity definition type for sidebar actions */
type EntityDefinition = CustomResource

/**
 * Sidebar navigation component for dynamic entity definitions.
 * Displays entity definitions under "Records" section with icons.
 */
export function EntitySidebarNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEntity, setEditingEntity] = useState<EntityDefinition | null>(null)
  const [confirm, ConfirmDialog] = useConfirm()
  const { archiveEntity } = useEntityDefinitionMutations()
  const { getGroupOpen, toggleGroup } = useSidebarStateContext()
  const isOpen = getGroupOpen('records')

  // Recalculate all part costs mutation
  const calculateAllCosts = api.part.calculateAllCosts.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Costs recalculated successfully' })
    },
    onError: (error) => {
      toastError({ title: 'Error recalculating costs', description: error.message })
    },
  })

  /** Toggle the Records group open/closed state */
  function handleToggleOpen() {
    toggleGroup('records')
  }

  // Get custom entities from resource store
  const { resources, isLoading } = useResources()
  console.log('Resources in Sidebar:', resources)
  const dynamicEntities = resources

  // console.log('Dynamic Entities:', dynamicEntities)
  /** Open dialog in edit mode */
  function handleEditEntity(entity: EntityDefinition) {
    // Map CustomResource to EntityDefinitionEntity format expected by dialog
    setEditingEntity({
      id: entity.id,
      apiSlug: entity.apiSlug,
      icon: entity.icon,
      color: entity.color,
      singular: entity.label, // CustomResource uses 'label' instead of 'singular'
      plural: entity.plural,
      primaryDisplayFieldId: entity.display?.primaryDisplayField?.id ?? null,
      secondaryDisplayFieldId: entity.display?.secondaryDisplayField?.id ?? null,
      avatarFieldId: entity.display?.avatarField?.id ?? null,
    })
    setDialogOpen(true)
  }

  /** Archive an entity definition */
  async function handleArchiveEntity(entity: EntityDefinition) {
    const confirmed = await confirm({
      title: `Archive "${entity.label}"?`,
      description:
        'This entity will be archived and hidden. You can restore it later from Settings.',
      confirmText: 'Archive',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      archiveEntity.mutate(
        { id: entity.id },
        {
          onError: (error) => {
            toastError({ title: 'Failed to archive entity', description: error.message })
          },
        }
      )
    }
  }

  /** Check if contacts route is active */
  function isContactsActive() {
    return pathname === '/app/contacts' || pathname.startsWith('/app/contacts/')
  }

  /** Check if parts route is active */
  function isPartsActive() {
    return pathname === '/app/parts' || pathname.startsWith('/app/parts/')
  }

  /** Check if tickets route is active */
  function isTicketsActive() {
    return pathname === '/app/tickets' || pathname.startsWith('/app/tickets/')
  }

  /**
   * Check if a route is active
   */
  function isActive(slug: string) {
    const url = `/app/custom/${slug}`
    return pathname === url || pathname.startsWith(`${url}/`)
  }

  /**
   * Render icon component for entity definition
   */
  function renderIcon(iconId: string, color: string) {
    return (
      <EntityIcon
        iconId={iconId}
        color={color ?? 'gray'}
        size="sm"
        inverse
        className="-ms-0.5 inset-shadow-xs inset-shadow-black/20"
      />
    )
    // const iconData = getIcon(iconId ?? 'circle')
    // if (!iconData) return null
    // const IconComponent = iconData.icon
    // return <IconComponent className="size-4" />
  }

  return (
    <>
      <SidebarGroup className="group">
        <SidebarGroupHeader
          title="Records"
          isEditMode={false}
          onToggleEditMode={() => {}}
          isOpen={isOpen}
          toggleOpen={handleToggleOpen}
          additionalOptions={
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                router.push('/app/settings/custom-fields')
              }}>
              <Settings /> Manage Objects
            </DropdownMenuItem>
          }
        />
        {isOpen && (
          <SidebarMenu className="gap-0">
            {/* Static Contacts item - always first */}
            <SidebarMenuItem>
              <SidebarItem
                id="contacts"
                name="Contacts"
                href="/app/contacts"
                icon={
                  <EntityIcon
                    iconId="users"
                    color="gray"
                    size="sm"
                    inverse
                    className="-ms-0.5 inset-shadow-xs inset-shadow-black/20"
                  />
                }
                isActive={isContactsActive()}
                editItems={
                  <DropdownMenuItem onClick={() => router.push('/app/contacts?create=true')}>
                    <UserPlus /> Create Contact
                  </DropdownMenuItem>
                }
              />
            </SidebarMenuItem>

            {/* Static Support Tickets item - below Contacts */}
            <SidebarMenuItem>
              <SidebarItem
                id="tickets"
                name="Support Tickets"
                href="/app/tickets"
                icon={
                  <EntityIcon
                    iconId="tags"
                    color="gray"
                    size="sm"
                    inverse
                    className="-ms-0.5 inset-shadow-xs inset-shadow-black/20"
                  />
                }
                isActive={isTicketsActive()}
                editItems={
                  <DropdownMenuItem onClick={() => router.push('/app/tickets?create=true')}>
                    <Plus /> Create Ticket
                  </DropdownMenuItem>
                }
              />
            </SidebarMenuItem>

            {/* Static Parts item - below Tickets */}
            <SidebarMenuItem>
              <SidebarItem
                id="parts"
                name="Parts"
                href="/app/parts"
                icon={
                  <EntityIcon
                    iconId="boxes"
                    color="gray"
                    size="sm"
                    inverse
                    className="-ms-0.5 inset-shadow-xs inset-shadow-black/20"
                  />
                }
                isActive={isPartsActive()}
                editItems={
                  <>
                    <DropdownMenuItem onClick={() => router.push('/app/parts?create=true')}>
                      <PackagePlus /> Create Part
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => calculateAllCosts.mutate()}
                      disabled={calculateAllCosts.isPending}>
                      <Calculator /> Recalculate Costs
                    </DropdownMenuItem>
                  </>
                }
              />
            </SidebarMenuItem>

            {isLoading ? (
              // Loading skeleton
              <>
                <SidebarMenuSkeleton showIcon />
                <SidebarMenuSkeleton showIcon />
              </>
            ) : (
              dynamicEntities?.map((entity) => {
                const editItems = (
                  <>
                    <DropdownMenuItem onClick={() => handleEditEntity(entity)}>
                      <Pencil /> Edit Entity
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => router.push(`/app/settings/custom-fields/${entity.apiSlug}`)}>
                      <Settings /> Manage Fields
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleArchiveEntity(entity)}
                      variant="destructive">
                      <Archive /> Archive
                    </DropdownMenuItem>
                  </>
                )

                return (
                  <SidebarMenuItem key={entity.id}>
                    <SidebarItem
                      id={entity.id}
                      name={entity.plural}
                      href={`/app/custom/${entity.apiSlug}`}
                      icon={renderIcon(entity.icon, entity.color)}
                      isActive={isActive(entity.apiSlug)}
                      editItems={editItems}
                    />
                  </SidebarMenuItem>
                )
              })
            )}
          </SidebarMenu>
        )}
      </SidebarGroup>

      {dialogOpen && (
        <EntityDefinitionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editingEntity={editingEntity}
        />
      )}

      <ConfirmDialog />
    </>
  )
}
