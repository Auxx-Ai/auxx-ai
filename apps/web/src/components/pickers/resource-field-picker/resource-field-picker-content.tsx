// apps/web/src/components/pickers/resource-field-picker/resource-field-picker-content.tsx

'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import {
  Command,
  CommandBreadcrumb,
  CommandNavigation,
  type NavigationItem,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { cn } from '@auxx/ui/lib/utils'
import { useMemo } from 'react'
import { useResources } from '~/components/resources/hooks/use-resources'
import { FieldPickerInnerContent, type FieldPickerNavigationItem } from '../field-picker'
import { ResourceCommandBody } from '../resource-picker'
import type { ResourceFieldPickerContentProps } from './types'

/** Bottom-of-stack marker for the resource the user drilled into. */
interface ResourceRootNavItem extends NavigationItem {
  id: string
  label: string
  kind: 'resource-root'
  entityDefinitionId: string
}

type ResourceFieldNavItem = ResourceRootNavItem | FieldPickerNavigationItem

const isResourceRoot = (item: ResourceFieldNavItem | null): item is ResourceRootNavItem =>
  !!item && 'kind' in item && item.kind === 'resource-root'

/** Stable empty array to avoid re-renders. */
const EMPTY_STRINGS: string[] = []

/**
 * ResourceFieldPickerContent — a single-stack picker that lists resources at the
 * root and, once a resource is chosen, delegates to the shared field picker
 * (relationship drill-down + search). The resource sits at the bottom of the
 * navigation stack as a breadcrumb segment; relationship hops pile on top,
 * giving one unified breadcrumb: `Resources › Contact › Company › …`.
 *
 * The trick that keeps `FieldPickerInnerContent` reuse zero-cost: it only ever
 * sees the stack entries that carry a `resourceFieldId` (the relationship hops),
 * so the resource marker is invisible to its field-path building. Popping past
 * the last hop removes the resource marker → back to the resource list. Mirrors
 * `conditions/procedure-field-selector.tsx`.
 */
export function ResourceFieldPickerContent({
  className,
  ...props
}: ResourceFieldPickerContentProps) {
  return (
    <CommandNavigation<ResourceFieldNavItem>>
      <Command shouldFilter={false} className={cn('rounded-lg', className)}>
        <CommandBreadcrumb rootLabel='Resources' />
        <ResourceFieldPickerInner {...props} />
      </Command>
    </CommandNavigation>
  )
}

function ResourceFieldPickerInner({
  value,
  onSelect,
  closeOnSelect = true,
  onClose,
  excludeFields,
  filterField,
  disableDrillDown,
  excludeResourceIds = EMPTY_STRINGS,
  includeSystem = true,
  includeCustom = true,
  entityDefinedOnly = false,
  resourceSearchPlaceholder = 'Search resources...',
  fieldSearchPlaceholder = 'Search fields...',
}: Omit<ResourceFieldPickerContentProps, 'className'>) {
  const { stack, push, pop } = useCommandNavigation<ResourceFieldNavItem>()
  const { getResourceById } = useResources()

  // The resource marker sits at the bottom of the stack; relationship drills pile on top.
  const resourceRoot = stack.find(isResourceRoot)

  // External-navigation adapter: FieldPickerInnerContent only sees the relationship
  // hops ABOVE the resource marker, so "at root" means the resource's own fields
  // (no relationship drilled). Popping past them removes the resource marker.
  const fieldStack = useMemo(
    () => stack.filter((i): i is FieldPickerNavigationItem => 'resourceFieldId' in i),
    [stack]
  )
  const externalNavigation = useMemo(
    () => ({
      push: (item: FieldPickerNavigationItem) => push(item),
      pop,
      stack: fieldStack,
      current: fieldStack[fieldStack.length - 1] ?? null,
      isAtRoot: fieldStack.length === 0,
    }),
    [push, pop, fieldStack]
  )

  const fieldReferences = useMemo(() => (value ? [value] : []), [value])

  if (resourceRoot) {
    return (
      <FieldPickerInnerContent
        entityDefinitionId={resourceRoot.entityDefinitionId}
        fieldReferences={fieldReferences}
        excludeFields={excludeFields}
        filterField={filterField}
        disableDrillDown={disableDrillDown}
        mode='single'
        closeOnSelect={closeOnSelect}
        onClose={onClose}
        onSelect={(fieldReference, field: ResourceField) => onSelect(fieldReference, field)}
        searchPlaceholder={fieldSearchPlaceholder}
        externalNavigation={externalNavigation}
      />
    )
  }

  // Root: resource list. Pushing a resource drills into its fields.
  return (
    <ResourceCommandBody
      value={EMPTY_STRINGS}
      onChange={() => {}}
      multi={false}
      onSelectSingle={(id) => {
        const resource = getResourceById(id)
        push({
          id,
          label: resource?.label ?? id,
          kind: 'resource-root',
          entityDefinitionId: id,
        })
      }}
      placeholder={resourceSearchPlaceholder}
      excludeIds={excludeResourceIds}
      includeSystem={includeSystem}
      includeCustom={includeCustom}
      entityDefinedOnly={entityDefinedOnly}
    />
  )
}
