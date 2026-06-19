// apps/web/src/components/data-connectors/ui/branch-row.tsx
'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import TreeRow, { TreeRowButton } from '@auxx/ui/components/tree-row'
import { Braces, Brackets, ChevronLeft, GitFork, Link2, Plus } from 'lucide-react'
import { useState } from 'react'
import { ResourcePickerContent } from '~/components/pickers/resource-picker'
import { lastSegment, type SourceTreeNode } from '../hooks/use-source-paths'

interface BranchRowProps {
  depth: number
  node: SourceTreeNode
  isOpen: boolean
  onToggleOpen: () => void
  /** Materialize a child mapping that upserts records under this branch. */
  onFanOut: (entityDefinitionId: string) => void
  /** Materialize a reference-only child mapping resolved against the picked def. */
  onReference: (entityDefinitionId: string) => void
  children: React.ReactNode
}

/**
 * An object/array source branch (plan §3.1, §5.3). A passive container by
 * default — its scalar leaves bind onto the enclosing mapping. The `⊕` action
 * menu promotes the branch into its own child `DataConnectorMapping`: **Fan out
 * → own def** (upsert) or **Reference existing** (link-only). Once promoted the
 * branch re-renders as a `MappingNode`; this row is the un-promoted state.
 */
export function BranchRow({
  depth,
  node,
  isOpen,
  onToggleOpen,
  onFanOut,
  onReference,
  children,
}: BranchRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  // Two-step: pick an action, then pick the target def via the ResourcePicker.
  const [mode, setMode] = useState<'fanOut' | 'reference' | null>(null)
  const isArray = node.type === 'array'
  const Icon = isArray ? Brackets : Braces

  const close = () => {
    setMenuOpen(false)
    setMode(null)
  }
  const handlePick = (entityDefinitionId: string) => {
    if (mode === 'fanOut') onFanOut(entityDefinitionId)
    else if (mode === 'reference') onReference(entityDefinitionId)
    close()
  }

  return (
    <TreeRow
      depth={depth}
      expandable
      isOpen={isOpen}
      onToggleOpen={onToggleOpen}
      icon={<Icon className='size-3.5 text-muted-foreground/60' />}
      title={
        <span className='flex items-center gap-1.5 text-sm text-muted-foreground'>
          <span className='font-mono'>{lastSegment(node.path)}</span>
          <span className='text-[10px] uppercase opacity-60'>{node.type}</span>
        </span>
      }
      trailing={
        <Popover open={menuOpen} onOpenChange={(o) => (o ? setMenuOpen(true) : close())}>
          <PopoverTrigger asChild>
            <TreeRowButton tooltipText='Fan out or reference this branch'>
              <Plus />
            </TreeRowButton>
          </PopoverTrigger>
          <PopoverContent align='end' className='w-64 p-0'>
            {mode ? (
              <>
                <button
                  type='button'
                  onClick={() => setMode(null)}
                  className='flex w-full items-center gap-1 border-b px-2 py-1.5 text-left text-[10px] font-medium uppercase text-muted-foreground hover:text-foreground'>
                  <ChevronLeft className='size-3' />
                  {mode === 'fanOut' ? 'Fan out → own def' : 'Reference existing'}
                </button>
                <ResourcePickerContent
                  value={[]}
                  onChange={() => {}}
                  onSelectSingle={handlePick}
                  placeholder='Search entity definitions…'
                />
              </>
            ) : (
              <div className='flex flex-col p-1'>
                <ActionButton
                  icon={<GitFork className='size-3.5' />}
                  label='Fan out → own def'
                  hint='New child records (upsert)'
                  onClick={() => setMode('fanOut')}
                />
                <ActionButton
                  icon={<Link2 className='size-3.5' />}
                  label='Reference existing'
                  hint='Link only, no writes'
                  onClick={() => setMode('reference')}
                />
              </div>
            )}
          </PopoverContent>
        </Popover>
      }>
      {children}
    </TreeRow>
  )
}

function ActionButton({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-primary-50'>
      <span className='mt-0.5 text-muted-foreground'>{icon}</span>
      <span className='flex flex-col'>
        <span className='text-sm'>{label}</span>
        <span className='text-[11px] text-muted-foreground'>{hint}</span>
      </span>
    </button>
  )
}
