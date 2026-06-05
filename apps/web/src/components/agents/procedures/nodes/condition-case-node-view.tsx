// apps/web/src/components/agents/procedures/nodes/condition-case-node-view.tsx
'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { GitBranch, X } from 'lucide-react'
import { ConditionContainer, ConditionProvider } from '~/components/conditions'
import { useConfirm } from '~/hooks/use-confirm'
import { useProcedureConditionConfig } from '../hooks/use-procedure-condition-config'
import { useProcedureEditorContext } from '../ui/procedure-draft-provider'
import { applyBlockMode, findParentBlock, nodePos, switchLosesData } from './condition-helpers'

/**
 * `conditionCase` view — one IF / ELSE-IF arm. The gutter badge + keyword reflect
 * the arm's POSITION (first = IF, later = ELSE IF). The predicate is dual-mode
 * (plan §4): a `Text`/`Rules` toggle flips `mode`. In `text` mode the leading
 * `conditionPredicate` child (rendered inside {@link NodeViewContent}) is the
 * writer; in `structured` mode the {@link ConditionProvider} builder binds to the
 * `group` attr (and the predicate child hides itself). The body is the arm's
 * `block+` content, rendered after the predicate in the same content hole.
 */
export function ConditionCaseNodeView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const ctx = useProcedureEditorContext()
  const [confirm, ConfirmDialog] = useConfirm()
  const mode = (node.attrs.mode as string) ?? 'text'
  const { config, getAvailableFields, getFieldDefinition } = useProcedureConditionConfig(
    ctx?.localAttributes ?? [],
    true
  )

  // The toggle is rendered per-arm but writes the PARENT block's `mode` and
  // mirrors it onto every arm (decision D1 — flip one → all flip). Gated by a
  // confirm when authored data in the current mode would be left unused.
  const changeMode = async (next: 'text' | 'structured') => {
    if (next === mode) return
    const parent = findParentBlock(editor, getPos)
    if (!parent) {
      updateAttributes({ mode: next }) // fallback: at least flip this arm
      return
    }
    if (switchLosesData(parent.node, next)) {
      const ok = await confirm({
        title: 'Switch condition mode?',
        description:
          next === 'structured'
            ? 'All branches switch to Rules. The text predicates you wrote stay saved but are ignored until you switch back.'
            : 'All branches switch to Text. The rules you built stay saved but are ignored until you switch back.',
        confirmText: 'Switch',
        cancelText: 'Cancel',
      })
      if (!ok) return
    }
    applyBlockMode(editor, parent.pos, next)
  }

  const ordinal = (() => {
    const pos = nodePos(getPos)
    if (pos == null) return 0
    try {
      return editor.state.doc.resolve(pos).index()
    } catch {
      return 0
    }
  })()

  const group: ConditionGroup =
    (node.attrs.group as ConditionGroup | null) ??
    ({ id: generateId(), conditions: [], logicalOperator: 'AND' } as ConditionGroup)

  const onGroupsChange = (groups: ConditionGroup[]) => {
    updateAttributes({ group: groups[0] ?? group })
  }

  const removeArm = () => {
    const pos = nodePos(getPos)
    if (pos == null) return
    // Removing the last IF/ELSE-IF arm would leave the block with no case (the
    // schema requires `(conditionCase | conditionElse)+`, and an else-only block
    // is meaningless), so deleting just the arm no-ops. Delete the whole block.
    const parent = findParentBlock(editor, getPos)
    if (parent) {
      let caseCount = 0
      parent.node.forEach((child) => {
        if (child.type.name === 'conditionCase') caseCount++
      })
      if (caseCount <= 1) {
        editor
          .chain()
          .focus()
          .deleteRange({ from: parent.pos, to: parent.pos + parent.node.nodeSize })
          .run()
        return
      }
    }
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run()
  }

  return (
    <NodeViewWrapper as='div' className='my-1.5'>
      <div className='flex items-center gap-2' contentEditable={false}>
        <span className='flex size-6 shrink-0 items-center justify-center rounded-md bg-primary-100 text-primary-700'>
          <GitBranch className='size-3.5' />
        </span>
        <span className='text-xs font-semibold uppercase tracking-wide text-foreground'>
          {ordinal === 0 ? 'If' : 'Else if'}
        </span>
        <div className='ml-auto flex items-center gap-1'>
          <ModeToggle mode={mode} onChange={changeMode} />
          <button
            type='button'
            onClick={removeArm}
            aria-label='Remove branch'
            className='rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive'>
            <X className='size-3.5' />
          </button>
        </div>
      </div>

      <div className='pl-8'>
        {mode === 'structured' && (
          <div className='my-1.5' contentEditable={false}>
            <ConditionProvider
              conditions={group.conditions}
              groups={[group]}
              config={config}
              onConditionsChange={() => {}}
              onGroupsChange={onGroupsChange}
              getAvailableFields={getAvailableFields}
              getFieldDefinition={getFieldDefinition}>
              <ConditionContainer showAddButton emptyStateText='Add a condition' />
            </ConditionProvider>
          </div>
        )}
        <NodeViewContent />
      </div>
      <ConfirmDialog />
    </NodeViewWrapper>
  )
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: string
  onChange: (mode: 'text' | 'structured') => void
}) {
  return (
    <div
      className='flex items-center rounded-md border border-border p-0.5 text-[11px]'
      contentEditable={false}>
      {(['text', 'structured'] as const).map((m) => (
        <button
          key={m}
          type='button'
          onClick={() => onChange(m)}
          className={cn(
            'rounded px-1.5 py-0.5 font-medium',
            mode === m ? 'bg-primary-100 text-primary-700' : 'text-muted-foreground'
          )}>
          {m === 'text' ? 'Text' : 'Rules'}
        </button>
      ))}
    </div>
  )
}
