// apps/web/src/components/data-import/column-mapping/mapping-controls.tsx

'use client'

import type { ImportableField, ImportStrategyMode, ResolutionType } from '@auxx/lib/import/client'
import type { Resource } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import { Trash2 } from 'lucide-react'
import type { ColumnMappingUI } from '../types'
import {
  type ColumnPolicyPatch,
  ColumnPolicyPopover,
  hasColumnPolicy,
} from './column-policy-popover'
import { canFlagAsIdentifier, IdentifierToggle } from './identifier-toggle'
import { hasResolutionChoice, ResolutionTypePopover } from './resolution-type-popover'

interface MappingControlsProps {
  mapping: ColumnMappingUI
  /** The field the column is mapped to; undefined renders only the clear button. */
  field: ImportableField | undefined
  /** The relation TARGET resource. Undefined for scalar columns. */
  targetResource: Resource | undefined
  mode: ImportStrategyMode
  /** How many OTHER columns carry the identity flag. */
  otherIdentifierCount: number
  isSaving?: boolean
  onClear: () => void
  onToggleIdentifier: (next: boolean) => void
  onPolicyChange: (patch: ColumnPolicyPatch) => void
  onResolutionTypeChange: (next: ResolutionType) => void
  onDecimalSeparatorChange: (next: '.' | ',' | null) => void
}

/** Button group beside a mapped column: read-as, identity, policy, clear. */
export function MappingControls({
  mapping,
  field,
  targetResource,
  mode,
  otherIdentifierCount,
  isSaving,
  onClear,
  onToggleIdentifier,
  onPolicyChange,
  onResolutionTypeChange,
  onDecimalSeparatorChange,
}: MappingControlsProps) {
  const isFlagged = mapping.identityRole?.kind === 'match'

  return (
    <>
      {field && hasResolutionChoice(field) && (
        <ResolutionTypePopover
          field={field}
          value={mapping.resolutionType}
          decimalSeparator={mapping.numberDecimalSeparator}
          detectedDecimalSeparator={mapping.detectedDecimalSeparator}
          disabled={isSaving}
          onChange={onResolutionTypeChange}
          onDecimalSeparatorChange={onDecimalSeparatorChange}
        />
      )}

      {field && canFlagAsIdentifier(field) && (
        <IdentifierToggle
          field={field}
          isFlagged={isFlagged}
          otherFlaggedCount={otherIdentifierCount}
          disabled={isSaving}
          onToggle={onToggleIdentifier}
        />
      )}

      {field && hasColumnPolicy(field, mode) && (
        <ColumnPolicyPopover
          field={field}
          targetResource={targetResource}
          matchField={mapping.matchField}
          mergeStrategy={mapping.mergeStrategy}
          onNoMatch={mapping.onNoMatch}
          linkMode={mapping.linkMode}
          mode={mode}
          disabled={isSaving}
          onChange={onPolicyChange}
        />
      )}

      {mapping.targetFieldKey && (
        <Button
          variant='outline'
          size='icon-sm'
          className='rounded-l-none bg-linear-0 shadow-none hover:inset-shadow-none hover:border-destructive/20 hover:from-destructive/5 hover:to-destructive/5 hover:text-destructive hover:shadow-xs'
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}>
          <Trash2 />
        </Button>
      )}
    </>
  )
}
