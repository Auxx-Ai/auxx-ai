// apps/web/src/components/data-connectors/ui/source-leaf-row.tsx
'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import type { FieldReference } from '@auxx/types/field'
import { Brackets, Hash } from 'lucide-react'
import { lastSegment, type SourcePath } from '../hooks/use-source-paths'
import { type IdentityRole, IdentityRoleControl } from './identity-role-control'
import { MappingFieldPicker } from './mapping-field-picker'
import { FieldRowActions, MappingRow } from './mapping-row'

/** The identity role a leaf currently plays (relationship-linking v3 §9.4). */
export type LeafIdentityRole = IdentityRole

/**
 * Short type token for the leaf badge. Prefers a detected string `format`
 * (`uri`/`email`/`date`/…) over the bare JSON type, so the badge matches what
 * quick-create seeds — a `url`-valued string reads `URL`, not `STRING`. The
 * badge's `uppercase` class handles casing.
 */
function sourceTypeLabel(node: SourcePath): string {
  switch (node.format) {
    case 'uri':
      return 'url'
    case 'email':
      return 'email'
    case 'date-time':
      return 'datetime'
    case 'date':
      return 'date'
    case 'time':
      return 'time'
    default:
      return node.type
  }
}

/** Only scalars the runtime can `String()`-coerce can be an identifier (§9.4). */
function isCoercibleScalar(node: SourcePath): boolean {
  return node.type === 'string' || node.type === 'number' || node.type === 'integer'
}

interface SourceLeafRowProps {
  depth: number
  node: SourcePath
  /** The enclosing mapping's def — the binding target. Null until a def is picked. */
  entityDefinitionId: string | null
  /** The target is a not-yet-created (lazily-provisioned) owned def — bind via provisions (05e). */
  willCreate?: boolean
  /** Projected provision columns for a {@link willCreate} target — the picker's field list. */
  projectedFields?: ResourceField[]
  /** Resolved label for the bound key (for the chip). */
  assignedLabel: string | undefined
  /** Resolved icon id for the applied field (direct or drilled) — shown on the chip. */
  assignedIconId?: string | undefined
  assignedTargetKey: string | undefined
  /** Target keys bound by other entries — excluded from this leaf's picker. */
  excludeKeys?: Set<string>
  mergeStrategy: string
  /** A target def is set, so inline quick-create can mint a new field. */
  canCreate: boolean
  /** Owned mapping (the connector is the sole writer) — hides the merge picker. */
  isOwned: boolean
  /** The identity role this leaf plays (external-id anchor / secondary match / none). */
  identityRole: LeafIdentityRole
  /** Relationship linking — the picker is the entry point; the link renders on a sub-row. */
  allowRelationships?: boolean
  /** The currently-linked relationship field's ref, for the picker's selected check. */
  linkedFieldRef?: string
  /**
   * Set when this leaf is bound ACROSS a relationship (unified picker §2) — its value
   * is written onto a related record. {@link drilledLabel} is the chip ("Contact ›
   * Email"); {@link drilledRef} drives the in-picker selected check on the far field.
   */
  drilledLabel?: string
  drilledRef?: FieldReference
  onAssign: (targetKey: string) => void
  /** Bind this leaf ACROSS a relationship — a drilled `FieldPath`. */
  onDrilledAssign?: (field: ResourceField, ref: FieldReference) => void
  onClear: () => void
  onMergeChange: (value: string) => void
  /** Set / clear this leaf's identity role (External ID anchor or secondary Match). */
  onSetIdentityRole: (role: LeafIdentityRole) => void
  onLinkRelationship?: (field: ResourceField, ref: FieldReference) => void
  /** Bind / quick-create this leaf onto a projected provision column of a lazy owned def. */
  onAssignProvision?: (provision: { name: string; type: string; appFieldKey?: string }) => void
}

/**
 * A source-schema leaf (plan §3.1). The label is the source field; the
 * {@link MappingFieldPicker} "applies" a target field to it. The row title carries
 * the {@link IdentityRoleControl} key icon (External ID / Match), which renders even
 * on UNMAPPED rows — the external id is source-side and needs no target binding
 * (§9.4). Once a target is bound, the merge picker + clear appear.
 */
export function SourceLeafRow({
  depth,
  node,
  entityDefinitionId,
  willCreate,
  projectedFields,
  assignedLabel,
  assignedIconId,
  assignedTargetKey,
  excludeKeys,
  mergeStrategy,
  canCreate,
  isOwned,
  identityRole,
  allowRelationships,
  linkedFieldRef,
  drilledLabel,
  drilledRef,
  onAssign,
  onDrilledAssign,
  onClear,
  onMergeChange,
  onSetIdentityRole,
  onLinkRelationship,
  onAssignProvision,
}: SourceLeafRowProps) {
  const isMapped = !!assignedTargetKey || !!drilledRef
  const isArray = node.type === 'array'
  const Icon = isArray ? Brackets : Hash
  return (
    <MappingRow
      depth={depth}
      icon={<Icon className={isMapped ? 'size-3.5' : 'size-3.5 text-muted-foreground/50'} />}
      title={
        <span className='flex items-center gap-1.5'>
          <span className={`font-mono text-sm ${isMapped ? '' : 'text-muted-foreground'}`}>
            {lastSegment(node.path)}
          </span>
          <span className='text-[10px] uppercase text-muted-foreground/60'>
            {sourceTypeLabel(node)}
          </span>
          {/* Identity role lives in the title (source-side) so it shows on unmapped
              rows too. Only for scalars the runtime can String()-coerce. */}
          {isCoercibleScalar(node) && (
            <IdentityRoleControl
              role={identityRole}
              canMatch={isMapped}
              onChange={onSetIdentityRole}
            />
          )}
        </span>
      }
      // The arrow always shows (the field picker is always present, even when
      // unbound) — dimmed until a target field is bound.
      arrow={isMapped ? 'filled' : 'dim'}
      // Target column — the field picker fills the cell and blends into the row.
      target={
        <MappingFieldPicker
          kind='leaf'
          entityDefinitionId={entityDefinitionId}
          willCreate={willCreate}
          projectedFields={projectedFields}
          onProvisionSelect={onAssignProvision}
          onProvisionCreate={onAssignProvision}
          sourceType={node.type}
          sourcePath={node.path}
          sourceFormat={node.format}
          assignedKey={assignedTargetKey}
          assignedLabel={drilledLabel ?? assignedLabel}
          assignedIconId={assignedIconId}
          drilledRef={drilledRef}
          excludeKeys={excludeKeys}
          canCreate={canCreate}
          allowRelationships={allowRelationships}
          linkedFieldRef={linkedFieldRef}
          onAssign={onAssign}
          onDrilledAssign={onDrilledAssign}
          onClear={onClear}
          onSelectRelationship={onLinkRelationship}
        />
      }
      // Actions — merge → clear. The identity role now lives in the title (§9.4).
      actions={
        isMapped && (
          <FieldRowActions
            isOwned={isOwned}
            mergeStrategy={mergeStrategy}
            onMergeChange={onMergeChange}
            onClear={onClear}
          />
        )
      }
    />
  )
}
