import DisplayWrapper from './display-wrapper'
import { usePropertyContext } from '../property-provider'
import { Badge } from '@auxx/ui/components/badge'
import Link from 'next/link'
import { FieldOptionButton } from './field-option-button'
import { Mail } from 'lucide-react'

/**
 * DisplayEmail component
 * Renders an email value
 */
export function DisplayEmail() {
  const { value } = usePropertyContext()
  const email = typeof value === 'string' ? value : ''

  const buttons = [
    <FieldOptionButton key="open" label="Email" href={`mailto:${email}`}>
      <Mail />
    </FieldOptionButton>,
  ]

  return (
    <DisplayWrapper copyValue={email || null} buttons={buttons}>
      <Badge variant="pill" className="focus:ring-0">
        {email}
      </Badge>
    </DisplayWrapper>
  )
}
