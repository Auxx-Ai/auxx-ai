// apps/web/src/components/agents/ui/detail/bindings/binding-var-picker.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { VarRef } from '@auxx/lib/agents/bindings/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import {
  type FieldReference,
  isFieldPath,
  parseResourceFieldId,
  type ResourceFieldId,
  toAppFieldRef,
  toResourceFieldId,
} from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandBreadcrumb,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandNavigation,
  CommandSeparator,
  type NavigationItem,
  useCommandNavigation,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { FieldPickerNavigationItem } from '~/components/pickers/field-picker'
import { FieldPickerInnerContent } from '~/components/pickers/field-picker'
import { useResourceProperty } from '~/components/resources'
import { FieldBadge } from '~/components/resources/ui/field-badge'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import { isVarFieldTypeCompatible } from '~/lib/agents/bindings/arg-to-field-type'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { useBindingRefBadgeKey, useBindingRefLabel } from './hooks/use-binding-ref-label'

interface BindingVarPickerProps {
  /** Currently-bound field ref (`{ kind:'var' }.ref` — single segment or FieldPath). */
  value?: string | string[]
  onChange: (ref: VarRef) => void
  /**
   * The input's mapped platform FieldType — only type-compatible fields are
   * offered. Pass undefined to offer all.
   */
  argFieldType?: string
  disabled?: boolean
}

/** First-stack frame for a chat-subject anchor (Contact / Thread). */
interface AnchorNavigationItem extends NavigationItem {
  id: string
  label: string
  /** The anchor entity-type slug — also the entity the field picker drills into. */
  anchor: string
}

type BindingNavItem = AnchorNavigationItem | FieldPickerNavigationItem

/** Drillable anchors a chat subject provides. Participant has no entity definition — self only. */
const DRILLABLE_ANCHORS = ['contact', 'thread'] as const

/**
 * Stacked-Command picker over the bindable subject fields. First stack lists
 * the chat anchors (Contact / Participant ID / Thread); drilling into an anchor
 * reuses `FieldPickerInnerContent` (resource-store fields, relationship
 * drill-down), so bindings can target nested values as `FieldPath` refs.
 * App-owned fields are emitted as their late-bound `@app:<slug>:<key>` ref.
 * See plans/chat/v9/binding-field-picker.md.
 */
export function BindingVarPicker({
  value,
  onChange,
  argFieldType,
  disabled,
}: BindingVarPickerProps) {
  const [open, setOpen] = useState(false)
  const refLabel = useBindingRefLabel()
  const toBadgeKey = useBindingRefBadgeKey()
  const badgeKey = value ? toBadgeKey(value) : null
  const rootEntity = value
    ? parseResourceFieldId((Array.isArray(value) ? value[0]! : value) as ResourceFieldId)
        .entityDefinitionId
    : ''

  const handleSelect = (ref: VarRef) => {
    onChange(ref)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={disabled}
          className='h-8 w-full justify-between px-2 font-normal'>
          {value ? (
            badgeKey ? (
              <FieldBadge id={badgeKey} entityDefinitionId={rootEntity} />
            ) : (
              // `self` refs aren't real fields — same badge shell, entity icon + label.
              <SelfRefBadge rootEntity={rootEntity} label={refLabel(value)} />
            )
          ) : (
            <span className='text-muted-foreground'>Select a dynamic value…</span>
          )}
          <ChevronDown className='size-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-72 p-0' align='start'>
        <CommandNavigation<BindingNavItem>>
          <BindingVarPickerContent argFieldType={argFieldType} onSelect={handleSelect} />
        </CommandNavigation>
      </PopoverContent>
    </Popover>
  )
}

interface BindingVarPickerContentProps {
  argFieldType?: string
  onSelect: (ref: VarRef) => void
}

function BindingVarPickerContent({ argFieldType, onSelect }: BindingVarPickerContentProps) {
  const { stack, push, pop, isAtRoot } = useCommandNavigation<BindingNavItem>()
  const [rootSearch, setRootSearch] = useState('')

  const installed = api.apps.listInstalled.useQuery({}, { staleTime: ORG_STATIC_STALE_TIME })
  const slugByInstallationId = useMemo(() => {
    const map = new Map<string, string>()
    for (const i of installed.data?.installations ?? []) {
      map.set(i.installationId, i.app.slug)
    }
    return map
  }, [installed.data])

  // First frame is always an anchor; deeper frames are field-picker drill-downs.
  const first = stack[0]
  const anchorFrame = first && 'anchor' in first ? (first as AnchorNavigationItem) : null
  const fieldStack = useMemo(
    () => stack.slice(1).filter((f): f is FieldPickerNavigationItem => 'resourceFieldId' in f),
    [stack]
  )
  const fieldCurrent = fieldStack.length > 0 ? fieldStack[fieldStack.length - 1]! : null

  const externalNavigation = useMemo(
    () => ({
      push: (item: FieldPickerNavigationItem) => push(item),
      pop,
      stack: fieldStack,
      current: fieldCurrent,
      isAtRoot: fieldStack.length === 0,
    }),
    [push, pop, fieldStack, fieldCurrent]
  )

  // A `self` ref resolves to the anchor's record id — TEXT-ish.
  const selfCompatible = !argFieldType || isVarFieldTypeCompatible(argFieldType, FieldType.TEXT)

  // Hide non-app hidden fields; keep relationships for drill-down; otherwise
  // require type compatibility with the bound arg. App-owned fields stay even
  // when hidden — they're binding targets by design (e.g. Shopify customerId).
  const filterField = useCallback(
    (field: ResourceField) => {
      if (field.capabilities?.hidden && !field.isAppOwned) return false
      if (field.relationship) return true
      if (
        argFieldType &&
        !isVarFieldTypeCompatible(argFieldType, field.fieldType ?? FieldType.TEXT)
      )
        return false
      return true
    },
    [argFieldType]
  )

  // App-owned terminal fields are rewritten to the connection-late-bound
  // `@app:<slug>:<key>` segment form (resolved per bound store at turn time).
  const handleFieldSelect = useCallback(
    (fieldReference: FieldReference, field: ResourceField) => {
      const segments: ResourceFieldId[] = isFieldPath(fieldReference)
        ? [...fieldReference]
        : [fieldReference as ResourceFieldId]
      if (field.isAppOwned && field.appFieldKey && field.appInstallationId) {
        const slug = slugByInstallationId.get(field.appInstallationId)
        if (slug) {
          const terminal = segments[segments.length - 1]!
          const { entityDefinitionId } = parseResourceFieldId(terminal)
          segments[segments.length - 1] = toAppFieldRef(entityDefinitionId, slug, field.appFieldKey)
        }
      }
      onSelect(segments.length === 1 ? segments[0]! : segments)
    },
    [slugByInstallationId, onSelect]
  )

  // Back-navigation: Escape / Backspace / ArrowLeft (with empty search) pop one
  // level. At root, Escape falls through and closes the popover.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isAtRoot) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        pop()
        return
      }
      const inputValue = (e.target as HTMLInputElement | null)?.value ?? ''
      if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && !inputValue) {
        e.preventDefault()
        pop()
      }
    },
    [isAtRoot, pop]
  )

  return (
    <Command shouldFilter={false} onKeyDown={handleKeyDown}>
      <CommandBreadcrumb rootLabel='Dynamic value' />
      {isAtRoot ? (
        <>
          <CommandInput
            placeholder='Search…'
            value={rootSearch}
            onValueChange={setRootSearch}
            autoFocus
          />
          <CommandList>
            <CommandEmpty>No matching values</CommandEmpty>
            <CommandGroup>
              {DRILLABLE_ANCHORS.map((anchor) => (
                <AnchorItem
                  key={anchor}
                  anchor={anchor}
                  search={rootSearch}
                  onDrill={(item) => {
                    push(item)
                    setRootSearch('')
                  }}
                />
              ))}
              {selfCompatible && matchesSearch('Participant ID', rootSearch) && (
                <CommandItem
                  value='participant:self'
                  onSelect={() => onSelect(toResourceFieldId('participant', 'self'))}>
                  <EntityIcon iconId='user' size='xs' className='text-muted-foreground' />
                  <span>Participant ID</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </>
      ) : anchorFrame ? (
        <FieldPickerInnerContent
          entityDefinitionId={anchorFrame.anchor}
          mode='single'
          closeOnSelect={false}
          onSelect={handleFieldSelect}
          filterField={filterField}
          searchPlaceholder='Search fields...'
          externalNavigation={externalNavigation}
          renderHeaderContent={(search) =>
            fieldStack.length === 0 && selfCompatible ? (
              <AnchorSelfRow anchorFrame={anchorFrame} search={search} onSelect={onSelect} />
            ) : null
          }
        />
      ) : null}
    </Command>
  )
}

/** Case-insensitive substring match for the root list's manual search filter. */
function matchesSearch(label: string, search: string): boolean {
  return !search || label.toLowerCase().includes(search.toLowerCase())
}

/** Root-stack row for a drillable anchor — label/icon from the resource store. */
function AnchorItem({
  anchor,
  search,
  onDrill,
}: {
  anchor: string
  search: string
  onDrill: (item: AnchorNavigationItem) => void
}) {
  const entityProps = useResourceProperty(anchor, ['label', 'icon', 'color'])
  const label = entityProps?.label ?? anchor
  if (!matchesSearch(label, search)) return null
  return (
    <CommandItem
      value={anchor}
      onSelect={() => onDrill({ id: `anchor:${anchor}`, label, anchor })}
      className='flex items-center justify-between'>
      <div className='flex items-center gap-2'>
        <EntityIcon iconId={entityProps?.icon ?? 'circle'} color={entityProps?.color} size='xs' />
        <span>{label}</span>
      </div>
      <ChevronRight className='size-4 opacity-50' />
    </CommandItem>
  )
}

/**
 * Trigger badge for a bound `self` ref — not a real field, so `FieldBadge`
 * can't resolve it. Same `recordBadgeVariants` shell, entity icon + label.
 */
function SelfRefBadge({ rootEntity, label }: { rootEntity: string; label: string }) {
  const entityProps = useResourceProperty(rootEntity, ['icon', 'color'])
  return (
    <span data-slot='field-badge' className={cn(recordBadgeVariants({}), 'font-normal')}>
      <EntityIcon iconId={entityProps?.icon ?? 'circle'} color={entityProps?.color} size='xs' />
      <span className='truncate'>{label}</span>
    </span>
  )
}

/** "<Anchor> ID" row at the top of a drilled anchor — binds `<anchor>:self`. */
function AnchorSelfRow({
  anchorFrame,
  search,
  onSelect,
}: {
  anchorFrame: AnchorNavigationItem
  search: string
  onSelect: (ref: VarRef) => void
}) {
  const entityProps = useResourceProperty(anchorFrame.anchor, ['icon', 'color'])
  const selfLabel = `${anchorFrame.label} ID`
  if (!matchesSearch(selfLabel, search)) return null
  return (
    <>
      <CommandGroup>
        <CommandItem
          value={`${anchorFrame.anchor}:self`}
          onSelect={() => onSelect(toResourceFieldId(anchorFrame.anchor, 'self'))}>
          <EntityIcon iconId={entityProps?.icon ?? 'circle'} color={entityProps?.color} size='xs' />
          <span>{selfLabel}</span>
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />
    </>
  )
}
