// apps/web/src/components/agents/procedures/ui/procedure-slash-content.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import {
  Calendar,
  CheckSquare,
  Code2,
  CornerDownRight,
  GitBranch,
  Hand,
  Hash,
  Plus,
  Square,
  Type,
  Variable,
  Workflow,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  BASIC_BLOCK_COMMANDS,
  type BlockCommandDef,
  filterBlockCommands,
  runBlockCommand,
} from '~/components/editor/slash-commands/block-commands'
import type {
  SlashCommandItem,
  SlashCommandSection,
} from '~/components/editor/slash-commands/slash-command-picker'
import type { SlashContentProps } from '~/components/editor/slash-commands/slash-content'
import { SlashList } from '~/components/editor/slash-commands/slash-list'
import { useCmdkRemote } from '~/components/pickers/use-cmdk-remote'
import { api } from '~/trpc/react'
import { newConditionBlock } from '../nodes/condition-helpers'
import { useProcedureEditorContext } from './procedure-draft-provider'

/**
 * The procedure editor's `/` content (plan: plans/prose/build-plan.md).
 * Steps first — the five insertions that used to live as `@` tabs — then
 * the generic block commands. Terminal step picks insert an inline badge
 * via `onInsertReference` (the persisted `route:* / code:* / subprocedure:*`
 * badge format is unchanged); `condition` inserts the IF/ELSE block;
 * `attribute` declares a procedure-local `var:*` with no prose insert.
 *
 * Drills (switch target, code pick/create, sub-procedure pick/create,
 * attribute type) are local state mirrored onto the chip sublabel via
 * `onScopeChange` — Backspace on an empty drilled chip pops back to root.
 */

type StepDrill = 'switch' | 'subprocedure' | 'code' | 'attribute'

const DRILL_LABEL: Record<StepDrill, string> = {
  switch: 'Switch to',
  subprocedure: 'Sub-procedure',
  code: 'Code',
  attribute: 'Attribute',
}

/** The curated `dataType` choices the Create-attribute drill offers. */
const ATTRIBUTE_TYPES: { dataType: FieldType; label: string; icon: ReactNode }[] = [
  { dataType: 'TEXT', label: 'Text', icon: <Type className='size-4' /> },
  { dataType: 'NUMBER', label: 'Number', icon: <Hash className='size-4' /> },
  { dataType: 'CHECKBOX', label: 'Checkbox', icon: <CheckSquare className='size-4' /> },
  { dataType: 'DATE', label: 'Date', icon: <Calendar className='size-4' /> },
]

interface StepItem extends SlashCommandItem {
  icon: ReactNode
  run: () => void
}

function iconRow(item: SlashCommandItem & { icon?: ReactNode }) {
  return (
    <div className='flex items-center gap-2'>
      <span className='text-muted-foreground'>{item.icon}</span>
      <span className='truncate'>{item.title}</span>
    </div>
  )
}

export function ProcedureSlashContent({
  ref,
  query,
  allowedBlocks,
  onExecute,
  onInsertReference,
  onScopeChange,
}: SlashContentProps) {
  const ctx = useProcedureEditorContext()
  const [drill, setDrill] = useState<StepDrill | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const remote = useCmdkRemote(containerRef, `${drill ?? 'root'}:${query}`)

  const enterDrill = useCallback(
    (d: StepDrill) => {
      setDrill(d)
      onScopeChange(DRILL_LABEL[d])
    },
    [onScopeChange]
  )

  const popDrill = useCallback(() => {
    if (!drill) return false
    setDrill(null)
    onScopeChange(null)
    return true
  }, [drill, onScopeChange])

  useImperativeHandle(ref, () => ({ ...remote, popLevel: popDrill }), [remote, popDrill])

  // Switch-target list — only fetched once the picker renders; cheap and
  // cached by react-query across opens.
  const procedureList = api.procedure.list.useQuery()

  const rootSections = useMemo<SlashCommandSection<SlashCommandItem>[]>(() => {
    const steps: StepItem[] = [
      {
        id: 'route-finished',
        title: 'End procedure',
        keywords: ['finish', 'stop', 'done', 'route'],
        icon: <Square className='size-4' />,
        run: () => onInsertReference('route:finished'),
      },
      {
        id: 'route-handoff',
        title: 'Hand off to human',
        keywords: ['handoff', 'escalate', 'human', 'route'],
        icon: <Hand className='size-4' />,
        run: () => onInsertReference('route:handoff'),
      },
      {
        id: 'route-switch',
        title: 'Switch to procedure…',
        keywords: ['switch', 'goto', 'route', 'procedure'],
        icon: <CornerDownRight className='size-4' />,
        drillDown: true,
        run: () => enterDrill('switch'),
      },
      {
        id: 'subprocedure',
        title: 'Sub-procedure…',
        keywords: ['sub', 'subprocedure', 'reusable', 'call'],
        icon: <Workflow className='size-4' />,
        drillDown: true,
        run: () => enterDrill('subprocedure'),
      },
      {
        id: 'code',
        title: 'Code block…',
        keywords: ['code', 'script', 'javascript'],
        icon: <Code2 className='size-4' />,
        drillDown: true,
        run: () => enterDrill('code'),
      },
      {
        id: 'condition',
        title: 'Condition (IF / ELSE)',
        keywords: ['if', 'else', 'branch', 'condition'],
        icon: <GitBranch className='size-4' />,
        run: () => ctx?.insertBlock(newConditionBlock()),
      },
      {
        id: 'attribute',
        title: 'Create attribute…',
        keywords: ['attribute', 'variable', 'var', 'field'],
        icon: <Variable className='size-4' />,
        drillDown: true,
        run: () => enterDrill('attribute'),
      },
    ]

    const stepsSection: SlashCommandSection<SlashCommandItem> = {
      id: 'steps',
      heading: 'Steps',
      items: ctx ? steps : [],
      onSelect: (item) => (item as StepItem).run(),
      renderItem: (item) => iconRow(item as StepItem),
    }

    const blocksSection: SlashCommandSection<SlashCommandItem> = {
      id: 'blocks',
      heading: 'Blocks',
      items: filterBlockCommands(BASIC_BLOCK_COMMANDS, allowedBlocks),
      onSelect: (item) => onExecute(runBlockCommand(item as BlockCommandDef)),
    }

    return [stepsSection, blocksSection]
  }, [ctx, allowedBlocks, enterDrill, onExecute, onInsertReference])

  const drilledSections = useMemo<SlashCommandSection<SlashCommandItem>[]>(() => {
    if (!drill || !ctx) return []

    if (drill === 'switch') {
      const items: StepItem[] = (procedureList.data ?? []).map((p) => ({
        id: `switch-${p.id}`,
        title: p.name,
        icon: <CornerDownRight className='size-4' />,
        run: () => onInsertReference(`route:switch:${p.id}`),
      }))
      return [
        {
          id: 'switch',
          heading: 'Switch to',
          items,
          onSelect: (item) => (item as StepItem).run(),
          renderItem: (item) => iconRow(item as StepItem),
        },
      ]
    }

    if (drill === 'subprocedure' || drill === 'code') {
      const isSub = drill === 'subprocedure'
      const existing = isSub ? ctx.subProcedures : ctx.codeBlocks
      const items: StepItem[] = existing.map((entry) => ({
        id: `${drill}-${entry.id}`,
        title: entry.name,
        icon: isSub ? <Workflow className='size-4' /> : <Code2 className='size-4' />,
        run: () => onInsertReference(`${drill}:${entry.id}`),
      }))
      // The create row's title embeds the query so it survives the list
      // filter regardless of what's typed.
      const createLabel = isSub ? 'sub-procedure' : 'code block'
      items.push({
        id: `${drill}-create`,
        title: query.trim() ? `Create ${createLabel} “${query.trim()}”` : `Create ${createLabel}`,
        icon: <Plus className='size-4' />,
        run: () => {
          const id = isSub ? ctx.createSubProcedure(query) : ctx.createCodeBlock(query)
          onInsertReference(`${drill}:${id}`)
          ctx.openDrill(isSub ? `sub:${id}` : `code:${id}`)
        },
      })
      return [
        {
          id: drill,
          heading: isSub ? 'Sub-procedures' : 'Code',
          items,
          onSelect: (item) => (item as StepItem).run(),
          renderItem: (item) => iconRow(item as StepItem),
        },
      ]
    }

    // drill === 'attribute' — the typed query IS the attribute name; each
    // row picks a dataType. Existing attributes are listed for reference.
    const name = query.trim()
    const taken = ctx.localAttributes.some((a) => a.name === name)
    const items: StepItem[] = []
    if (name && !taken) {
      for (const t of ATTRIBUTE_TYPES) {
        items.push({
          id: `attribute-create-${t.dataType}`,
          title: `Create “${name}” as ${t.label}`,
          icon: t.icon,
          run: () => {
            ctx.addLocalAttribute({ name, dataType: t.dataType })
            ctx.closePicker()
          },
        })
      }
    }
    // Existing attributes (reference only) — filtered here because the
    // attribute drill passes an empty query to SlashList (the create rows
    // must always render).
    const matchingExisting = name
      ? ctx.localAttributes.filter((a) => a.name.toLowerCase().includes(name.toLowerCase()))
      : ctx.localAttributes
    for (const a of matchingExisting) {
      items.push({
        id: `attribute-${a.name}`,
        title: a.name,
        icon: <Variable className='size-4' />,
        run: () => ctx.closePicker(),
      })
    }
    return [
      {
        id: 'attribute',
        heading: name && !taken ? 'Create attribute' : 'Attributes',
        items,
        onSelect: (item) => (item as StepItem).run(),
        renderItem: (item) => iconRow(item as StepItem),
      },
    ]
  }, [drill, ctx, procedureList.data, query, onInsertReference])

  const emptyMessage = !ctx
    ? 'Unavailable'
    : drill === 'attribute' && !query.trim()
      ? 'Type a name to create an attribute…'
      : 'No results found.'

  return (
    <div ref={containerRef}>
      <SlashList
        // Drilled lists already bake the query into their items (create rows)
        // — still pass it so existing entries filter as the user types.
        query={drill === 'attribute' ? '' : query}
        sections={drill ? drilledSections : rootSections}
        emptyMessage={emptyMessage}
        loading={drill === 'switch' && procedureList.isLoading}
      />
    </div>
  )
}
