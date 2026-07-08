// apps/web/src/components/dashboard/ui/config/filters-section.tsx
'use client'

// The widget filter builder (plan 07) — the shared ConditionProvider +
// ConditionContainer, wired exactly like `record-rule-configure-page.tsx`. The
// persisted shape IS the shared `ConditionGroup[]` (no UI-metadata conversion
// layer), stored on `config.filters` and merged into the aggregate/record query
// per source (plan 03). Field definitions come from the source's resource fields.

import type { ConditionGroup, WidgetSource } from '@auxx/lib/dashboards/client'
import { getFieldOperators } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { ListFilter, Plus } from 'lucide-react'
import { useMemo } from 'react'
import {
  type Condition,
  ConditionContainer,
  ConditionProvider,
  type ConditionSystemConfig,
  useConditionActions,
} from '~/components/conditions'
import { useResourceFields } from '~/components/resources'
import { sourceResourceId } from '../../lib/widget-source'

const EMPTY_CONDITIONS: Condition[] = []

export function FiltersSection({
  source,
  filters,
  onChange,
}: {
  source: WidgetSource
  filters: ConditionGroup[] | undefined
  onChange: (groups: ConditionGroup[]) => void
}) {
  const entityDefinitionId = sourceResourceId(source)
  const { fields } = useResourceFields(entityDefinitionId)

  const fieldDefinitions = useMemo(
    () =>
      fields.map((field) => ({
        id: field.resourceFieldId ?? String(field.id),
        label: field.label,
        type: field.type,
        fieldType: field.fieldType,
        fieldKey: field.key,
        operators: field.operatorOverrides || getFieldOperators(field),
        options: field.options,
      })),
    [fields]
  )

  const conditionConfig: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource',
      entityDefinitionId,
      fields: fieldDefinitions,
      allowNesting: false,
      allowReordering: true,
      showLogicalOperators: true,
      showGrouping: true,
      allowGroupNaming: false,
      allowGroupCollapse: false,
      allowGroupReordering: true,
      showGroupSubtext: false,
      allowVarEditor: false,
      allowConstantToggle: false,
      allowCurrentUserPlaceholder: true,
    }),
    [entityDefinitionId, fieldDefinitions]
  )

  return (
    <ConditionProvider
      conditions={EMPTY_CONDITIONS}
      groups={filters ?? []}
      config={conditionConfig}
      onConditionsChange={() => {}}
      onGroupsChange={onChange}
      getAvailableFields={() => fieldDefinitions}
      getFieldDefinition={(id) => fieldDefinitions.find((f) => f.id === id)}>
      <Section
        title='Filters'
        icon={<ListFilter className='size-4' />}
        collapsible
        actions={<AddGroupButton />}>
        <ConditionContainer emptyStateText='All records' showAddButton={false} showGrouping />
      </Section>
    </ConditionProvider>
  )
}

function AddGroupButton() {
  const { addGroup } = useConditionActions()
  if (!addGroup) return null
  return (
    <Button variant='ghost' size='xs' type='button' onClick={() => addGroup()}>
      <Plus />
      Add group
    </Button>
  )
}
