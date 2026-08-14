// apps/web/src/components/fields/displays/display-email.tsx

import { Badge } from '@auxx/ui/components/badge'
import { Mail } from 'lucide-react'
import { ItemsListView } from '~/components/ui/items-list-view'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'
import { FieldOptionButton } from './field-option-button'

/** How many chips a multi-value field shows before collapsing into `+N more`. */
const MULTI_VALUE_MAX_DISPLAY = 3

/**
 * DisplayEmail component
 * Renders an email value. Multi-value fields (options.multi) render the full
 * list as chips — primary first, `+N more` overflow — with copy/compose
 * actions bound to the primary address.
 */
export function DisplayEmail() {
  const { value } = useFieldContext()

  // Multi-value branch: array of addresses, primary at index 0.
  if (Array.isArray(value)) {
    const emails = value.filter((v): v is string => typeof v === 'string' && v !== '')
    const primary = emails[0] ?? null

    const buttons = primary
      ? [
          <FieldOptionButton key='open' label='Email' href={`mailto:${primary}`}>
            <Mail />
          </FieldOptionButton>,
        ]
      : []

    return (
      <DisplayWrapper copyValue={primary} buttons={buttons}>
        <ItemsListView
          items={emails.map((email, index) => ({ id: `${index}:${email}`, email }))}
          renderItem={(item) => (
            <Badge variant='pill' className='focus:ring-0'>
              {typeof item === 'object' ? (item.email as string) : String(item)}
            </Badge>
          )}
          maxDisplay={MULTI_VALUE_MAX_DISPLAY}
        />
      </DisplayWrapper>
    )
  }

  const email = typeof value === 'string' ? value : ''

  const buttons = [
    <FieldOptionButton key='open' label='Email' href={`mailto:${email}`}>
      <Mail />
    </FieldOptionButton>,
  ]

  return (
    <DisplayWrapper copyValue={email || null} buttons={buttons}>
      <Badge variant='pill' className='focus:ring-0'>
        {email}
      </Badge>
    </DisplayWrapper>
  )
}
