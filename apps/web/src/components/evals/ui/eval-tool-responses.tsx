// apps/web/src/components/evals/ui/eval-tool-responses.tsx
'use client'

import type { SimulationToolMock } from '@auxx/types/evals'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils'
import { Sparkles, Trash2, Wand2, Wrench } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { CodeEditor, CodeLanguage } from '~/components/workflow/ui/code-editor'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { type ToolIcon, useToolIconMap } from '../hooks/use-tool-icon-map'

/** A tool's catalog icon, falling back to a generic wrench when unknown. */
function ToolIconView({ icon }: { icon?: ToolIcon }) {
  if (!icon?.iconId) return <Wrench className='size-4 text-muted-foreground' />
  return <AppIcon iconId={icon.iconId} color={icon.color || undefined} size='sm' />
}

/**
 * The load-bearing case-editor section: per-tool mock responses over the agent's
 * EFFECTIVE toolset. Each tool seeds from its declared `exampleOutput`, falls
 * back to a schema scaffold, and validates against `outputSchema` on edit. One
 * `repeat` response per tool in v1 (arg-matched multi-response is a follow-up).
 *
 * See plans/evals/ui-plan.md §"Tool responses".
 */

type ToolEntry = RouterOutputs['eval']['agentToolset']['tools'][number]

interface EvalToolResponsesProps {
  agentId: string
  mocks: SimulationToolMock[]
  onChange: (mocks: SimulationToolMock[]) => void
}

export function EvalToolResponses({ agentId, mocks, onChange }: EvalToolResponsesProps) {
  const [openTool, setOpenTool] = useState<string | null>(null)
  const toolsetQuery = api.eval.agentToolset.useQuery({ agentId })
  const iconMap = useToolIconMap()

  const upsert = (toolName: string, output: unknown) => {
    const existing = mocks.find((m) => m.toolName === toolName)
    if (existing) {
      onChange(mocks.map((m) => (m.toolName === toolName ? { ...m, output } : m)))
    } else {
      onChange([...mocks, { id: generateId('mock'), toolName, output, usage: 'repeat' }])
    }
  }
  const remove = (toolName: string) => onChange(mocks.filter((m) => m.toolName !== toolName))

  const tools = toolsetQuery.data?.tools ?? []

  return (
    <Section title='Tool responses' icon={<Wrench className='size-4' />}>
      {toolsetQuery.isLoading || tools.length === 0 ? (
        <EmptySection
          icon={<Wrench className='size-4' />}
          title={toolsetQuery.isLoading ? 'Loading tools…' : 'No tools to mock'}
          description={toolsetQuery.isLoading ? undefined : 'This agent has no tools.'}
          loading={toolsetQuery.isLoading}
        />
      ) : (
        <div className='space-y-0.5'>
          {tools.map((tool) => (
            <ToolResponseRow
              key={tool.name}
              agentId={agentId}
              tool={tool}
              icon={iconMap.get(tool.name)}
              mock={mocks.find((m) => m.toolName === tool.name) ?? null}
              isOpen={openTool === tool.name}
              onToggle={() => setOpenTool((t) => (t === tool.name ? null : tool.name))}
              onUpsert={(output) => upsert(tool.name, output)}
              onRemove={() => remove(tool.name)}
            />
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Per-tool row ─────────────────────────────────────────────────────────────

interface ToolResponseRowProps {
  agentId: string
  tool: ToolEntry
  icon?: ToolIcon
  mock: SimulationToolMock | null
  isOpen: boolean
  onToggle: () => void
  onUpsert: (output: unknown) => void
  onRemove: () => void
}

function ToolResponseRow({
  agentId,
  tool,
  icon,
  mock,
  isOpen,
  onToggle,
  onUpsert,
  onRemove,
}: ToolResponseRowProps) {
  const utils = api.useUtils()
  const [draft, setDraft] = useState(() => (mock ? JSON.stringify(mock.output, null, 2) : ''))
  const [parseError, setParseError] = useState<string | null>(null)
  const [validation, setValidation] = useState<{ error?: string; warning?: string } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const seedExample = tool.example !== undefined
  const seedScaffold = !seedExample && tool.scaffold !== undefined && tool.scaffold !== null

  const applyDraft = (text: string) => {
    setDraft(text)
    if (text.trim() === '') {
      setParseError(null)
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setParseError('Invalid JSON')
      return
    }
    setParseError(null)
    onUpsert(parsed)

    // Debounced schema validation against the tool's declared outputSchema.
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void utils.eval.validateMock
        .fetch({ agentId, toolName: tool.name, output: parsed })
        .then((res) => setValidation(res.ok ? { warning: res.warning } : { error: res.error }))
        .catch(() => setValidation(null))
    }, 500)
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const seed = (value: unknown) => {
    const text = JSON.stringify(value, null, 2)
    applyDraft(text)
  }

  return (
    <TreeRow
      icon={<ToolIconView icon={icon} />}
      title={tool.displayName}
      secondary={
        <span className='flex items-center gap-1.5 text-xs'>
          <span className={cn(mock ? 'text-green-600' : 'text-muted-foreground')}>
            {mock ? 'mocked' : 'no response'}
          </span>
          {mock && tool.example !== undefined ? (
            <span className='text-muted-foreground/70'>(example)</span>
          ) : null}
          {tool.idempotent ? <span className='text-muted-foreground/70'>· read-only</span> : null}
        </span>
      }
      expandable
      isOpen={isOpen}
      onToggleOpen={onToggle}
      actions={
        mock ? (
          <TreeRowButton variant='destructive' tooltipText='Clear response' onClick={onRemove}>
            <Trash2 />
          </TreeRowButton>
        ) : undefined
      }>
      <div className='space-y-2 px-2 py-1.5'>
        {!mock && draft.trim() === '' ? (
          <div className='flex flex-wrap items-center gap-2'>
            {seedExample ? (
              <Button variant='outline' size='xs' onClick={() => seed(tool.example)}>
                <Sparkles />
                From example
              </Button>
            ) : null}
            {seedScaffold ? (
              <Button variant='outline' size='xs' onClick={() => seed(tool.scaffold)}>
                <Wand2 />
                Scaffold
              </Button>
            ) : null}
            <Button variant='ghost' size='xs' onClick={() => applyDraft('{}')}>
              Start blank
            </Button>
          </div>
        ) : null}

        {draft.trim() !== '' || mock ? (
          <CodeEditor
            language={CodeLanguage.json}
            value={draft}
            onChange={applyDraft}
            minHeight={120}
            placeholder='{}'
          />
        ) : null}

        {parseError ? (
          <Alert variant='bad'>
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        ) : validation?.error ? (
          <Alert variant='bad'>
            <AlertDescription>{validation.error}</AlertDescription>
          </Alert>
        ) : validation?.warning ? (
          <p className='text-xs text-muted-foreground'>{validation.warning}</p>
        ) : null}
      </div>
    </TreeRow>
  )
}
