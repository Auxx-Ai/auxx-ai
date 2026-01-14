// apps/web/src/app/(protected)/app/settings/custom-fields/[apiSlug]/page.tsx
'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import SettingsPage from '~/components/global/settings-page'
import { useUser } from '~/hooks/use-user'
import { CustomFieldsList } from '~/components/custom-fields/ui/custom-fields-list'
import { Button } from '@auxx/ui/components/button'
import { EntityDefinitionDialog } from '~/components/custom-fields/ui/entity-definition-dialog'
import { EntityAppearanceEditor } from '~/components/custom-fields/ui/entity-appearance-editor'
import { Spinner } from '@auxx/ui/components/spinner'
import { useResource } from '~/components/resources/hooks'

function CustomFieldsDetailPage() {
  const params = useParams()
  const apiSlug = params.apiSlug as string

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)

  // Get resource from unified registry (handles both system and custom)
  const { resource, isLoading } = useResource(apiSlug)

  useUser({
    requireOrganization: true,
    requireRoles: ['ADMIN', 'OWNER'],
  })

  // Show loading state
  if (isLoading) {
    return (
      <SettingsPage
        title="Loading..."
        description="Loading entity definition..."
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Custom Fields', href: '/app/settings/custom-fields' },
          { title: 'Loading...' },
        ]}>
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      </SettingsPage>
    )
  }

  // Show error state
  if (!resource) {
    return (
      <SettingsPage
        title="Entity Not Found"
        description="The requested entity definition was not found."
        breadcrumbs={[
          { title: 'Settings', href: '/app/settings' },
          { title: 'Custom Fields', href: '/app/settings/custom-fields' },
          { title: 'Not Found' },
        ]}>
        <div className="text-center py-12 text-muted-foreground">
          <p>The entity "{apiSlug}" could not be found.</p>
        </div>
      </SettingsPage>
    )
  }

  // Prepare entity for dialog (custom entities only)
  const entityForDialog =
    resource.type === 'custom'
      ? {
          id: resource.entityDefinitionId,
          apiSlug: resource.apiSlug,
          icon: resource.icon,
          color: resource.color,
          singular: resource.label,
          plural: resource.plural,
          primaryDisplayFieldId: resource.display.primaryDisplayField?.id ?? null,
          secondaryDisplayFieldId: resource.display.secondaryDisplayField?.id ?? null,
          avatarFieldId: resource.display.avatarField?.id ?? null,
        }
      : null

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
          resource.type === 'custom' ? (
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              Edit Entity
            </Button>
          ) : undefined
        }>
        {/* Appearance editor - show for all, disable for system */}
        <EntityAppearanceEditor resource={resource} disabled={resource.type === 'system'} />

        {/* Custom fields list */}
        <CustomFieldsList resource={resource} />
      </SettingsPage>

      {/* Edit entity definition dialog (custom only) */}
      {dialogOpen && entityForDialog && (
        <EntityDefinitionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          editingEntity={entityForDialog}
        />
      )}
    </>
  )
}

export default CustomFieldsDetailPage
