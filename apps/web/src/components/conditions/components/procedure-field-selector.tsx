// apps/web/src/components/conditions/components/procedure-field-selector.tsx

'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import { type FieldReference, toFieldId } from '@auxx/types/field'
import {
  Command,
  CommandBreadcrumb,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
  CommandNavigation,
  CommandSeparator,
  type NavigationItem,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Variable } from 'lucide-react'
import { useMemo } from 'react'
import {
  FieldPickerInnerContent,
  type FieldPickerNavigationItem,
} from '~/components/pickers/field-picker'
import { useResourceProperty } from '~/components/resources'
import type { ConditionRootEntity, FieldDefinition } from '../types'
import { resourceFieldToFieldDef } from './field-def-helpers'

/** Top-level nav marker for an entity root (Contact, Thread, …) the user drilled into. */
interface EntityRootNavItem extends NavigationItem {
  id: string
  label: string
  kind: 'entity-root'
  entityDefinitionId: string
}

type ProcedureNavItem = EntityRootNavItem | FieldPickerNavigationItem

const isEntityRoot = (item: ProcedureNavItem | null): item is EntityRootNavItem =>
  !!item && 'kind' in item && item.kind === 'entity-root'

interface ProcedureFieldSelectorProps {
  /** Top-level entities the picker offers (e.g. Contact, Thread). */
  rootEntities: ConditionRootEntity[]
  /** Procedure-local `var:*` attributes — the "Temporary" group. */
  tempFields: FieldDefinition[]
  /** Called when the user selects a field (CRM `ResourceFieldId`/`FieldPath` or a `var:*`). */
  onSelect: (fieldReference: FieldReference, fieldDef: FieldDefinition) => void
  /** Accepted for API parity with the other selectors; the trigger button owns the disabled state. */
  disabled?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  renderTrigger: (props: { isOpen: boolean; onClick: () => void }) => React.ReactNode
}

/**
 * Multi-root field picker for procedure rules. Unlike `NavigableFieldSelector`
 * (single `entityDefinitionId`), the root level lists every {@link ConditionRootEntity}
 * — Contact, Thread — plus a "Temporary" group of `var:*` locals, and drilling into an
 * entity delegates to the shared `FieldPickerInnerContent` (relationship drill-down +
 * search) via an external-navigation adapter, mirroring `add-column-stack.tsx`.
 *
 * Selecting a CRM field emits its entity-scoped `ResourceFieldId` (`contact:email`) or a
 * `FieldPath` for a relationship hop — exactly the form the runtime resolver
 * (`agents/procedures/context.ts`) roots at a subject anchor.
 */
export function ProcedureFieldSelector({
  rootEntities,
  tempFields,
  onSelect,
  open,
  onOpenChange,
  renderTrigger,
}: ProcedureFieldSelectorProps) {
  const handlePick = (fieldReference: FieldReference, fieldDef: FieldDefinition) => {
    onSelect(fieldReference, fieldDef)
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        {renderTrigger({ isOpen: open, onClick: () => onOpenChange(!open) })}
      </PopoverTrigger>
      <PopoverContent className='min-w-[260px] p-0' align='start'>
        <CommandNavigation<ProcedureNavItem>>
          <Command shouldFilter={false}>
            <CommandBreadcrumb rootLabel='Fields' />
            <ProcedureFieldContent
              rootEntities={rootEntities}
              tempFields={tempFields}
              onPick={handlePick}
            />
          </Command>
        </CommandNavigation>
      </PopoverContent>
    </Popover>
  )
}

interface ProcedureFieldContentProps {
  rootEntities: ConditionRootEntity[]
  tempFields: FieldDefinition[]
  onPick: (fieldReference: FieldReference, fieldDef: FieldDefinition) => void
}

/** Routes between the entity root list and the per-entity field picker on nav state. */
function ProcedureFieldContent({ rootEntities, tempFields, onPick }: ProcedureFieldContentProps) {
  const { stack, push, pop } = useCommandNavigation<ProcedureNavItem>()

  // The entity root sits at the bottom of the stack; relationship drills pile on top.
  const entityRoot = stack.find(isEntityRoot)

  // External-navigation adapter for FieldPickerInnerContent: it only sees the
  // relationship hops ABOVE the entity marker, so "at root" means the entity's own
  // fields (no relationship drilled). Popping past them removes the entity marker →
  // back to the entity list. Mirrors add-column-stack.tsx.
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

  if (entityRoot) {
    return (
      <FieldPickerInnerContent
        entityDefinitionId={entityRoot.entityDefinitionId}
        mode='single'
        closeOnSelect={false}
        onSelect={(fieldReference, field: ResourceField) =>
          onPick(fieldReference, resourceFieldToFieldDef(field, fieldReference))
        }
        searchPlaceholder='Search fields...'
        externalNavigation={externalNavigation}
      />
    )
  }

  return (
    <CommandList>
      <CommandGroup>
        {rootEntities.map((entity) => (
          <EntityRootItem
            key={entity.entityDefinitionId}
            entity={entity}
            onSelect={() =>
              push({
                id: entity.entityDefinitionId,
                kind: 'entity-root',
                label: entity.label,
                entityDefinitionId: entity.entityDefinitionId,
              })
            }
          />
        ))}
      </CommandGroup>

      {tempFields.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup>
            <CommandGroupLabel>Temporary</CommandGroupLabel>
            {tempFields.map((field) => (
              <CommandItem
                key={field.id}
                value={field.id}
                onSelect={() => onPick(toFieldId(field.id), field)}>
                <Variable className='size-4 text-accent-500' />
                <span>{field.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      )}
    </CommandList>
  )
}

/** Root-level entity row — its own component so each resolves its icon/color via the store. */
function EntityRootItem({
  entity,
  onSelect,
}: {
  entity: ConditionRootEntity
  onSelect: () => void
}) {
  const props = useResourceProperty(entity.entityDefinitionId, ['icon', 'color'])
  return (
    <CommandItem value={entity.entityDefinitionId} onSelect={onSelect}>
      <EntityIcon iconId={props?.icon ?? 'circle'} color={props?.color} size='xs' />
      <span>{entity.label}</span>
    </CommandItem>
  )
}
