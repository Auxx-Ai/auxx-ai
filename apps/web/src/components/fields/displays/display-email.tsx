import { Badge } from '@auxx/ui/components/badge'
import { Mail } from 'lucide-react'
import { useFieldContext } from './display-field'
import DisplayWrapper from './display-wrapper'
import { FieldOptionButton } from './field-option-button'

/**
 * DisplayEmail component
 * Renders an email value
 */
export function DisplayEmail() {
  const { value } = useFieldContext()
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
