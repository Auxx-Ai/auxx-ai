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
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { CodeEditor, CodeLanguage } from '~/components/workflow/ui/code-editor'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { type EditorToolGroup, useToolGroups } from '../hooks/use-tool-groups'

/**
 * The load-bearing case-editor section: per-tool mock responses over the agent's
 * EFFECTIVE toolset, grouped by toolset. The catalog defines icons per toolset
 * (never per tool), so the icon belongs to a group header and the rows beneath
 * read as members — entity-read tools no longer render the same icon N times.
 * Each tool seeds from its declared `exampleOutput`, falls back to a schema
 * scaffold, and validates against `outputSchema` on edit. One `repeat` response
 * per tool in v1 (arg-matched multi-response is a follow-up).
 *
 * `control` tools are dropped server-side; `system` (platform read) toolsets sort
 * to the bottom and collapse by default. See plans/evals/tool-responses-grouping.md
 * and tool-visibility-plan.md.
 */

type ToolEntry = RouterOutputs['eval']['agentToolset']['tools'][number]

interface EvalToolResponsesProps {
  agentId: string
  mocks: SimulationToolMock[]
  onChange: (mocks: SimulationToolMock[]) => void
}

export function EvalToolResponses({ agentId, mocks, onChange }: EvalToolResponsesProps) {
  const { groups, ungroupedTools, isLoading } = useToolGroups(agentId)
  // `null` ⇒ uninitialized: fall back to the default-open group. Once the user
  // toggles anything, the explicit set takes over.
  const [openGroups, setOpenGroups] = useState<Set<string> | null>(null)
  const [openTool, setOpenTool] = useState<string | null>(null)

  const hasMock = (toolName: string) => mocks.some((m) => m.toolName === toolName)

  const upsert = (toolName: string, output: unknown) => {
    const existing = mocks.find((m) => m.toolName === toolName)
    if (existing) {
      onChange(mocks.map((m) => (m.toolName === toolName ? { ...m, output } : m)))
    } else {
      onChange([...mocks, { id: generateId('mock'), toolName, output, usage: 'repeat' }])
    }
  }
  const remove = (toolName: string) => onChange(mocks.filter((m) => m.toolName !== toolName))

  // Default: open the first non-system (capability) group; system groups and the
  // "Other" bucket stay collapsed until the user expands them.
  const defaultOpenSlug = useMemo(() => groups.find((grp) => !grp.isSystem)?.slug ?? null, [groups])

  const isGroupOpen = (slug: string) =>
    openGroups ? openGroups.has(slug) : slug === defaultOpenSlug
  const toggleGroup = (slug: string) => {
    setOpenGroups((prev) => {
      const base = prev ?? new Set(defaultOpenSlug ? [defaultOpenSlug] : [])
      const next = new Set(base)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  const renderTool = (tool: ToolEntry) => (
    <ToolResponseRow
      key={tool.name}
      agentId={agentId}
      tool={tool}
      mock={mocks.find((m) => m.toolName === tool.name) ?? null}
      isOpen={openTool === tool.name}
      onToggle={() => setOpenTool((t) => (t === tool.name ? null : tool.name))}
      onUpsert={(output) => upsert(tool.name, output)}
      onRemove={() => remove(tool.name)}
    />
  )

  const isEmpty = !isLoading && groups.length === 0 && ungroupedTools.length === 0

  return (
    <Section title='Tool responses' icon={<Wrench className='size-4' />}>
      {isLoading || isEmpty ? (
        <EmptySection
          icon={<Wrench className='size-4' />}
          title={isLoading ? 'Loading tools…' : 'No tools to mock'}
          description={isLoading ? undefined : 'This agent has no tools.'}
          loading={isLoading}
        />
      ) : (
        <div className='space-y-0.5'>
          {groups.map((group) => (
            <ToolGroupRow
              key={group.slug}
              group={group}
              mockedCount={group.tools.filter((t) => hasMock(t.name)).length}
              isOpen={isGroupOpen(group.slug)}
              onToggle={() => toggleGroup(group.slug)}>
              {group.tools.map(renderTool)}
            </ToolGroupRow>
          ))}
          {ungroupedTools.length > 0 ? (
            <ToolGroupRow
              group={{
                slug: '__other',
                fullLabel: 'Other',
                iconId: 'wrench',
                color: '',
              }}
              mockedCount={ungroupedTools.filter((t) => hasMock(t.name)).length}
              total={ungroupedTools.length}
              isOpen={isGroupOpen('__other')}
              onToggle={() => toggleGroup('__other')}>
              {ungroupedTools.map(renderTool)}
            </ToolGroupRow>
          ) : null}
        </div>
      )}
    </Section>
  )
}

// ── Toolset group header ─────────────────────────────────────────────────────

interface ToolGroupRowProps {
  group: Pick<EditorToolGroup, 'slug' | 'fullLabel' | 'iconId' | 'color'> & {
    tools?: EditorToolGroup['tools']
  }
  mockedCount: number
  /** Override the denominator (the "Other" bucket isn't a real toolset). */
  total?: number
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}

function ToolGroupRow({
  group,
  mockedCount,
  total,
  isOpen,
  onToggle,
  children,
}: ToolGroupRowProps) {
  const count = total ?? group.tools?.length ?? 0
  return (
    <TreeRow
      icon={<AppIcon iconId={group.iconId} color={group.color || undefined} size='sm' />}
      title={group.fullLabel}
      secondary={
        <span className='text-xs text-muted-foreground'>
          {mockedCount} mocked / {count}
        </span>
      }
      expandable
      isOpen={isOpen}
      onToggleOpen={onToggle}>
      {children}
    </TreeRow>
  )
}

// ── Per-tool row ─────────────────────────────────────────────────────────────

interface ToolResponseRowProps {
  agentId: string
  tool: ToolEntry
  mock: SimulationToolMock | null
  isOpen: boolean
  onToggle: () => void
  onUpsert: (output: unknown) => void
  onRemove: () => void
}

function ToolResponseRow({
  agentId,
  tool,
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
      depth={1}
      icon={<span className='size-1.5 rounded-full bg-muted-foreground/40' />}
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
      <div className='space-y-2 py-1.5 pe-2 ps-12'>
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
