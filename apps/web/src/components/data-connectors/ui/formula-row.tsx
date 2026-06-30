// apps/web/src/components/data-connectors/ui/formula-row.tsx
'use client'

import { fieldMatchesRef } from '@auxx/lib/resources/client'
import {
  type FieldReference,
  getFieldId,
  isFieldPath,
  keyToFieldRef,
  type ResourceFieldId,
  toFieldPath,
} from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { FunctionSquare } from 'lucide-react'
import { useResourceFields, useResourceProperty } from '~/components/resources'
import type { FieldMapping } from '../hooks/use-stream-mutations'
import type { DraftMapping } from '../stores/connector-draft-store'
import { type IdentityRole, IdentityRoleControl } from './identity-role-control'
import { MappingFieldPicker } from './mapping-field-picker'
import { fieldIconId } from './mapping-node-helpers'
import { FieldRowActions, MappingRow } from './mapping-row'

interface FormulaRowProps {
  depth: number
  /** The def the picker drills/binds FROM. Null until a target def is picked. */
  entityDefinitionId: string | null
  /** Target field key this formula currently writes into (`''` if unassigned). */
  targetKey: string
  /** Resolved label for the target field. */
  label: string
  /** Resolved icon id for the target field (for the picker chip). */
  iconId?: string
  /** The calc expression (shown on the source button; click it to edit). */
  expression: string
  mergeStrategy: string
  /** Target keys bound by other entries — excluded from the retarget picker. */
  excludeKeys?: Set<string>
  /** Show relationships in the picker so the formula can drill ACROSS one (§4). */
  allowRelationships?: boolean
  /** Chip text when bound across a relationship ("Contact › Full name"). */
  drilledLabel?: string
  /** The drilled `FieldPath`, for the picker's selected check on the far field. */
  drilledRef?: FieldReference
  /** This formula's identity role (External ID / Match), keyed by entry id (§5.1). */
  identityRole?: IdentityRole
  /** Offer the "Match existing" option — needs a bound target to compare against. */
  canMatch?: boolean
  /** The mapping is OWNED — relaxes the picker's writable filter to owned columns. */
  ownedWrite?: boolean
  onEdit: () => void
  /** Re-point the formula at a different ROOT target field key. */
  onRetarget: (newKey: string) => void
  /** The picker drilled to a far field — bind the computed value across the relationship. */
  onDrilledAssign?: (ref: FieldReference) => void
  /** Set / clear this formula's identity role. Absent → no identifier control. */
  onSetIdentityRole?: (role: IdentityRole) => void
  onMergeChange: (value: string) => void
  onClear: () => void
}

/**
 * A computed target field (plan 10 §3.2) — a non-bare `fieldMappings` entry that can
 * reference many source fields, so it lives on its own row rather than on a source leaf.
 * Mirrors a leaf row: the source cell is a button (showing the calc expression, or "Set
 * formula…") that opens {@link FieldCalcDialog}; the target column is a field picker (a
 * formula produces a scalar — string-typed for the compat filter). With
 * {@link allowRelationships} the picker can drill ACROSS a relationship to write a related
 * def (formula-drill-targets §4). The identity control (keyed by entry id) marks the
 * computed value as the record's External ID or a Match key (§5.1) — the runtime
 * evaluates the expression as the key.
 */
export function FormulaRow({
  depth,
  entityDefinitionId,
  targetKey,
  label,
  iconId,
  expression,
  mergeStrategy,
  excludeKeys,
  allowRelationships,
  drilledLabel,
  drilledRef,
  identityRole,
  canMatch,
  ownedWrite,
  onEdit,
  onRetarget,
  onDrilledAssign,
  onSetIdentityRole,
  onMergeChange,
  onClear,
}: FormulaRowProps) {
  return (
    <MappingRow
      depth={depth}
      icon={<FunctionSquare className='size-3.5' />}
      // Source cell = a button that opens the formula dialog (shows the expression
      // when set), trailed by the identity key icon; target column = the field it
      // writes into.
      title={
        <span className='flex w-full items-center gap-1'>
          <Button
            variant='transparent'
            onClick={onEdit}
            className={`h-9 min-w-0 flex-1 justify-start rounded-none px-1 text-xs hover:bg-primary/5 ${
              expression ? 'font-mono' : 'text-muted-foreground'
            }`}>
            <span className='truncate'>{expression || 'Set formula…'}</span>
          </Button>
          {onSetIdentityRole && (
            <IdentityRoleControl
              role={identityRole ?? null}
              canMatch={!!canMatch}
              onChange={onSetIdentityRole}
            />
          )}
        </span>
      }
      arrow='filled'
      target={
        <MappingFieldPicker
          entityDefinitionId={entityDefinitionId}
          // A formula has no single source type — it yields a scalar; 'string'
          // drives the (TEXT-compatible) target filter. Quick-create is off; a
          // formula targets an existing field.
          sourceType='string'
          sourcePath=''
          assignedKey={targetKey || undefined}
          // Drilled chip wins; else the field label, or undefined (not '') so the
          // picker falls back to its "Apply field…" placeholder.
          assignedLabel={drilledLabel ?? (label || undefined)}
          assignedIconId={iconId}
          drilledRef={drilledRef}
          excludeKeys={excludeKeys}
          canCreate={false}
          ownedWrite={ownedWrite}
          allowRelationships={allowRelationships}
          onAssign={onRetarget}
          // The picker hands back (field, ref); a formula only needs the path.
          onDrilledAssign={onDrilledAssign ? (_field, ref) => onDrilledAssign(ref) : undefined}
          onClear={onClear}
        />
      }
      // Right-aligned merge → trash, matching the leaf/header rows. No Identifier —
      // a formula has no single source path to match identity on.
      actions={
        <FieldRowActions
          mergeStrategy={mergeStrategy}
          onMergeChange={onMergeChange}
          onClear={onClear}
          clearTooltip='Remove formula'
        />
      }
    />
  )
}

/**
 * A formula bound ACROSS a relationship (formula-drill-targets §4): its entry lives on a
 * flat child mapping, but it renders as a {@link FormulaRow} on the parent whose picker
 * roots at the PARENT def (so it offers the same drill) and whose chip reaches across to
 * "Def › Field". Resolves that chip + the far field's icon from the child's def. Controls
 * route to the child's entry via the handlers from the parent.
 */
export function DrilledFormulaRow({
  depth,
  parentEntityDefinitionId,
  child,
  entry,
  excludeKeys,
  ownedWrite,
  onSetIdentityRole,
  onEdit,
  onRetargetRoot,
  onDrilledAssign,
  onMergeChange,
  onClear,
}: {
  depth: number
  parentEntityDefinitionId: string | null
  child: DraftMapping
  entry: FieldMapping
  excludeKeys?: Set<string>
  ownedWrite?: boolean
  onSetIdentityRole: (role: IdentityRole) => void
  onEdit: () => void
  onRetargetRoot: (newKey: string) => void
  onDrilledAssign: (ref: FieldReference) => void
  onMergeChange: (value: string) => void
  onClear: () => void
}) {
  const def = useResourceProperty(child.entityDefinitionId, ['label'])
  const { fields } = useResourceFields(child.entityDefinitionId)
  const targetRef = (entry.targetFieldRef ?? null) as ResourceFieldId | null
  const farField = targetRef
    ? fields.find((f) => fieldMatchesRef(f, child.entityDefinitionId, targetRef))
    : undefined
  const fieldLabel = targetRef ? (farField?.label ?? getFieldId(targetRef)) : ''
  const drilledLabel = `${def?.label ?? 'Related'} › ${fieldLabel}`
  // Rebuild the drilled FieldPath ([rel…, targetRef]) for the picker's selected check.
  const relRef = keyToFieldRef(child.relationshipFieldKey ?? '')
  const relSegs = isFieldPath(relRef) ? relRef : [relRef as ResourceFieldId]
  const drilledRef = targetRef ? toFieldPath([...relSegs, targetRef]) : undefined

  return (
    <FormulaRow
      depth={depth}
      // Root the picker at the PARENT def so it offers the same drill.
      entityDefinitionId={parentEntityDefinitionId}
      targetKey={targetRef ?? ''}
      label={fieldLabel}
      iconId={fieldIconId(farField)}
      expression={entry.expression}
      mergeStrategy={entry.mergeStrategy ?? 'overwrite'}
      excludeKeys={excludeKeys}
      allowRelationships={parentEntityDefinitionId != null}
      drilledLabel={drilledLabel}
      drilledRef={drilledRef}
      // External ID here keys the RELATED record (a radio within the flat child).
      identityRole={entry.identityRole?.kind ?? null}
      canMatch={targetRef != null}
      ownedWrite={ownedWrite}
      onSetIdentityRole={onSetIdentityRole}
      onEdit={onEdit}
      onRetarget={onRetargetRoot}
      onDrilledAssign={onDrilledAssign}
      onMergeChange={onMergeChange}
      onClear={onClear}
    />
  )
}
