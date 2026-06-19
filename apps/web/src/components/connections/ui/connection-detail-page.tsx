// apps/web/src/components/connections/ui/connection-detail-page.tsx
'use client'

import type { ConnectionVariable } from '@auxx/database'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { cn } from '@auxx/ui/lib/utils'
import { KeyRound, Plug } from 'lucide-react'
import { ConnectionVariableFields } from '~/components/connections/ui/connection-variable-fields'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'

/** One connect method an item exposes (the detail page renders + collects input for it). */
export interface DetailMethod {
  id: string
  label: string
  description: string | null
  connectionType: string
  /** true = organization-wide, false = user-specific. Shown as a scope hint. */
  global: boolean
  connectionVariables?: ConnectionVariable[] | null
}

interface ConnectionDetailPageProps {
  /** Every method the item exposes. >1 renders the method chooser. */
  methods: DetailMethod[]
  /** Chosen method id (null until picked); the sole method auto-resolves. */
  selectedMethodId: string | null
  onMethodChange: (id: string) => void
  values: Record<string, string>
  onValueChange: (key: string, value: string) => void
  token: string
  onTokenChange: (token: string) => void
  errors: Record<string, string>
  disabled?: boolean
  /** Override the root padding/layout (e.g. the dialog drops the gallery's `px-4 py-5`). */
  className?: string
}

/** Short type label shown in parentheses next to the method name. */
const TYPE_LABEL: Record<string, string> = {
  'oauth2-code': 'OAuth',
  secret: 'API key',
}

/** A secret/variable method needs the field step; bare OAuth connects one-click. */
export function methodNeedsFields(method: DetailMethod): boolean {
  return method.connectionType === 'secret' || (method.connectionVariables?.length ?? 0) > 0
}

/** A single-secret method (API key) with no structured variables. */
export function methodIsBareSecret(method: DetailMethod): boolean {
  return method.connectionType === 'secret' && (method.connectionVariables?.length ?? 0) === 0
}

/**
 * The connect form shown on the gallery's detail page. Owns both the method chooser (when an
 * item exposes more than one way to connect — e.g. Stripe: API key OR OAuth2) and the input
 * fields for the chosen method (an API key and/or structured connection variables). A bare
 * OAuth method renders neither and connects one-click. See
 * plans/connections/unify-connection-definition.md §15 and multi-connection-per-app.md §3.
 */
export function ConnectionDetailPage({
  methods,
  selectedMethodId,
  onMethodChange,
  values,
  onValueChange,
  token,
  onTokenChange,
  errors,
  disabled,
  className,
}: ConnectionDetailPageProps) {
  // The sole method auto-resolves; >1 requires an explicit pick.
  const chosen =
    methods.find((m) => m.id === selectedMethodId) ?? (methods.length === 1 ? methods[0] : null)

  return (
    <div className={cn('flex flex-col gap-4 px-4 py-5', className)}>
      {methods.length > 1 && (
        <div className='flex flex-col gap-2'>
          <div className='text-xs font-medium text-muted-foreground'>Connection method</div>
          <RadioGroup
            value={selectedMethodId ?? undefined}
            onValueChange={onMethodChange}
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
        </div>
      )}
      {chosen && methodNeedsFields(chosen) && (
        <div className='flex flex-col gap-2'>
          <div className='text-xs font-medium text-muted-foreground'>Credentials</div>
          <VarEditorField
            orientation='responsive'
            className='p-0 sm:[&_[data-slot=field-row-label]]:w-70!'>
            <ConnectionVariableFields
              variables={chosen.connectionVariables ?? []}
              values={values}
              onValueChange={onValueChange}
              showToken={methodIsBareSecret(chosen)}
              token={token}
              onTokenChange={onTokenChange}
              errors={errors}
              disabled={disabled}
            />
          </VarEditorField>
        </div>
      )}
    </div>
  )
}
