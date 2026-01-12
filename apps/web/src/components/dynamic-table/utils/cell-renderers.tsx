// apps/web/src/components/dynamic-table/utils/cell-renderers.tsx

import { useMemo } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { formatCurrency, formatBytes, type CurrencyDisplayOptions } from '@auxx/utils'
import { CheckSquare, Paperclip } from 'lucide-react'
import { CopyableLinkCell } from '../components/copyable-link-cell'
import { CellPadding, type CellConfig } from '../components/formatted-cell'
import { TagsCellView } from '~/components/ui/tags-view'
import { ItemsCellView } from '~/components/ui/items-list-view'
import { ResourceBadge } from '~/components/resources/ui'
import {
  formatToRawValue,
  formatToDisplayValue,
  extractRelationshipResourceIds,
  getInstanceId,
  type NumberFieldOptions,
  type DateFieldOptions,
  type BooleanFieldOptions,
  type PhoneFieldOptions,
} from '@auxx/lib/field-values/client'
import type {
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  NumberColumnFormatting,
  PhoneColumnFormatting,
} from '../types'

/** Select option type for tags/select renderers */
type SelectOption = { label: string; value: string }

/**
 * Relationship cell content - displays related entities with display names.
 * Uses ResourceBadge component which handles its own data fetching and loading states.
 * Extracts relatedEntityDefinitionId from TypedFieldValue to determine resource type.
 * Standardized format:
 * - System resources: store model type string (e.g., "contact", "ticket")
 * - Custom entities: store UUID of EntityDefinition
 */
function RelationshipCellContent({ value }: { value: unknown }) {
  // Extract ResourceIds from value using centralized utility
  const resourceIds = useMemo(() => extractRelationshipResourceIds(value), [value])

  // Map resourceIds to simple items for ItemsCellView
  const items = resourceIds.map((resourceId) => ({
    id: getInstanceId(resourceId),
    resourceId, // Pass the full ResourceId to renderItem
  }))

  return (
    <ItemsCellView
      items={items}
      isLoading={false} // ResourceBadge handles individual loading states
      renderItem={(item) => <ResourceBadge resourceId={item.resourceId} link />}
    />
  )
}

/**
 * Cell renderer function type
 * Takes a value, optional formatting, and optional config, returns ReactNode
 */
type CellRenderer = (
  value: unknown,
  formatting?: ColumnFormatting,
  config?: CellConfig
) => React.ReactNode

/**
 * Empty state component for null/undefined/empty values
 * Includes CellPadding for consistent cell layout
 */
export function EmptyCell() {
  return (
    <CellPadding>
      <span className="text-muted-foreground">-</span>
    </CellPadding>
  )
}

/**
 * Render date value with optional formatting override.
 * Uses options from field.options (flat structure) as fallback when no column formatting is specified.
 */
export function renderDateValue(
  value: unknown,
  formatting?: DateColumnFormatting,
  config?: CellConfig
): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  try {
    const date = new Date(value as string | number)
    if (isNaN(date.getTime())) {
      return <CellPadding expandDirection="horizontal">{String(value)}</CellPadding>
    }

    const opts = config?.options as DateFieldOptions | undefined
    // Column formatting takes precedence over field.options
    const dateFormat = formatting?.format ?? opts?.format ?? 'medium'
    const includeTime = formatting?.includeTime ?? opts?.includeTime ?? false

    let formatted: string
    switch (dateFormat) {
      case 'short':
        formatted = format(date, includeTime ? 'M/d/yy h:mm a' : 'M/d/yy')
        break
      case 'medium':
        formatted = format(date, includeTime ? 'MMM d, yyyy h:mm a' : 'MMM d, yyyy')
        break
      case 'long':
        formatted = format(date, includeTime ? 'MMMM d, yyyy h:mm a' : 'MMMM d, yyyy')
        break
      case 'relative':
        formatted = formatDistanceToNow(date, { addSuffix: true })
        break
      case 'iso':
        formatted = format(date, includeTime ? "yyyy-MM-dd'T'HH:mm:ss" : 'yyyy-MM-dd')
        break
      default:
        formatted = format(date, 'MMM d, yyyy')
    }
    return <CellPadding expandDirection="horizontal">{formatted}</CellPadding>
  } catch {
    return <CellPadding expandDirection="horizontal">{String(value)}</CellPadding>
  }
}

/**
 * Render time-only value with optional timeFormat from field.options (flat structure)
 */
export function renderTimeValue(value: unknown, config?: CellConfig): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  try {
    const date = new Date(value as string | number)
    if (isNaN(date.getTime())) {
      return <CellPadding expandDirection="horizontal">{String(value)}</CellPadding>
    }
    const opts = config?.options as DateFieldOptions | undefined
    const timeFormat = opts?.timeFormat ?? '12h'
    const formatStr = timeFormat === '24h' ? 'HH:mm' : 'h:mm a'
    return <CellPadding expandDirection="horizontal">{format(date, formatStr)}</CellPadding>
  } catch {
    return <CellPadding expandDirection="horizontal">{String(value)}</CellPadding>
  }
}

/**
 * Render number value with optional formatting override.
 * Uses options from field.options (flat structure) as fallback when no column formatting is specified.
 */
export function renderNumberValue(
  value: unknown,
  formatting?: NumberColumnFormatting,
  config?: CellConfig
): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  const num = typeof value === 'number' ? value : parseFloat(value as string)
  if (isNaN(num)) {
    return (
      <CellPadding expandDirection="horizontal">
        <span className="font-mono">{String(value)}</span>
      </CellPadding>
    )
  }

  const opts = config?.options as NumberFieldOptions | undefined
  // Column formatting takes precedence over field.options
  const decimalPlaces = formatting?.decimalPlaces ?? opts?.decimals ?? 2
  const useGrouping = formatting?.useGrouping ?? opts?.useGrouping ?? true
  const displayAs = formatting?.displayAs ?? opts?.displayAs ?? 'number'
  const prefix = formatting?.prefix ?? opts?.prefix ?? ''
  const suffix = formatting?.suffix ?? opts?.suffix ?? ''

  let formatted: string

  switch (displayAs) {
    case 'percentage':
      formatted = new Intl.NumberFormat('en-US', {
        style: 'percent',
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }).format(num / 100)
      break
    case 'compact':
      formatted = new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(num)
      break
    case 'bytes':
      formatted = formatBytes(num, decimalPlaces)
      break
    default:
      formatted = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
        useGrouping,
      }).format(num)
  }

  return (
    <CellPadding expandDirection="horizontal">
      <span className="font-mono">
        {prefix}
        {formatted}
        {suffix}
      </span>
    </CellPadding>
  )
}

/**
 * Render currency value with optional formatting override
 */
export function renderCurrencyValue(
  value: unknown,
  formatting?: CurrencyColumnFormatting,
  config?: CellConfig
): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  const cents = typeof value === 'number' ? value : parseInt(value as string, 10)
  if (isNaN(cents)) return <EmptyCell />

  const fieldOptions = config?.currency
  const options: CurrencyDisplayOptions = {
    currencyCode: formatting?.currencyCode ?? fieldOptions?.currencyCode ?? 'USD',
    decimalPlaces: formatting?.decimalPlaces ?? fieldOptions?.decimalPlaces ?? 'two-places',
    displayType: formatting?.displayType ?? fieldOptions?.displayType ?? 'symbol',
    groups: formatting?.groups ?? fieldOptions?.groups ?? 'default',
  }

  const formatted = formatCurrency(cents, options)
  return (
    <CellPadding expandDirection="horizontal">
      <span className="font-mono">{formatted}</span>
    </CellPadding>
  )
}

/**
 * Render email value as copyable link
 */
export function renderEmailValue(value: unknown): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  const email = String(value)
  return (
    <CellPadding expandDirection="horizontal">
      <CopyableLinkCell displayText={email} value={email} type="email" />
    </CellPadding>
  )
}

/**
 * Render phone value as copyable link with formatted display.
 * Uses phoneFormat option from column formatting or field options.
 */
export function renderPhoneValue(
  value: unknown,
  formatting?: PhoneColumnFormatting,
  config?: CellConfig
): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  const phone = String(value)

  // Merge column formatting with field options (column takes precedence)
  const opts: PhoneFieldOptions = {
    ...(config?.options as PhoneFieldOptions | undefined),
    phoneFormat:
      formatting?.phoneFormat ?? (config?.options as PhoneFieldOptions | undefined)?.phoneFormat,
  }

  // Use converter for display formatting
  const formatted =
    (formatToDisplayValue({ type: 'text', value: phone }, 'PHONE_INTL', opts) as string) || phone

  return (
    <CellPadding expandDirection="horizontal">
      <CopyableLinkCell displayText={formatted} value={phone} type="phone" />
    </CellPadding>
  )
}

/**
 * Render URL value as copyable link
 */
export function renderUrlValue(value: unknown): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  const url = String(value)
  const href = url.startsWith('http') ? url : `https://${url}`
  return (
    <CellPadding expandDirection="horizontal">
      <CopyableLinkCell displayText={url} value={href} type="url" />
    </CellPadding>
  )
}

/**
 * Render checkbox/boolean value with options from field.options (flat structure)
 */
export function renderCheckboxValue(value: unknown, config?: CellConfig): React.ReactNode {
  const opts = config?.options as BooleanFieldOptions | undefined
  const checkboxStyle = opts?.checkboxStyle ?? 'icon-text'
  const trueLabel = opts?.trueLabel ?? 'True'
  const falseLabel = opts?.falseLabel ?? 'False'

  // Text-only display
  if (checkboxStyle === 'text') {
    return (
      <CellPadding expandDirection="horizontal">
        <span className="text-muted-foreground">{value ? trueLabel : falseLabel}</span>
      </CellPadding>
    )
  }

  // Icon-only display
  if (checkboxStyle === 'icon') {
    return (
      <CellPadding expandDirection="horizontal">
        {value ? (
          <CheckSquare className="size-4 text-green-600" />
        ) : (
          <div className="size-4 border rounded" />
        )}
      </CellPadding>
    )
  }

  // Icon with text display (default)
  return (
    <CellPadding expandDirection="horizontal">
      <div className="flex items-center gap-2">
        {value ? (
          <CheckSquare className="size-4 text-green-600" />
        ) : (
          <div className="size-4 border rounded" />
        )}
        <span className="text-muted-foreground">{value ? trueLabel : falseLabel}</span>
      </div>
    </CellPadding>
  )
}

/**
 * Render address value
 */
export function renderAddressValue(value: unknown): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  if (typeof value === 'object') {
    const addr = value as Record<string, string>
    const parts = [
      addr.street1,
      addr.street2,
      addr.city,
      addr.state,
      addr.postalCode,
      addr.country,
    ].filter(Boolean)
    if (parts.length === 0) return <EmptyCell />
    return (
      <CellPadding>
        <span className="text-sm">{parts.join(', ')}</span>
      </CellPadding>
    )
  }
  return (
    <CellPadding>
      <span className="text-sm">{String(value)}</span>
    </CellPadding>
  )
}

/**
 * Render rich text value (strips HTML for table display)
 */
export function renderRichTextValue(value: unknown): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  const textOnly = String(value).replace(/<[^>]*>/g, '')
  if (!textOnly.trim()) return <EmptyCell />

  return (
    <CellPadding>
      <span className="text-sm" title={textOnly}>
        {textOnly}
      </span>
    </CellPadding>
  )
}

/**
 * Render file value
 */
export function renderFileValue(value: unknown): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  if (typeof value !== 'object') {
    if (typeof value === 'string') {
      return (
        <CellPadding expandDirection="horizontal">
          <span className="text-sm">{value}</span>
        </CellPadding>
      )
    }
    return <EmptyCell />
  }

  const fileValue = value as Record<string, unknown>

  // Handle attachmentIds format (new format)
  if (fileValue.attachmentIds) {
    const ids = Array.isArray(fileValue.attachmentIds)
      ? fileValue.attachmentIds
      : [fileValue.attachmentIds]
    return (
      <CellPadding expandDirection="horizontal">
        <span className="text-muted-foreground flex items-center gap-1">
          <Paperclip className="size-3" />
          {ids.length} file{ids.length !== 1 ? 's' : ''}
        </span>
      </CellPadding>
    )
  }

  // Handle legacy format with name/url
  if (fileValue.name) {
    return (
      <CellPadding expandDirection="horizontal">
        <a
          href={fileValue.url as string}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline flex items-center gap-1">
          <Paperclip className="size-3" />
          {String(fileValue.name)}
        </a>
      </CellPadding>
    )
  }

  return <EmptyCell />
}

/**
 * Render plain text value.
 * Value is already extracted by unwrapValue() via formatToRawValue().
 */
export function renderTextValue(value: unknown): React.ReactNode {
  // Handle null/undefined
  if (value == null) {
    return <EmptyCell />
  }

  // Handle empty strings
  if (typeof value === 'string' && value.trim() === '') {
    return <EmptyCell />
  }

  // Handle objects - should be rare since unwrapValue extracts raw values
  if (typeof value === 'object') {
    // For non-primitive objects, show empty state
    return <EmptyCell />
  }

  // Render primitive values
  return (
    <CellPadding>
      <span className="text-sm">{String(value)}</span>
    </CellPadding>
  )
}

/**
 * Field type to renderer mapping
 * All renderers handle their own padding via CellPadding
 */
const cellRenderers: Record<string, CellRenderer> = {
  // Date types - pass config for displayOptions fallback
  DATE: (value, formatting, config) =>
    renderDateValue(value, formatting as DateColumnFormatting, config),
  DATETIME: (value, formatting, config) =>
    renderDateValue(value, { ...(formatting as DateColumnFormatting), includeTime: true }, config),
  TIME: (value, _, config) => renderTimeValue(value, config),

  // Numeric types - pass config for displayOptions fallback
  NUMBER: (value, formatting, config) =>
    renderNumberValue(value, formatting as NumberColumnFormatting, config),
  CURRENCY: (value, formatting, config) =>
    renderCurrencyValue(value, formatting as CurrencyColumnFormatting, config),

  // Text types with special rendering
  EMAIL: (value) => renderEmailValue(value),
  PHONE_INTL: (value, formatting, config) =>
    renderPhoneValue(value, formatting as PhoneColumnFormatting, config),
  URL: (value) => renderUrlValue(value),

  // Boolean - pass config for displayOptions
  CHECKBOX: (value, _, config) => renderCheckboxValue(value, config),

  // Select/Tags types - use TagsCellView which handles its own layout (no CellPadding needed)
  // Options can be passed as array directly or as field.options object with .options property
  TAGS: (value, _, config) => {
    const opts = Array.isArray(config?.options)
      ? (config.options as SelectOption[])
      : ((config?.options as { options?: SelectOption[] })?.options ?? [])
    return <TagsCellView value={value as string | string[] | null} options={opts} />
  },
  MULTI_SELECT: (value, _, config) => {
    const opts = Array.isArray(config?.options)
      ? (config.options as SelectOption[])
      : ((config?.options as { options?: SelectOption[] })?.options ?? [])
    return <TagsCellView value={value as string | string[] | null} options={opts} />
  },
  SINGLE_SELECT: (value, _, config) => {
    const opts = Array.isArray(config?.options)
      ? (config.options as SelectOption[])
      : ((config?.options as { options?: SelectOption[] })?.options ?? [])
    return <TagsCellView value={value as string | string[] | null} options={opts} />
  },

  // Relationship - uses RelationshipCellContent which extracts resourceId from TypedFieldValue
  RELATIONSHIP: (value) => {
    return <RelationshipCellContent value={value} />
  },

  // Generic items renderer - for groups, sources, any list of items
  // Uses ItemsCellView which handles its own layout (no CellPadding needed)
  ITEMS: (_, __, config) => (
    <ItemsCellView
      items={config?.items ?? []}
      renderItem={config?.renderItem ?? ((item) => String(item.id))}
      emptyContent={config?.emptyContent}
    />
  ),

  // Address
  ADDRESS: (value) => renderAddressValue(value),
  ADDRESS_STRUCT: (value) => renderAddressValue(value),

  // Rich text
  RICH_TEXT: (value) => renderRichTextValue(value),

  // File
  FILE: (value) => renderFileValue(value),

  // Default text
  TEXT: (value) => renderTextValue(value),
}

/**
 * Extract raw value from TypedFieldValue using centralized formatter.
 * For RELATIONSHIP fields, returns array with {relatedEntityId, relatedEntityDefinitionId}.
 * @param value - The value (TypedFieldValue or raw)
 * @param fieldType - The field type for proper extraction
 */
function unwrapValue(value: unknown, fieldType: string): unknown {
  if (value === null || value === undefined) return null
  return formatToRawValue(value, fieldType)
}

/**
 * Main render function - uses fieldType to select renderer
 * All field types go through cellRenderers. Each renderer handles its own empty state.
 */
export function renderCellValue(
  value: unknown,
  fieldType?: string,
  formatting?: ColumnFormatting,
  config?: CellConfig
): React.ReactNode {
  const type = fieldType ?? 'TEXT'

  // Extract raw value from TypedFieldValue using centralized formatter
  const actualValue = unwrapValue(value, type)

  // Get renderer for field type, fallback to TEXT
  const renderer = cellRenderers[type] ?? cellRenderers.TEXT
  return renderer && renderer(actualValue, formatting, config)
}

/**
 * Get appropriate renderer for a field type
 */
export function getRenderer(fieldType: string): CellRenderer {
  return cellRenderers[fieldType] ?? cellRenderers.TEXT
}
