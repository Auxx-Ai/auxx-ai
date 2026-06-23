// apps/web/src/components/data-connectors/ui/branch-row.tsx
'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { GridTreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { Braces, Brackets, Plus } from 'lucide-react'
import { useState } from 'react'
import { ResourcePickerContent } from '~/components/pickers/resource-picker'
import { lastSegment, type SourceTreeNode } from '../hooks/use-source-paths'
import { MAPPING_COLS } from './mapping-columns'

interface BranchRowProps {
  depth: number
  node: SourceTreeNode
  isOpen: boolean
  onToggleOpen: () => void
  /** Materialize a child mapping that upserts records under this branch. */
  onFanOut: (entityDefinitionId: string) => void
  /**
   * No mapping exists anywhere in the tree yet (the wizard's first state). Surfaces
   * a faint "or map separately" hint and forces the fan-out button visible (no
   * hover needed), so a nested object/array reads as a secondary starting point.
   */
  isEmpty?: boolean
  children: React.ReactNode
}

/**
 * An object/array source branch (plan §3.1, §5.3). A passive container by
 * default — its scalar leaves bind onto the enclosing mapping. The `⊕` action
 * promotes the branch into its own child `DataConnectorMapping` (**Fan out →
 * own def**, upsert) against the picked target def. Once promoted the branch
 * re-renders as a `MappingNode`; this row is the un-promoted state.
 *
 * (The reference / link-only fan-out mode stays in the schema + runtime but is
 * not yet surfaced in the UI.)
 */
export function BranchRow({
  depth,
  node,
  isOpen,
  onToggleOpen,
  onFanOut,
  isEmpty = false,
  children,
}: BranchRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isArray = node.type === 'array'
  const Icon = isArray ? Brackets : Braces

  const handlePick = (entityDefinitionId: string) => {
    onFanOut(entityDefinitionId)
    setMenuOpen(false)
  }

  return (
    <GridTreeRow
      columns={MAPPING_COLS}
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
      // A passive container — no arrow/target. The fan-out action sits in the
      // last column, aligned with the other rows' action clusters.
      cells={[
        <span key='arrow' />,
        <span key='target' />,
        <div key='actions' className='flex w-full items-center justify-end pr-1'>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <TreeRowButton tooltipText='Fan out → own def' persistent={isEmpty}>
                <Plus />
              </TreeRowButton>
            </PopoverTrigger>
            <PopoverContent align='end' className='w-64 p-0'>
              <div className='border-b px-2 py-1.5 text-[10px] font-medium uppercase text-muted-foreground'>
                Fan out → own def
              </div>
              <ResourcePickerContent
                value={[]}
                onChange={() => {}}
                onSelectSingle={handlePick}
                entityDefinedOnly
                placeholder='Search entity definitions…'
              />
            </PopoverContent>
          </Popover>
        </div>,
      ]}>
      {children}
    </GridTreeRow>
  )
}
