// apps/web/src/components/evals/ui/assertions-section.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { AgentEvalAssertion } from '@auxx/types/evals'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { generateId } from '@auxx/utils'
import { Ban, Flag, ListChecks, MessageSquareText, Plus, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { useToolGroups } from '../hooks/use-tool-groups'
import { ToolSelect } from './tool-select'

const OUTCOME_OPTIONS = [
  { value: 'finished', label: 'Finished' },
  { value: 'handoff', label: 'Handoff' },
  { value: 'switch', label: 'Switch' },
]

interface AssertionsSectionProps {
  agentId: string
  scope: 'agent' | 'procedure'
  assertions: AgentEvalAssertion[]
  onChange: (next: AgentEvalAssertion[]) => void
}

export function AssertionsSection({ agentId, assertions, onChange }: AssertionsSectionProps) {
  // The FULL unified tool catalog (shared with the Tool responses section via
  // `useToolGroups`) — assertions may target any installed tool, matching the
  // editor's "Add tool" forward-authoring (e.g. assert `tool_not_called` on a
  // tool outside the agent's current toolset). We show only the tool's display
  // name; the catalog icon carries the toolset context.
  const { allTools } = useToolGroups(agentId)
  const toolOptions = useMemo(
    () =>
      allTools.map((t) => ({
        value: t.name,
        label: t.displayName,
        icon: t.iconId,
        iconColor: t.color || undefined,
      })),
    [allTools]
  )

  const add = (a: AgentEvalAssertion) => onChange([...assertions, a])
  const remove = (id: string) => onChange(assertions.filter((a) => a.id !== id))
  const patch = (id: string, next: AgentEvalAssertion) =>
    onChange(assertions.map((a) => (a.id === id ? next : a)))

  return (
    <Section
      title='Assertions'
      collapsible={false}
      className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='xs'>
              <Plus />
              Add assertion
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem
              onClick={() =>
                add({
                  id: generateId('asrt'),
                  type: 'terminal_outcome',
                  data: { outcome: 'finished' },
                })
              }>
              {ASSERTION_META.terminal_outcome.icon}
              {ASSERTION_META.terminal_outcome.label}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                add({ id: generateId('asrt'), type: 'response_criteria', data: { criteria: [] } })
              }>
              {ASSERTION_META.response_criteria.icon}
              {ASSERTION_META.response_criteria.label}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                add({ id: generateId('asrt'), type: 'tool_called', data: { toolName: '' } })
              }>
              {ASSERTION_META.tool_called.icon}
              {ASSERTION_META.tool_called.label}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                add({ id: generateId('asrt'), type: 'tool_not_called', data: { toolName: '' } })
              }>
              {ASSERTION_META.tool_not_called.icon}
              {ASSERTION_META.tool_not_called.label}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }>
      <div className='flex flex-col ps-2 pe-4'>
        {assertions.length === 0 ? (
          <EmptySection
            icon={<ListChecks className='size-4' />}
            title='No assertions yet'
            description='A case must assert at least one outcome before it can pass.'
          />
        ) : (
          <FieldPanel className='p-0'>
            {assertions.map((a) => {
              const meta = ASSERTION_META[a.type]
              return (
                <FieldPanelRow
                  key={a.id}
                  title={meta?.label ?? a.type}
                  description={meta?.description}
                  icon={meta?.icon}
                  showIcon={meta != null}
                  onClear={() => remove(a.id)}>
                  <AssertionEditor
                    assertion={a}
                    toolOptions={toolOptions}
                    onChange={(next) => patch(a.id, next)}
                  />
                </FieldPanelRow>
              )
            })}
          </FieldPanel>
        )}
      </div>
    </Section>
  )
}

/** Label, icon, and hover description for each assertion type in the editor. */
const ASSERTION_META: Record<string, { label: string; description: string; icon: ReactNode }> = {
  terminal_outcome: {
    label: 'Terminal outcome',
    description:
      'How the conversation must end — finished, handed off to a human, or switched to another procedure.',
    icon: <Flag className='size-3.5 text-muted-foreground' />,
  },
  response_criteria: {
    label: 'Response criteria',
    description: "Natural-language criteria the agent's replies must satisfy (LLM-judged).",
    icon: <MessageSquareText className='size-3.5 text-muted-foreground' />,
  },
  tool_called: {
    label: 'Tool called',
    description: 'The agent must call this tool at least once during the run.',
    icon: <Wrench className='size-3.5 text-muted-foreground' />,
  },
  tool_not_called: {
    label: 'Tool not called',
    description: 'The agent must never call this tool during the run.',
    icon: <Ban className='size-3.5 text-muted-foreground' />,
  },
}

function AssertionEditor({
  assertion,
  toolOptions,
  onChange,
}: {
  assertion: AgentEvalAssertion
  toolOptions: { value: string; label: string; icon?: string; iconColor?: string }[]
  onChange: (next: AgentEvalAssertion) => void
}) {
  if (assertion.type === 'terminal_outcome') {
    return (
      <FieldInputAdapter
        fieldType={FieldType.SINGLE_SELECT}
        fieldOptions={{ options: OUTCOME_OPTIONS }}
        triggerProps={{ className: 'w-full ps-0 pe-1' }}
        value={assertion.data.outcome}
        onChange={(v) =>
          onChange({
            ...assertion,
            data: {
              outcome: ((v as string[])[0] as 'finished' | 'handoff' | 'switch') ?? 'finished',
            },
          })
        }
      />
    )
  }
  if (assertion.type === 'response_criteria') {
    return (
      <FieldInputAdapter
        fieldType={FieldType.RICH_TEXT}
        triggerProps={{ className: 'w-full ps-0 pe-1' }}
        value={assertion.data.criteria.join('\n')}
        onChange={(v) =>
          onChange({
            ...assertion,
            data: {
              criteria: ((v as string) ?? '')
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            },
          })
        }
        placeholder='One criterion per line'
      />
    )
  }
  if (assertion.type === 'tool_called' || assertion.type === 'tool_not_called') {
    return (
      <ToolSelect
        options={toolOptions}
        value={assertion.data.toolName}
        onChange={(toolName) => onChange({ ...assertion, data: { ...assertion.data, toolName } })}
      />
    )
  }
  return null
}
