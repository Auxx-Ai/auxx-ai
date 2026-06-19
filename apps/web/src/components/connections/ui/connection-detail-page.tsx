// apps/web/src/components/connections/ui/connection-detail-page.tsx
'use client'

import type { ConnectionVariable } from '@auxx/database'
import { ConnectionVariableFields } from '~/components/mcp/ui/connection-variable-fields'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'

interface ConnectionDetailPageProps {
  /** Connection-variable defs from the chosen provider/app definition. */
  variables: ConnectionVariable[]
  values: Record<string, string>
  onValueChange: (key: string, value: string) => void
  /** Render the single API-key row (bare-secret definitions with no variables). */
  showToken: boolean
  token: string
  onTokenChange: (token: string) => void
  errors: Record<string, string>
  disabled?: boolean
}

/**
 * The connect form shown on the gallery's detail page when a chosen connection needs
 * input — an API key and/or structured connection variables. OAuth connections with
 * no inputs never reach this page (they connect one-click). See
 * plans/connections/unify-connection-definition.md §15.
 */
export function ConnectionDetailPage({
  variables,
  values,
  onValueChange,
  showToken,
  token,
  onTokenChange,
  errors,
  disabled,
}: ConnectionDetailPageProps) {
  return (
    <div className='flex flex-col gap-2 p-3'>
      <VarEditorField
        orientation='responsive'
        className='p-0 sm:[&_[data-slot=field-row-label]]:w-70!'>
        <ConnectionVariableFields
          variables={variables}
          values={values}
          onValueChange={onValueChange}
          showToken={showToken}
          token={token}
          onTokenChange={onTokenChange}
          errors={errors}
          disabled={disabled}
        />
      </VarEditorField>
    </div>
  )
}
