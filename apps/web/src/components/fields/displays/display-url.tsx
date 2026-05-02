'use client'

// apps/web/src/components/fields/displays/display-url.tsx

import { Badge } from '@auxx/ui/components/badge'
import { formatUrlForDisplay, normalizeUrl } from '@auxx/utils'
import { ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'
import { FieldOptionButton } from './field-option-button'

/**
 * DisplayUrl component
 * Renders a URL value with action buttons to open and copy the link
 */
export function DisplayUrl() {
  const { value } = useFieldContext()

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

  return (
    <DisplayWrapper copyValue={normalizedValue} buttons={buttons}>
      <Badge variant='pill' className='shrink-0'>
        {displayValue}
      </Badge>
    </DisplayWrapper>
  )
}
