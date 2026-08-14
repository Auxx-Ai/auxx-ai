// apps/web/src/components/records/ui/record-identity-header.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import {
  type FieldOptions,
  formatToDisplayValue,
  isValueEmpty,
} from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/lib/resources/client'
import { Badge } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { formatUrlForDisplay, normalizeUrl } from '@auxx/utils'
import { formatDistanceToNow } from 'date-fns'
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react'
import { DisplayField } from '~/components/fields/displays/display-field'
import { FieldInput } from '~/components/fields/field-input'
import { useFieldPopoverCoordination } from '~/components/fields/hooks/use-field-popover-coordination'
import { getInputComponentForFieldType } from '~/components/fields/inputs/get-input-component'
import { PropertyProvider, usePropertyContext } from '~/components/fields/property-provider'
import type { PanelField } from '~/components/fields/rows/types'
import { useFieldPopoverHandlers } from '~/components/fields/use-field-popover-handlers'
import { getEditModeForFieldType } from '~/components/fields/utils/edit-mode'
import { AvatarUploadIcon } from '~/components/resources/ui/avatar-upload-icon'
import { RecordIcon } from '~/components/resources/ui/record-icon'
import { useRecordDisplayFields } from '../hooks/use-record-display-fields'

/**
 * Field types the header refuses to edit even when the capability allows it.
 *
 * `CALC` is computed — writing it is meaningless, and it is NOT reliably
 * read-only by capability (`CustomField.isUpdatable` defaults to `true` and
 * `getInputComponentForFieldType` has no `CALC` branch, so it would fall
 * through to a plain text input). The rest have panel-sized editors that do not
 * belong in a heading; the Details panel remains the place to edit them.
 */
const HEADER_NON_EDITABLE_FIELD_TYPES = new Set<string>([
  FieldType.CALC,
  FieldType.FILE,
  FieldType.JSON,
  FieldType.RICH_TEXT,
])

/**
 * The box every non-editing state renders into. Shared so the four states
 * (row fallback, hydrated value, empty placeholder, read-only) occupy the exact
 * same height and inset as each other AND as the inline editor — swapping
 * between them must never move the heading.
 */
const STATIC_VALUE_BOX = 'truncate min-w-0 px-1 min-h-[28px] flex items-center'

/**
 * A stronger hover tint than a field row gets, scoped to this header.
 *
 * The heading sits on the drawer's own surface rather than inside the panel's
 * card, where the panel's tint is too faint to read as "clickable". Applied by
 * retargeting `DisplayWrapper`'s `field-display-hover` slot instead of changing
 * its class, so every other field row keeps the original tint. `!` because the
 * override and the base rule have equal specificity — without it the winner
 * would depend on Tailwind's utility ordering.
 */
const HEADER_HOVER_TINT = cn(
  '[&:hover_[data-slot=field-display-hover]]:!bg-primary-100',
  'dark:[&:hover_[data-slot=field-display-hover]]:!bg-foreground/12'
)

/** Fold the header's own denylist into the field's existing read-only answer. */
function applyHeaderEditability(field: PanelField | null): PanelField | null {
  if (!field) return null
  if (field.readOnly) return field
  if (field.fieldType && HEADER_NON_EDITABLE_FIELD_TYPES.has(field.fieldType)) {
    return { ...field, readOnly: true }
  }
  return field
}

interface RecordIdentityHeaderProps {
  /** RecordId in format "entityDefinitionId:entityInstanceId" (aliases are normalized downstream) */
  recordId: RecordId
  /**
   * Read-only mode, computed by the host — every call site already resolves it
   * per row via `useRecordDrawerReadOnly`. Passed in rather than derived here so
   * a host can lock the header without the component second-guessing it.
   */
  readOnly?: boolean
  /** Rendered after the primary value (e.g. the connector source badge). */
  primaryAdornment?: ReactNode
  className?: string
}

/**
 * The identity block at the top of a record drawer / detail sidebar: avatar,
 * primary display value, secondary display value.
 *
 * Both text values are editable **in place** through `PropertyProvider` — the
 * same optimistic write path the Details panel and the table cells use — so a
 * rename here propagates to every other surface with no bespoke mutation. Text
 * -like types edit as an inline input, everything else opens the shared field
 * popover (a `NAME` primary field therefore gets the first/last name editor).
 *
 * Everything is derived from `recordId`; there is deliberately no `displayName`
 * prop, since passing one is how the three copies of this block drifted apart.
 */
export function RecordIdentityHeader({
  recordId,
  readOnly = false,
  primaryAdornment,
  className,
}: RecordIdentityHeaderProps) {
  const {
    record,
    isRecordLoading,
    avatar,
    primaryField,
    secondaryField,
    displayNameFallback,
    secondaryDisplayFallback,
    primaryHydrated,
    secondaryHydrated,
  } = useRecordDisplayFields(recordId, readOnly)

  // One-open-editor-at-a-time across the two values. Deliberately scoped to this
  // header: the Details panel below owns its own coordination instance, and both
  // close on outside click, which covers the cross-surface case.
  const { onOpenChange, registerClose, unregisterClose } = useFieldPopoverCoordination()

  const headerPrimaryField = useMemo(() => applyHeaderEditability(primaryField), [primaryField])
  const headerSecondaryField = useMemo(
    () => applyHeaderEditability(secondaryField),
    [secondaryField]
  )

  const createdAtText = useMemo(() => {
    const createdAt = record?.createdAt as string | Date | undefined
    if (!createdAt) return null
    return `Created ${formatDistanceToNow(new Date(createdAt), { addSuffix: true })}`
  }, [record?.createdAt])

  return (
    <div
      className={cn(
        'flex gap-3 py-2 px-3 flex-row items-center justify-start border-b',
        className
      )}>
      {avatar.upload ? (
        <AvatarUploadIcon
          recordId={recordId}
          avatarUrl={avatar.avatarUrl}
          avatarFieldId={avatar.upload.fieldId}
          avatarFieldOptions={avatar.upload.options}
          iconId={avatar.iconId}
          color={avatar.color}
        />
      ) : (
        <RecordIcon
          avatarUrl={avatar.avatarUrl}
          iconId={avatar.iconId}
          color={avatar.color}
          size='xl'
          inverse
        />
      )}

      <div className='flex flex-col align-start w-full min-w-0'>
        <div className='flex items-center gap-2 min-w-0'>
          <HeaderValue
            slot='primary'
            recordId={recordId}
            field={headerPrimaryField}
            fallback={displayNameFallback}
            useFallback={!primaryHydrated}
            emptyFallback={null}
            isRecordLoading={isRecordLoading}
            placeholder='Untitled'
            className='text-lg font-medium text-neutral-900 dark:text-neutral-400'
            editorClassName='[&_input]:!text-lg [&_textarea]:!text-lg [&_input]:!font-medium [&_textarea]:!font-medium'
            skeletonClassName='h-6 w-80'
            onOpenChange={onOpenChange}
            registerClose={registerClose}
            unregisterClose={unregisterClose}
          />
          {primaryAdornment}
        </div>

        <HeaderValue
          slot='secondary'
          recordId={recordId}
          field={headerSecondaryField}
          fallback={secondaryDisplayFallback ?? createdAtText}
          useFallback={!secondaryHydrated}
          emptyFallback={createdAtText}
          isRecordLoading={isRecordLoading}
          placeholder=''
          className='text-xs text-neutral-500'
          editorClassName='[&_input]:!text-xs [&_textarea]:!text-xs'
          skeletonClassName='h-4 w-40'
          onOpenChange={onOpenChange}
          registerClose={registerClose}
          unregisterClose={unregisterClose}
        />
      </div>
    </div>
  )
}

interface HeaderValueProps {
  slot: 'primary' | 'secondary'
  recordId: RecordId
  /** Null when the resource configures no display field for this slot. */
  field: PanelField | null
  /** Denormalized row value, shown while the field value is unhydrated. */
  fallback: string | null
  /** True while the field value has never been fetched. */
  useFallback: boolean
  /**
   * Static text for a hydrated-but-empty value, when a placeholder would be
   * worse than something informative — the secondary line keeps showing
   * `Created …` exactly as it does today rather than going blank.
   */
  emptyFallback: string | null
  isRecordLoading: boolean
  /** Shown when the value is genuinely empty; doubles as the edit target. */
  placeholder: string
  className?: string
  /** Overrides the input's own font size so the editor matches the heading. */
  editorClassName?: string
  skeletonClassName: string
  onOpenChange: (providerId: string, open: boolean) => void
  registerClose: (providerId: string, closeFn: () => void) => void
  unregisterClose: (providerId: string) => void
}

/**
 * One line of the header. Without a configured display field there is nothing to
 * write to, so it degrades to static text rather than inventing a target.
 */
function HeaderValue({
  slot,
  recordId,
  field,
  fallback,
  useFallback,
  emptyFallback,
  isRecordLoading,
  placeholder,
  className,
  editorClassName,
  skeletonClassName,
  onOpenChange,
  registerClose,
  unregisterClose,
}: HeaderValueProps) {
  if (!field) {
    if (isRecordLoading && !fallback) return <Skeleton className={skeletonClassName} />
    const text = fallback || placeholder
    if (!text) return null
    return <div className={cn('truncate min-w-0', className)}>{text}</div>
  }

  return (
    <PropertyProvider
      providerId={`record-header-${slot}`}
      field={field}
      loading={false}
      recordId={recordId}
      readOnly={field.readOnly}
      showTitle={false}
      onOpenChange={onOpenChange}
      registerClose={registerClose}
      unregisterClose={unregisterClose}>
      <HeaderValueInner
        fallback={fallback}
        useFallback={useFallback}
        emptyFallback={emptyFallback}
        placeholder={placeholder}
        className={className}
        editorClassName={editorClassName}
        skeletonClassName={skeletonClassName}
      />
    </PropertyProvider>
  )
}

/**
 * Compact heading rendering for a multi-value field (options.multi): the
 * primary value plus a `+N` badge for the rest. The full list is the panel's
 * job; clicking the heading opens the popover picker.
 */
function HeaderMultiValue({
  values,
  fieldType,
  options,
}: {
  values: string[]
  fieldType?: string
  options?: FieldOptions
}) {
  const primary = values[0]!
  const rest = values.length - 1

  let display = primary
  if (fieldType === FieldType.PHONE_INTL) {
    display =
      (formatToDisplayValue({ type: 'text', value: primary }, 'PHONE_INTL', options ?? undefined) as
        | string
        | null) || primary
  } else if (fieldType === FieldType.URL) {
    const normalized = normalizeUrl(primary)
    display = normalized ? formatUrlForDisplay(normalized) : primary
  }

  return (
    <span className='flex min-w-0 items-center gap-1.5' data-slot='header-multi-value'>
      <span className='truncate min-w-0'>{display}</span>
      {rest > 0 && (
        <Badge variant='pill' className='shrink-0'>
          +{rest}
        </Badge>
      )}
    </span>
  )
}

/**
 * Value slot inside the provider: resolves the render states (row fallback,
 * skeleton, empty, value) and mounts the editor the field type calls for.
 */
function HeaderValueInner({
  fallback,
  useFallback,
  emptyFallback,
  placeholder,
  className,
  editorClassName,
  skeletonClassName,
}: {
  fallback: string | null
  useFallback: boolean
  emptyFallback: string | null
  placeholder: string
  className?: string
  editorClassName?: string
  skeletonClassName: string
}) {
  const { field, value, isLoading, isOpen, open, isOutsideClick } = usePropertyContext()

  // biome-ignore lint/correctness/useExhaustiveDependencies: isOutsideClick is a stable ref
  const handleClick = useCallback(() => {
    if (field.readOnly || isLoading) return
    // Same dance as `PropertyRow`: the popover's own outside-click handler runs
    // on the document before this element's click and clears the flag — without
    // it, clicking an open value would close and immediately reopen it.
    if (!isOpen && isOutsideClick.current) open()
    isOutsideClick.current = false
  }, [field.readOnly, isLoading, isOpen, open])

  // biome-ignore lint/correctness/useExhaustiveDependencies: isOutsideClick is a stable ref
  const handlePointerDown = useCallback(() => {
    if (isLoading) return
    isOutsideClick.current = true
  }, [isLoading])

  // The record row already knows the name; show it until the field value lands
  // so the header never flashes a placeholder on open. Not interactive in this
  // window — opening an editor over an unfetched value risks committing a blank.
  if (useFallback && fallback) {
    return <div className={cn(STATIC_VALUE_BOX, className)}>{fallback}</div>
  }

  if (isLoading) return <Skeleton className={skeletonClassName} />

  const isEmpty = isValueEmpty(value, field.fieldType)

  // Hydrated and empty, with nothing worth offering as an edit target.
  if (isEmpty && !placeholder) {
    if (!emptyFallback) return null
    return <div className={cn(STATIC_VALUE_BOX, className)}>{emptyFallback}</div>
  }

  // Multi-value fields (options.multi) compress to primary + `+N` in the
  // heading — the full list lives in the panel, and editing routes to the
  // popover picker (getEditModeForFieldType answers 'popover' for multi).
  const multiValues =
    field.options?.multi && Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string' && v !== '')
      : null

  const content = isEmpty ? (
    <div
      className={cn(
        'rounded-md px-1 min-h-[28px] flex items-center text-neutral-300 dark:text-foreground/40',
        // Mirrors `EmptyField` in the panel: the placeholder IS the edit target,
        // so it has to advertise itself on hover the way a real value does.
        'group-hover/property-row:bg-neutral-200 group-hover/property-row:dark:bg-foreground/12'
      )}>
      {placeholder}
    </div>
  ) : multiValues && multiValues.length > 0 ? (
    <HeaderMultiValue values={multiValues} fieldType={field.fieldType} options={field.options} />
  ) : (
    <DisplayField />
  )

  if (field.readOnly) {
    return <div className={cn(STATIC_VALUE_BOX, className)}>{content}</div>
  }

  const editMode = getEditModeForFieldType(field.fieldType, field.options)

  return (
    // `group/property-row` is what `DisplayWrapper` keys its hover background and
    // copy button off — without it the value renders but never looks editable.
    <div
      className={cn(
        'group/property-row flex min-w-0 flex-1 cursor-pointer',
        HEADER_HOVER_TINT,
        className
      )}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      data-slot='record-header-value'>
      {editMode === 'inline' ? (
        <InlineHeaderEditor editorClassName={editorClassName}>{content}</InlineHeaderEditor>
      ) : (
        <FieldInput>{content}</FieldInput>
      )}
    </div>
  )
}

/**
 * Inline editing for text-like types: the input replaces the value in the
 * heading itself instead of dropping a popover over it.
 *
 * `dynamic-table`'s `InlineCellEditor` does the same job but is bound to the
 * table's cell-indexer/selection contexts and to "Enter advances one row", so
 * this re-implements the shell around the same shared pieces
 * (`getInputComponentForFieldType`, `useFieldPopoverHandlers`) rather than
 * dragging table context into a drawer. It deliberately does not provide
 * `useIsInlineEditor`, whose `autoWidth` is right for a cell and wrong for a
 * heading that should fill its column.
 */
function InlineHeaderEditor({
  children,
  editorClassName,
}: {
  children: ReactNode
  editorClassName?: string
}) {
  const { field, isOpen } = usePropertyContext()
  const { handleOutsideEvent, handleEscapeKey } = useFieldPopoverHandlers()
  const containerRef = useRef<HTMLDivElement>(null)

  // Latest-callback ref so the document listeners survive the re-renders that
  // committing a value triggers, instead of tearing down mid-event.
  const handlersRef = useRef({ handleOutsideEvent, handleEscapeKey })
  handlersRef.current = { handleOutsideEvent, handleEscapeKey }

  useEffect(() => {
    if (!isOpen) return

    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current || containerRef.current.contains(e.target as Node)) return
      // Blur first so inputs that only commit their parsed value on blur
      // (currency) get their chance before `commitAndClose` reads the value.
      const active = document.activeElement
      if (active instanceof HTMLElement && containerRef.current.contains(active)) active.blur()
      handlersRef.current.handleOutsideEvent()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      handlersRef.current.handleEscapeKey()
    }

    // Capture phase, matching Radix's dismissable-layer pattern, so a descendant
    // that stops propagation cannot strand the editor open.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  if (!isOpen) return <>{children}</>

  return (
    <div
      ref={containerRef}
      className={cn(
        // Same box as `STATIC_VALUE_BOX`, so opening the editor swaps the
        // content without moving it.
        'flex w-full min-w-0 items-center min-h-[28px] rounded-md bg-background',
        // `ring-1` marks the field as being edited. A ring paints outside the
        // border box, so it adds no height of its own.
        'ring-1 ring-blue-500',
        // The inputs carry editor-shaped padding (`px-2 py-1`) and a hardcoded
        // `text-sm`. Both differ from the display's, and the difference IS the
        // jump — a descendant selector outranks the single class on the element,
        // so normalize both here.
        //
        // `py-[2px]` is not arbitrary: it mirrors `DisplayWrapper`'s value slot
        // exactly. That padding is what makes the display box `lineHeight + 4`,
        // which OVERSHOOTS `min-h-[28px]` at heading sizes (text-lg's 28px line
        // box renders 32px tall). Matching it is what keeps both boxes equal at
        // every font size, instead of only at the sizes where the floor binds.
        '[&_textarea]:!px-1 [&_textarea]:!py-[2px] [&_input]:!px-1 [&_input]:!py-[2px]',
        // NUMBER/CURRENCY render an InputGroup that pins its own height
        // (`h-[27px]`, over a `h-8` default). Let the padded control size it
        // instead, so it follows the same rule as the bare inputs.
        '[&_[data-slot=input-group]]:!h-auto [&_[data-slot=input-group]]:!border-0',
        editorClassName
      )}>
      {getInputComponentForFieldType(field.fieldType)}
    </div>
  )
}
