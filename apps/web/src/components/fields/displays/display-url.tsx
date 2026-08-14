'use client'

// apps/web/src/components/fields/displays/display-url.tsx

import type { FieldOptions } from '@auxx/lib/field-values/client'
import { Badge } from '@auxx/ui/components/badge'
import { formatUrlForDisplay, normalizeUrl } from '@auxx/utils'
import { ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import { VisualIcon } from '~/components/icons/ui/visual-icon'
import { ItemsListView } from '~/components/ui/items-list-view'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'
import { FieldOptionButton } from './field-option-button'

/** How many chips a multi-value field shows before collapsing into `+N more`. */
const MULTI_VALUE_MAX_DISPLAY = 3

/**
 * DisplayUrl component
 * Renders a URL value with action buttons to open and copy the link, or — when the
 * field opts into `urlDisplay: 'image'` — as an image thumbnail (product images, avatars).
 */
export function DisplayUrl() {
  const { value, field } = useFieldContext()
  const asImage = (field.options as FieldOptions | undefined)?.urlDisplay === 'image'

  const normalizedValue = useMemo(() => {
    if (typeof value !== 'string') return null
    return normalizeUrl(value)
  }, [value])

  const displayValue = useMemo(() => {
    if (!normalizedValue) return null
    return formatUrlForDisplay(normalizedValue)
  }, [normalizedValue])

  // Multi-value branch (options.multi): array of URLs, primary at index 0,
  // chips with `+N more` overflow. Copy/open actions bind to the primary.
  // Placed after every hook so the early return never skips one.
  if (Array.isArray(value)) {
    const urls = value
      .filter((v): v is string => typeof v === 'string' && v !== '')
      .map((v) => normalizeUrl(v))
      .filter((v): v is string => !!v)
    const primary = urls[0] ?? null

    const buttons = primary
      ? [
          <FieldOptionButton key='open' label='Open website' href={primary}>
            <ExternalLink />
          </FieldOptionButton>,
        ]
      : []

    return (
      <DisplayWrapper copyValue={primary} buttons={buttons}>
        <ItemsListView
          items={urls.map((url, index) => ({ id: `${index}:${url}`, url }))}
          renderItem={(item) => {
            const url = typeof item === 'object' ? (item.url as string) : String(item)
            return (
              <Badge variant='pill' className='shrink-0'>
                {formatUrlForDisplay(url)}
              </Badge>
            )
          }}
          maxDisplay={MULTI_VALUE_MAX_DISPLAY}
        />
      </DisplayWrapper>
    )
  }

  if (!normalizedValue || !displayValue) {
    return (
      <DisplayWrapper copyValue={null}>
        <Badge variant='pill'>-</Badge>
      </DisplayWrapper>
    )
  }

  const buttons = [
    <FieldOptionButton key='open' label='Open website' href={normalizedValue}>
      <ExternalLink />
    </FieldOptionButton>,
  ]

  if (asImage) {
    return (
      <DisplayWrapper copyValue={normalizedValue} buttons={buttons}>
        <VisualIcon
          value={normalizedValue}
          fit='cover'
          imageFallback
          fallbackIconId='image'
          size='lg'
        />
      </DisplayWrapper>
    )
  }

  return (
    <DisplayWrapper copyValue={normalizedValue} buttons={buttons}>
      <Badge variant='pill' className='shrink-0'>
        {displayValue}
      </Badge>
    </DisplayWrapper>
  )
}
