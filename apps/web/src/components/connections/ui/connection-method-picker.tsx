// apps/web/src/components/connections/ui/connection-method-picker.tsx
'use client'

import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { KeyRound, Plug } from 'lucide-react'

/** The subset of a connection method the picker renders. */
export interface PickerMethod {
  id: string
  label: string
  description: string | null
  connectionType: string
  /** true = organization-wide, false = user-specific. Shown as a scope hint. */
  global: boolean
}

interface ConnectionMethodPickerProps {
  methods: PickerMethod[]
  /** Currently selected method id, or null when nothing is chosen yet. */
  value: string | null
  onChange: (id: string) => void
  disabled?: boolean
}

/** Short type label shown in parentheses next to the method name. */
const TYPE_LABEL: Record<string, string> = {
  'oauth2-code': 'OAuth',
  secret: 'API key',
}

/**
 * The method chooser shown on the connection detail page when an app exposes more than
 * one way to connect (e.g. Stripe: API key OR OAuth2). One {@link RadioGroupItemCard} per
 * method; the picked id is threaded to the connect flow as `definitionId`. Single-method
 * apps never render this — they connect directly. See
 * plans/connections/multi-connection-per-app.md §3.
 */
export function ConnectionMethodPicker({
  methods,
  value,
  onChange,
  disabled,
}: ConnectionMethodPickerProps) {
  return (
    <RadioGroup
      value={value ?? undefined}
      onValueChange={onChange}
      disabled={disabled}
      className='gap-2'>
      {methods.map((method) => (
        <RadioGroupItemCard
          key={method.id}
          value={method.id}
          icon={method.connectionType === 'secret' ? <KeyRound /> : <Plug />}
          label={method.label}
          sublabel={TYPE_LABEL[method.connectionType]}
          description={
            method.description ??
            (method.global ? 'Shared across your workspace.' : 'Connected to your account.')
          }
        />
      ))}
    </RadioGroup>
  )
}
