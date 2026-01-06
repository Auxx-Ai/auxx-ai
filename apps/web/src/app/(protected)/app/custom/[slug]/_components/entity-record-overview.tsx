// apps/web/src/app/(protected)/app/custom/[slug]/_components/entity-record-overview.tsx
'use client'

import EntityFields from '~/components/fields/entity-fields'
import { ModelTypes } from '@auxx/types/custom-field'
import { useEntityRecords } from '~/components/custom-fields/context/entity-records-context'

/** Pre-loaded field value from entity instance */
interface PreloadedFieldValue {
  id: string
  fieldId: string
  value: unknown
}

/** Props for EntityRecordOverview */
interface EntityRecordOverviewProps {
  /** Entity instance ID */
  instanceId: string
  /** Pre-loaded values from table row */
  preloadedValues: PreloadedFieldValue[]
  /** Entity instance created timestamp */
  createdAt: string
  /** Entity instance updated timestamp */
  updatedAt: string
  /** Callback after successful mutation */
  onMutationSuccess?: () => void
}

/**
 * Overview tab content for entity record drawer
 * Renders custom fields using EntityFields component
 */
function EntityRecordOverview({
  instanceId,
  preloadedValues,
  createdAt,
  updatedAt,
  onMutationSuccess,
}: EntityRecordOverviewProps) {
  const { resource, entityDefinitionId, customFields } = useEntityRecords()

  if (!resource || !entityDefinitionId) return null
  console.log('EntityRecordOverview rendering for instanceId:', preloadedValues)
  return (
    <EntityFields
      modelType={ModelTypes.ENTITY}
      entityId={instanceId}
      entityDefinitionId={entityDefinitionId}
      preloadedValues={preloadedValues}
      preloadedFields={customFields}
      createdAt={createdAt}
      updatedAt={updatedAt}
      onMutationSuccess={onMutationSuccess}
      className=""
    />
  )
}

export default EntityRecordOverview
