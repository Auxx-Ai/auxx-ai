// apps/web/src/components/data-connectors/ui/branch-row.tsx
'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import type { FieldReference } from '@auxx/types/field'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { Braces, Brackets, Plus } from 'lucide-react'
import { useState } from 'react'
import { ResourcePickerContent } from '~/components/pickers/resource-picker'
import { lastSegment, type SourceTreeNode } from '../hooks/use-source-paths'
import { MappingFieldPicker } from './mapping-field-picker'
import { MappingRow } from './mapping-row'

interface BranchRowProps {
  depth: number
  node: SourceTreeNode
  isOpen: boolean
  onToggleOpen: () => void
  /**
   * Materialize a TOP-LEVEL child mapping by free def pick (only at the payload
   * root, where there is no enclosing mapping to drill a relationship off of).
   */
  onFanOut?: (entityDefinitionId: string) => void
  /**
   * The enclosing mapping's target def — present for a branch INSIDE a mapping.
   * When set, the fan-out becomes a relationship DRILL off this def (§11.1): the
   * child's def is DERIVED from the drilled relationship, never freely picked.
   */
  parentEntityDefinitionId?: string | null
  /** Materialize a related child mapping from a relationship drilled off the parent def. */
  onFanOutRelationship?: (field: ResourceField, ref: FieldReference) => void
  /**
   * No mapping exists anywhere in the tree yet (the wizard's first state). Surfaces
   * a faint "or map separately" hint and forces the fan-out button visible (no
   * hover needed), so a nested object/array reads as a secondary starting point.
   */
  isEmpty?: boolean
  children: React.ReactNode
}

/**
 * An object/array source branch (relationship-linking v3 §11). A passive container
 * by default — its scalar leaves bind onto the enclosing mapping. Fanning it out
 * materializes its own child `DataConnectorMapping`:
 *  - INSIDE a mapping ({@link parentEntityDefinitionId} set) → the TARGET cell carries
 *    the SAME unified {@link MappingFieldPicker} every leaf uses (in 'branch' mode):
 *    drill a relationship off the parent def and select it; the related def is derived,
 *    the edge is the drilled relationship, the mode is forced contributing. This makes
 *    a null `relationshipFieldKey` unrepresentable (§9.2) — and the cell now reads
 *    identically to every other row (unified picker §2).
 *  - at the payload ROOT (no enclosing mapping) → a free def pick (the entry def).
 * Once promoted the branch re-renders as a `MappingNode`; this row is the un-promoted
 * state.
 */
export function BranchRow({
  depth,
  node,
  isOpen,
  onToggleOpen,
  onFanOut,
  parentEntityDefinitionId,
  onFanOutRelationship,
  isEmpty = false,
  children,
}: BranchRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isArray = node.type === 'array'
  const Icon = isArray ? Brackets : Braces

  // Relationship-drill mode when this branch sits inside a mapping with a target def.
  const drillMode = !!parentEntityDefinitionId && !!onFanOutRelationship

  return (
    <MappingRow
      depth={depth}
      expandable
      chevronOnHover
      isOpen={isOpen}
      onToggleOpen={onToggleOpen}
      icon={<Icon className='size-3.5 text-muted-foreground/60' />}
      title={
        <span className='flex items-center gap-1.5 text-sm text-muted-foreground'>
          <span className='font-mono'>{lastSegment(node.path)}</span>
          <span className='text-[10px] uppercase opacity-60'>{node.type}</span>
          {isEmpty && (
            <span className='text-[11px] text-muted-foreground/40'>· or map separately</span>
          )}
        </span>
      }
      // Inside a mapping the TARGET cell carries the unified picker (drill a
      // relationship → fan out a related record), with the arrow filled like every
      // other row. At the payload ROOT (no def to drill off) the only action is the
      // free-def fan-out, kept in the last column.
      arrow={drillMode ? 'dim' : 'none'}
      target={
        drillMode ? (
          <MappingFieldPicker
            kind='branch'
            entityDefinitionId={parentEntityDefinitionId!}
            allowRelationships
            placeholder='Link a record…'
            onSelectRelationship={(field, ref) => onFanOutRelationship?.(field, ref)}
          />
        ) : undefined
      }
      actions={
        !drillMode &&
        onFanOut && (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <TreeRowButton tooltipText='Fan out → own def' persistent={isEmpty}>
                <Plus />
              </TreeRowButton>
            </PopoverTrigger>
            <PopoverContent align='end' className='w-72 p-0'>
              <div className='border-b px-2 py-1.5 text-[10px] font-medium uppercase text-muted-foreground'>
                Fan out → own def
              </div>
              <ResourcePickerContent
                value={[]}
                onChange={() => {}}
                onSelectSingle={(entityDefinitionId) => {
                  onFanOut?.(entityDefinitionId)
                  setMenuOpen(false)
                }}
                entityDefinedOnly
                placeholder='Search entity definitions…'
              />
            </PopoverContent>
          </Popover>
        )
      }>
      {children}
    </MappingRow>
  )
}
