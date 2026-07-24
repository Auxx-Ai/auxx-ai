// apps/web/src/app/(protected)/app/settings/custom-fields/[apiSlug]/page.tsx
'use client'

import { isAccessManageable } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Spinner } from '@auxx/ui/components/spinner'
import { useParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { CustomFieldsList } from '~/components/custom-fields/ui/custom-fields-list'
import { EntityAppearanceEditor } from '~/components/custom-fields/ui/entity-appearance-editor'
import { EntityDefinitionDialog } from '~/components/custom-fields/ui/entity-definition-dialog'
import SettingsPage from '~/components/global/settings-page'
import { DefAccessSection } from '~/components/permissions/ui/def-access-section'
import { useResource } from '~/components/resources/hooks'
import { useUser } from '~/hooks/use-user'
import { useAccess } from '~/providers/capabilities-provider'

function CustomFieldsDetailPage() {
  const params = useParams()
  const apiSlug = params.apiSlug as string

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  // Fields vs Permissions tab (Appearance stays visible above both). Held in the
  // URL so the permissions page can deep-link straight to `?tab=permissions`.
  const [tab, setTab] = useQueryState('tab', { defaultValue: 'fields' })

  // Get resource from unified registry (handles both system and custom)
  const { resource, isLoading } = useResource(apiSlug)
  // Managing a def's fields is def administration (the `Full`/`admin` rung) —
  // OWNER/ADMIN or a def-`admin` grantee (perms v2 doc 09). Gated per-def below
  // rather than via a blanket role guard; the server enforces regardless. The
  // **Permissions** (record access) tab is a further, OWNER/ADMIN-only step.
  const { isAdminOrOwner } = useUser({ requireOrganization: true })
  const { canAdministerDef } = useAccess()

  // Show loading state
  if (isLoading) {
    return (
      <SettingsPage
        title='Loading...'
        description='Loading entity definition...'
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Custom Fields', href: '/app/settings/custom-fields' },
          { title: 'Loading...' },
        ]}>
        <div className='flex items-center justify-center py-12'>
          <Spinner />
        </div>
      </SettingsPage>
    )
  }

  // Show error state
  if (!resource) {
    return (
      <SettingsPage
        title='Entity Not Found'
        description='The requested entity definition was not found.'
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Custom Fields', href: '/app/settings/custom-fields' },
          { title: 'Not Found' },
        ]}>
        <div className='text-center py-12 text-muted-foreground'>
          <p>The entity "{apiSlug}" could not be found.</p>
        </div>
      </SettingsPage>
    )
  }

  // Per-def administration gate — a member without def-`admin` on THIS def cannot
  // manage its fields/permissions (server enforces regardless).
  if (!canAdministerDef(resource.entityDefinitionId)) {
    return (
      <SettingsPage
        title='Access denied'
        description="You don't have permission to manage this entity's fields."
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Custom Fields', href: '/app/settings/custom-fields' },
          { title: resource.label },
        ]}>
        <div className='text-center py-12 text-muted-foreground'>
          <p>You need administration access to “{resource.label}” to manage its fields.</p>
        </div>
      </SettingsPage>
    )
  }

  return (
    <>
      <SettingsPage
        title={`${resource.label} Fields`}
        description="Customize fields to fit your company's needs."
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Custom Fields', href: '/app/settings/custom-fields' },
          { title: resource.label },
        ]}
        button={
          !resource.entityType ? (
            <Button variant='outline' size='sm' onClick={() => setDialogOpen(true)}>
              Edit Entity
            </Button>
          ) : undefined
        }>
        {/* Appearance editor - show for all, disable for system */}
        <EntityAppearanceEditor resource={resource} disabled={!!resource.entityType} />

        {/* Fields vs Permissions — Permissions tab only for in-scope CRM defs
            AND OWNER/ADMIN (record access stays admin-only; def-admins get Fields
            only). Server enforces the access mutations regardless. */}
        {isAccessManageable(resource) && isAdminOrOwner ? (
          <>
            <div className='px-3 pt-3 sm:px-6 pb-6'>
              <div className='w-56'>
                <RadioTab
                  value={tab === 'permissions' ? 'permissions' : 'fields'}
                  onValueChange={(v) => setTab(v)}
                  size='sm'
                  radioGroupClassName='w-full'>
                  <RadioTabItem value='fields'>Fields</RadioTabItem>
                  <RadioTabItem value='permissions'>Permissions</RadioTabItem>
                </RadioTab>
              </div>
            </div>
            {tab === 'permissions' ? (
              <DefAccessSection resource={resource} />
            ) : (
              <CustomFieldsList resource={resource} />
            )}
          </>
        ) : (
          <CustomFieldsList resource={resource} />
        )}
      </SettingsPage>

      {/* Edit entity definition dialog (custom only) */}
      {dialogOpen && !resource.entityType && (
        <EntityDefinitionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          entityDefinitionId={resource.entityDefinitionId}
        />
      )}
    </>
  )
}

export default CustomFieldsDetailPage
