// apps/web/src/components/fields/displays/display-phone.tsx

import { formatToDisplayValue } from '@auxx/lib/field-values/client'
import { Badge } from '@auxx/ui/components/badge'
import { PhoneForwarded } from 'lucide-react'
import { ItemsListView } from '~/components/ui/items-list-view'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'
import { FieldOptionButton } from './field-option-button'

/** How many chips a multi-value field shows before collapsing into `+N more`. */
const MULTI_VALUE_MAX_DISPLAY = 3

/**
 * DisplayPhone component
 * Renders a formatted phone number with configurable format. Multi-value
 * fields (options.multi) render the full list as chips — primary first,
 * `+N more` overflow — with copy/call actions bound to the primary number.
 */
export function DisplayPhone() {
  const { value, field } = useFieldContext()
  const options = field.options

  const formatPhone = (raw: string): string =>
    (formatToDisplayValue({ type: 'text', value: raw }, 'PHONE_INTL', options) as string) || raw

  // Multi-value branch: array of numbers, primary at index 0.
  if (Array.isArray(value)) {
    const phones = value.filter((v): v is string => typeof v === 'string' && v !== '')
    const primary = phones[0] ?? null

    const buttons = primary
      ? [
          <FieldOptionButton key='open' label='Call' href={`tel:${primary}`}>
            <PhoneForwarded />
          </FieldOptionButton>,
        ]
      : []

    return (
      <DisplayWrapper copyValue={primary} buttons={buttons}>
        <ItemsListView
          items={phones.map((phone, index) => ({ id: `${index}:${phone}`, phone }))}
          renderItem={(item) => (
            <Badge shape='tag' variant='pill'>
              {formatPhone(typeof item === 'object' ? (item.phone as string) : String(item))}
            </Badge>
          )}
          maxDisplay={MULTI_VALUE_MAX_DISPLAY}
        />
      </DisplayWrapper>
    )
  }

  const rawValue = typeof value === 'string' ? value : value ? String(value) : ''
  // Use converter for display formatting
  const formatted = rawValue ? formatPhone(rawValue) : ''

  const displayText = formatted || '-'

  const buttons = [
    <FieldOptionButton key='open' label='Call' href={`tel:${rawValue}`}>
      <PhoneForwarded />
    </FieldOptionButton>,
  ]

  return (
    <DisplayWrapper copyValue={rawValue || null} buttons={buttons}>
      <Badge shape='tag' variant='pill'>
        {displayText}
      </Badge>
    </DisplayWrapper>
  )
}
