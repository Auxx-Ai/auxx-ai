// apps/web/src/components/dynamic-table/utils/cell-renderers.tsx

import { useMemo } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { formatPhoneNumber } from 'react-phone-number-input'
import { formatCurrency, formatBytes, type CurrencyDisplayOptions } from '@auxx/lib/utils'
import { CheckSquare, Paperclip } from 'lucide-react'
import { Badge } from '@auxx/ui/components/badge'
import { CopyableLinkCell } from '../components/copyable-link-cell'
import { CellPadding, type CellConfig } from '../components/formatted-cell'
import { TagsCellView } from '~/components/ui/tags-view'
import { ItemsCellView } from '~/components/ui/items-list-view'
import { useRelationship } from '~/components/resources'
import { extractValue, type TypedFieldValue } from '@auxx/types/field-value'
import type {
  ColumnFormatting,
  CurrencyColumnFormatting,
  DateColumnFormatting,
  NumberColumnFormatting,
} from '../types'

/** Select option type for tags/select renderers */
type SelectOption = { label: string; value: string }

/**
 * Relationship cell content - displays related entities with display names.
 * Extracts relatedEntityDefinitionId from TypedFieldValue to determine resource type.
 * Standardized format:
 * - System resources: store model type string (e.g., "contact", "ticket")
 * - Custom entities: store UUID of EntityDefinition
 */
function RelationshipCellContent({ value }: { value: unknown }) {
  // Extract IDs and entityDefinitionId from value
  const { ids, entityDefinitionId } = useMemo(() => {
    if (!value) return { ids: [], entityDefinitionId: null }

    // Handle TypedFieldValue array
    if (Array.isArray(value)) {
      if (
        value.length > 0 &&
        typeof value[0] === 'object' &&
        value[0] !== null &&
        'type' in value[0]
      ) {
        const first = value[0] as { relatedEntityDefinitionId?: string }
        return {
          ids: value
            .map((v) => (v as { relatedEntityId?: string }).relatedEntityId)
            .filter(Boolean) as string[],
          entityDefinitionId: first.relatedEntityDefinitionId || null,
        }
      }
      // Already an array of IDs
      return {
        ids: value.filter((id) => typeof id === 'string') as string[],
        entityDefinitionId: null,
      }
    }

    // Handle single TypedFieldValue
    if (typeof value === 'object' && value !== null && 'type' in value) {
      const rel = value as { relatedEntityId?: string; relatedEntityDefinitionId?: string }
      return {
        ids: rel.relatedEntityId ? [rel.relatedEntityId] : [],
        entityDefinitionId: rel.relatedEntityDefinitionId || null,
      }
    }

    // Handle raw string ID
    if (typeof value === 'string') return { ids: [value], entityDefinitionId: null }

    return { ids: [], entityDefinitionId: null }
  }, [value])

  // Convert entityDefinitionId to resourceId for useRelationship
  // System resources: "contact" -> use as-is
  // Custom entities: UUID -> convert to "entity_{slug}" (or pass through, let hook handle it)
  const resourceId = useMemo(() => {
    if (!entityDefinitionId) return null

    // Check if it's a known system resource first
    const systemResources = ['contact', 'contacts', 'ticket', 'tickets', 'user', 'users', 'thread', 'threads']
    if (systemResources.includes(entityDefinitionId)) {
      return entityDefinitionId.replace(/s$/, '') // normalize plural to singular
    }

    // It's a UUID - need to convert to entity_{slug} format
    // For now, prefix with entity_ and let useRelationship handle UUID resolution
    return entityDefinitionId.startsWith('entity_')
      ? entityDefinitionId
      : `entity_${entityDefinitionId}`
  }, [entityDefinitionId])

  const { items: hydratedItems, isLoading } = useRelationship(resourceId, ids)

  const items = ids.map((id, i) => ({
    id,
    displayName: hydratedItems[i]?.displayName ?? id.slice(-6),
    isNotFound: !hydratedItems[i],
  }))

  return (
    <ItemsCellView
      items={items}
      isLoading={isLoading && items.length === 0}
      renderItem={(item) => (
        <Badge variant="pill" shape="tag" className="text-xs">
          {item.isNotFound ? item.id : item.displayName}
        </Badge>
      )}
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
 * Render date value with optional formatting override
 */
export function renderDateValue(
  value: unknown,
  formatting?: DateColumnFormatting
): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  try {
    const date = new Date(value as string | number)
    if (isNaN(date.getTime())) {
      return <CellPadding expandDirection="horizontal">{String(value)}</CellPadding>
    }

    const dateFormat = formatting?.format ?? 'medium'
    const includeTime = formatting?.includeTime ?? false

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
 * Render time-only value
 */
export function renderTimeValue(value: unknown): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  try {
    const date = new Date(value as string | number)
    if (isNaN(date.getTime())) {
      return <CellPadding expandDirection="horizontal">{String(value)}</CellPadding>
    }
    return <CellPadding expandDirection="horizontal">{format(date, 'h:mm a')}</CellPadding>
  } catch {
    return <CellPadding expandDirection="horizontal">{String(value)}</CellPadding>
  }
}

/**
 * Render number value with optional formatting override
 */
export function renderNumberValue(
  value: unknown,
  formatting?: NumberColumnFormatting
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

  const decimalPlaces = formatting?.decimalPlaces ?? 2
  const useGrouping = formatting?.useGrouping ?? true
  const displayAs = formatting?.displayAs ?? 'number'
  const prefix = formatting?.prefix ?? ''
  const suffix = formatting?.suffix ?? ''

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
 * Render phone value as copyable link with formatted display
 */
export function renderPhoneValue(value: unknown): React.ReactNode {
  if (value == null || value === '') return <EmptyCell />

  const phone = String(value)
  const formatted = formatPhoneNumber(phone) || phone
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
 * Render checkbox/boolean value
 */
export function renderCheckboxValue(value: unknown): React.ReactNode {
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
 * Render plain text value
 * Handles TypedFieldValue and raw values (no legacy format support)
 */
export function renderTextValue(value: unknown): React.ReactNode {
  // Handle null/undefined
  if (value == null) {
    return <EmptyCell />
  }

  // Handle objects
  if (typeof value === 'object') {
    const objValue = value as Record<string, unknown>

    // Check for TypedFieldValue (has 'type' property)
    if ('type' in objValue) {
      const extracted = extractValue(value as TypedFieldValue)
      return renderTextValue(extracted)
    }

    // STRICT: Reject legacy .data wrapper format
    if ('data' in objValue) {
      console.error(
        '[renderTextValue] Legacy { data: x } format detected. All values must be TypedFieldValue.'
      )
      return <EmptyCell />
    }

    // For other objects, show empty state (don't stringify to [object Object])
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
  // Date types
  DATE: (value, formatting) => renderDateValue(value, formatting as DateColumnFormatting),
  DATETIME: (value, formatting) =>
    renderDateValue(value, { ...(formatting as DateColumnFormatting), includeTime: true }),
  TIME: (value) => renderTimeValue(value),

  // Numeric types
  NUMBER: (value, formatting) => renderNumberValue(value, formatting as NumberColumnFormatting),
  CURRENCY: (value, formatting, config) =>
    renderCurrencyValue(value, formatting as CurrencyColumnFormatting, config),

  // Text types with special rendering
  EMAIL: (value) => renderEmailValue(value),
  PHONE: (value) => renderPhoneValue(value),
  PHONE_INTL: (value) => renderPhoneValue(value),
  URL: (value) => renderUrlValue(value),

  // Boolean
  CHECKBOX: (value) => renderCheckboxValue(value),

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
 * Extract raw value from TypedFieldValue.
 * Strict mode - rejects legacy { data: x } format.
 */
function unwrapValue(value: unknown): unknown {
  if (value === null || value === undefined) return null

  // STRICT: Reject legacy { data: x } wrapper format
  if (
    typeof value === 'object' &&
    'data' in (value as Record<string, unknown>) &&
    !('type' in (value as Record<string, unknown>))
  ) {
    console.error(
      '[CellRenderer] Legacy { data: x } format detected. All values must be TypedFieldValue.'
    )
    return null
  }

  // Handle TypedFieldValue array (e.g., multi-select, tags)
  if (Array.isArray(value)) {
    // Check if it's an array of TypedFieldValue objects
    if (
      value.length > 0 &&
      typeof value[0] === 'object' &&
      value[0] !== null &&
      'type' in value[0]
    ) {
      return value.map((v) => extractValue(v as TypedFieldValue))
    }
    // Already an array of raw values (could be empty or pre-extracted)
    return value
  }

  // Handle single TypedFieldValue
  if (typeof value === 'object' && 'type' in (value as Record<string, unknown>)) {
    return extractValue(value as TypedFieldValue)
  }

  // Already a raw value (string, number, boolean, etc.)
  return value
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
  // Extract raw value from TypedFieldValue
  const actualValue = unwrapValue(value)

  // Get renderer for field type, fallback to TEXT
  const renderer = cellRenderers[fieldType ?? 'TEXT'] ?? cellRenderers.TEXT
  return renderer && renderer(actualValue, formatting, config)
}

/**
 * Get appropriate renderer for a field type
 */
export function getRenderer(fieldType: string): CellRenderer {
  return cellRenderers[fieldType] ?? cellRenderers.TEXT
}
