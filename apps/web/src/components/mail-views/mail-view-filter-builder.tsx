// apps/web/src/components/mail-views/mail-view-filter-builder.tsx
'use client'

import { MAIL_VIEW_FIELD_DEFINITIONS } from '@auxx/lib/mail-views/client'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { AlertCircle } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useFormContext } from 'react-hook-form'
import {
  type Condition,
  ConditionContainer,
  type ConditionGroup,
  ConditionProvider,
  type ConditionSystemConfig,
} from '~/components/conditions'
import type { MailViewFormValues } from './mail-view-dialog'

/**
 * Component for building the filter logic for a mail view.
 * Uses the unified ConditionProvider system for consistent UX.
 */
export function MailViewFilterBuilder() {
  const { watch, setValue } = useFormContext<MailViewFormValues>()

  // Watch the filter groups from form state
  const filterGroups = watch('filterGroups') as ConditionGroup[] | undefined

  const fieldDefinitions = MAIL_VIEW_FIELD_DEFINITIONS

  // Condition system config for mail view filters
  const config: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource',
      fields: fieldDefinitions,

      // Enable grouping for complex filter logic
      showGrouping: true,
      allowNesting: false, // Single level of nesting only
      allowReordering: false,

      // Standard settings
      showLogicalOperators: true,
      allowGroupNaming: false,
      allowGroupCollapse: true,
      allowGroupReordering: false,
      showGroupSubtext: false,
      showGroupName: false,
      defaultGroupName: '',

      // No variable mode for mail views
      allowVarEditor: false,
      allowConstantToggle: false,
      allowCurrentUserPlaceholder: true,
      display: 'inline',
    }),
    [fieldDefinitions]
  )

  // Extract flat conditions from all groups for the provider
  const allConditions = useMemo(() => {
    if (!filterGroups || !Array.isArray(filterGroups)) return []
    return filterGroups.flatMap((group) => group.conditions || [])
  }, [filterGroups])

  // Handle conditions change - update form state
  const handleConditionsChange = useCallback(
    (conditions: Condition[]) => {
      // When conditions change at the flat level, we need to update the groups
      // For simplicity, put all conditions in a single group if no groups exist
      const currentGroups = filterGroups || []

      if (currentGroups.length === 0) {
        // Create a default group with the conditions
        setValue(
          'filterGroups',
          [
            {
              id: 'default',
              conditions,
              logicalOperator: 'AND',
            },
          ],
          { shouldDirty: true }
        )
      } else {
        // Update the first group's conditions
        const updatedGroups = [...currentGroups]
        if (updatedGroups[0]) {
          updatedGroups[0] = {
            ...updatedGroups[0],
            conditions,
          }
        }
        setValue('filterGroups', updatedGroups, { shouldDirty: true })
      }
    },
    [filterGroups, setValue]
  )

  // Handle groups change - update form state directly
  const handleGroupsChange = useCallback(
    (groups: ConditionGroup[]) => {
      setValue('filterGroups', groups, { shouldDirty: true })
    },
    [setValue]
  )

  // Field resolution functions
  const getAvailableFields = useCallback(() => fieldDefinitions, [fieldDefinitions])

  const getFieldDefinition = useCallback(
    (fieldId: string) => fieldDefinitions.find((f) => f.id === fieldId),
    [fieldDefinitions]
  )

  // Ensure filterGroups is initialized
  const normalizedGroups = useMemo(() => {
    if (!filterGroups || !Array.isArray(filterGroups)) {
      return [{ id: 'default', conditions: [], logicalOperator: 'AND' as const }]
    }
    return filterGroups
  }, [filterGroups])

  // Validate that we have valid filter groups
  if (!filterGroups && filterGroups !== undefined) {
    return (
      <Alert variant='destructive'>
        <AlertCircle />
        <AlertDescription>Filter data is missing or invalid.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className='space-y-4'>
      <ConditionProvider
        conditions={allConditions}
        groups={normalizedGroups}
        config={config}
        onConditionsChange={handleConditionsChange}
        onGroupsChange={handleGroupsChange}
        getAvailableFields={getAvailableFields}
        getFieldDefinition={getFieldDefinition}>
        <ConditionContainer
          emptyStateText='No filters added yet. Add conditions to filter threads.'
          showAddButton
          showGrouping
        />
      </ConditionProvider>
    </div>
  )
}
