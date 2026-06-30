'use client'

// apps/web/src/components/fields/displays/display-url.tsx

import type { FieldOptions } from '@auxx/lib/field-values/client'
import { Badge } from '@auxx/ui/components/badge'
import { formatUrlForDisplay, normalizeUrl } from '@auxx/utils'
import { ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import { VisualIcon } from '~/components/icons/ui/visual-icon'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'
import { FieldOptionButton } from './field-option-button'

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
