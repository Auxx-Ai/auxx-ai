// apps/web/src/app/(protected)/app/settings/custom-fields/[model]/page.tsx
'use client'

import SettingsPage from '~/components/global/settings-page'
import { useUser } from '~/hooks/use-user'
import { useParams } from 'next/navigation'
import { titleize } from '@auxx/lib/utils'
import { CustomFieldsList } from '~/components/custom-fields/ui/custom-fields-list'
import { ModelTypes, type ModelType } from '@auxx/lib/resources/client'
import { api } from '~/trpc/react'
import { Spinner } from '@auxx/ui/components/spinner'

/** Check if a string is a valid system ModelType */
function isSystemModel(model: string): model is ModelType {
  return Object.values(ModelTypes).includes(model as ModelType)
}

function ModelFieldsPage() {
  const params = useParams()
  const model = params.model as string

  // Check if it's a system model
  const isSystem = isSystemModel(model)

  // For custom entities, fetch the definition by slug
  const {
    data: entityDefinition,
    isLoading,
    error,
  } = api.entityDefinition.getBySlug.useQuery({ slug: model }, { enabled: !isSystem })

  useUser({
    requireOrganization: true,
    requireRoles: ['ADMIN', 'OWNER'],
  })

  // Determine title based on system model or entity definition
  const title = isSystem
    ? titleize(model)
    : entityDefinition?.singular || 'Loading...'

  // Build the resource ID for relationship field editor
  const currentResourceId = isSystem
    ? model
    : entityDefinition
      ? entityDefinition.id
      : undefined

  // Show loading state for custom entities
  if (!isSystem && isLoading) {
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
  if (!isSystem && error) {
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
          <p>The entity definition "{model}" could not be found.</p>
        </div>
      </SettingsPage>
    )
  }

  return (
    <SettingsPage
      title={`${title} Fields`}
      description="Customize fields to fit your company's needs."
      breadcrumbs={[
        { title: 'Settings', href: '/app/settings' },
        { title: 'Custom Fields', href: '/app/settings/custom-fields' },
        { title: title || '' },
      ]}>
      <CustomFieldsList
        modelType={isSystem ? (model as ModelType) : ModelTypes.ENTITY}
        entityDefinitionId={isSystem ? undefined : entityDefinition?.id}
        currentResourceId={currentResourceId}
      />
    </SettingsPage>
  )
}

export default ModelFieldsPage
