// apps/web/src/components/evals/ui/eval-tool-responses.tsx
'use client'

import { scaffoldFromJsonSchema, type ToolCatalogEntry } from '@auxx/lib/agents/client'
import type { AgentEvalTarget, SimulationToolMock } from '@auxx/types/evals'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils'
import { Plus, Sparkles, Trash2, Wand2, Wrench } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { CodeEditor, CodeLanguage } from '~/components/workflow/ui/code-editor'
import { api } from '~/trpc/react'
import { type EditorToolGroup, useToolGroups } from '../hooks/use-tool-groups'
import { ToolSelect } from './tool-select'

/**
 * The load-bearing case-editor section: per-tool mock responses, grouped by
 * toolset. The displayed set is **baseline ∪ added ∪ mocked**, drawn from the
 * enriched unified catalog (`useToolGroups`): the baseline is the agent's draft
 * toolsets, "Add tool" surfaces any installed tool so a mock can be authored
 * for a tool the agent doesn't have YET (forward-looking — the row persists
 * once a response is authored, since mocks key by `toolName`), and a mocked
 * tool outside the baseline always renders its row. The catalog defines icons
 * per toolset (never per tool), so the icon belongs to a group header and the
 * rows beneath read as members. A tool with a declared `exampleOutput` is on
 * its live default (the runtime returns the example when no literal mock
 * matches — see plans/evals/live-tool-default-mocks-plan.md): the row shows a
 * read-only preview with an Override button that pins an editable literal
 * seeded from the current live value, and Reset to default drops the literal
 * again. Tools without an example seed from a client-side JSON-Schema scaffold
 * (`scaffoldFromJsonSchema` over `outputsJsonSchema`). Literal output validates
 * against the server's Zod `outputSchema` on edit. One `repeat` response per
 * tool in v1 (arg-matched multi-response is a follow-up).
 *
 * `control` tools never reach the catalog; `system` (platform read) toolsets
 * sort to the bottom and collapse by default. See
 * plans/mcp/v4/tool-catalog-unification.md and tool-visibility-plan.md.
 */

type ToolEntry = ToolCatalogEntry

/**
 * Tool names referenced by `tool:<name>` chips anywhere in a procedure's draft.
 * A generic deep walk over every nested value — NOT just `content` — because the
 * persisted draft keeps subprocedures (and code blocks / local attrs) in sibling
 * top-level keys, so a content-only walk would miss tool chips authored inside a
 * subprocedure. Visiting every object value + array element catches references
 * regardless of where they nest. Pure; non-object leaves are ignored.
 */
function collectDocToolNames(doc: unknown): string[] {
  const names = new Set<string>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (!node || typeof node !== 'object') return
    const n = node as { type?: unknown; attrs?: { id?: unknown } }
    if (
      n.type === 'reference' &&
      typeof n.attrs?.id === 'string' &&
      n.attrs.id.startsWith('tool:')
    ) {
      const name = n.attrs.id.slice('tool:'.length)
      if (name) names.add(name)
    }
    for (const value of Object.values(node as Record<string, unknown>)) visit(value)
  }
  visit(doc)
  return [...names]
}

interface EvalToolResponsesProps {
  agentId: string
  /** Drives the baseline: a procedure case scopes the list to that procedure's
   * referenced tools; an agent case shows the full toolset. */
  target: AgentEvalTarget
  mocks: SimulationToolMock[]
  onChange: (mocks: SimulationToolMock[]) => void
}

export function EvalToolResponses({ agentId, target, mocks, onChange }: EvalToolResponsesProps) {
  // Session-only "Add tool" rows. An added tool with no authored response
  // vanishes on reload; once a response is authored it persists as a normal
  // mock and re-renders via the mocked branch of the display union.
  const [addedTools, setAddedTools] = useState<string[]>([])
  const extraToolNames = useMemo(
    () => [...addedTools, ...mocks.map((m) => m.toolName)],
    [addedTools, mocks]
  )
  // Procedure-scoped cases mock only the tools that procedure (and its
  // subprocedures) reference; agent-scoped cases keep the full toolset. The
  // live draft doc comes from `procedure.getById` — React Query serves it from
  // cache when the builder already has this procedure loaded (no extra round
  // trip) and it reflects the autosaved draft the user is editing.
  const procedureId = target.scope === 'procedure' ? target.procedureId : null
  const procedureQuery = api.procedure.getById.useQuery(
    { id: procedureId ?? '' },
    { enabled: procedureId !== null }
  )
  const procedureToolNames = useMemo(
    () => (procedureId === null ? null : collectDocToolNames(procedureQuery.data?.draftDoc)),
    [procedureId, procedureQuery.data?.draftDoc]
  )

  const {
    groups,
    ungroupedTools,
    allTools,
    isLoading: isLoadingGroups,
  } = useToolGroups(agentId, { extraToolNames, procedureToolNames })
  const isLoading = isLoadingGroups || (procedureId !== null && procedureQuery.isLoading)
  // `null` ⇒ uninitialized: fall back to the default-open group. Once the user
  // toggles anything, the explicit set takes over.
  const [openGroups, setOpenGroups] = useState<Set<string> | null>(null)
  const [openTool, setOpenTool] = useState<string | null>(null)

  const hasMock = (toolName: string) => mocks.some((m) => m.toolName === toolName)
  // On its live default: no literal mock, but the tool declares an example the
  // runtime will return.
  const isDefault = (tool: ToolEntry) => !hasMock(tool.name) && tool.exampleOutput !== undefined

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

  // "Add tool": the full catalog minus already-displayed rows. Selecting adds
  // the row, expands its group, and opens the response editor.
  const displayedNames = useMemo(() => {
    const names = new Set(ungroupedTools.map((t) => t.name))
    for (const group of groups) for (const t of group.tools) names.add(t.name)
    return names
  }, [groups, ungroupedTools])
  const addOptions = useMemo(
    () =>
      allTools
        .filter((t) => !displayedNames.has(t.name))
        .map((t) => ({
          value: t.name,
          label: t.displayName,
          icon: t.iconId,
          iconColor: t.color || undefined,
        })),
    [allTools, displayedNames]
  )
  const addTool = (name: string) => {
    setAddedTools((prev) => (prev.includes(name) ? prev : [...prev, name]))
    const slug = allTools.find((t) => t.name === name)?.toolsetSlug
    if (slug) {
      setOpenGroups((prev) => {
        const base = prev ?? new Set(defaultOpenSlug ? [defaultOpenSlug] : [])
        return new Set([...base, slug])
      })
    }
    setOpenTool(name)
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
    <Section
      title='Tool responses'
      icon={<Wrench className='size-4' />}
      actions={
        addOptions.length > 0 ? (
          <ToolSelect options={addOptions} value='' onChange={addTool}>
            <Button variant='ghost' size='xs'>
              <Plus />
              Add tool
            </Button>
          </ToolSelect>
        ) : undefined
      }>
      {isLoading || isEmpty ? (
        <EmptySection
          icon={<Wrench className='size-4' />}
          title={isLoading ? 'Loading tools…' : 'No tools to mock'}
          description={isLoading ? undefined : 'This agent has no tools — add one to mock it.'}
          loading={isLoading}
        />
      ) : (
        <div className='space-y-0.5'>
          {groups.map((group) => (
            <ToolGroupRow
              key={group.slug}
              group={group}
              mockedCount={group.tools.filter((t) => hasMock(t.name)).length}
              defaultCount={group.tools.filter(isDefault).length}
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
              defaultCount={ungroupedTools.filter(isDefault).length}
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
  /** Tools on their live default (example, no literal mock). */
  defaultCount: number
  /** Override the denominator (the "Other" bucket isn't a real toolset). */
  total?: number
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}

function ToolGroupRow({
  group,
  mockedCount,
  defaultCount,
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
          {mockedCount} mocked{defaultCount > 0 ? ` · ${defaultCount} default` : ''} / {count}
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

  const hasExample = tool.exampleOutput !== undefined
  // Empty-but-correctly-shaped seed, derived at render time from the entry's
  // JSON Schema — never stored. Tools without a schema author freely.
  const scaffold = useMemo(
    () => (hasExample ? undefined : scaffoldFromJsonSchema(tool.outputsJsonSchema)),
    [hasExample, tool.outputsJsonSchema]
  )
  const seedScaffold = scaffold !== undefined && scaffold !== null
  // No literal mock + a declared example ⇒ the runtime serves the live default.
  const onDefault = !mock && hasExample

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

  // Drop the literal mock AND the local draft — `draft` alone keeps the editor
  // mounted, so without clearing it the row never returns to the default view.
  const clearMock = () => {
    setDraft('')
    setParseError(null)
    setValidation(null)
    onRemove()
  }

  const status = mock
    ? hasExample
      ? 'override'
      : 'mocked'
    : hasExample
      ? 'default'
      : 'no response'

  return (
    <TreeRow
      depth={1}
      icon={<span className='size-1.5 rounded-full bg-muted-foreground/40' />}
      title={tool.displayName}
      secondary={
        <span className='flex items-center gap-1.5 text-xs'>
          <span
            className={cn(
              mock ? 'text-green-600' : hasExample ? 'text-blue-600' : 'text-muted-foreground'
            )}>
            {status}
          </span>
          {tool.idempotent ? <span className='text-muted-foreground/70'>· read-only</span> : null}
        </span>
      }
      expandable
      isOpen={isOpen}
      onToggleOpen={onToggle}
      actions={
        mock ? (
          <TreeRowButton
            variant='destructive'
            tooltipText={hasExample ? 'Reset to default' : 'Clear response'}
            onClick={clearMock}>
            <Trash2 />
          </TreeRowButton>
        ) : undefined
      }>
      <div className='space-y-2 py-1.5 pe-2 ps-12'>
        {onDefault ? (
          <>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-xs text-muted-foreground'>
                Tool default (live) — stays in sync with the tool's example
              </span>
              <Button variant='outline' size='xs' onClick={() => seed(tool.exampleOutput)}>
                <Sparkles />
                Override
              </Button>
            </div>
            <CodeEditor
              language={CodeLanguage.json}
              value={JSON.stringify(tool.exampleOutput, null, 2)}
              readOnly
              minHeight={120}
            />
          </>
        ) : (
          <>
            {!mock && draft.trim() === '' ? (
              <div className='flex flex-wrap items-center gap-2'>
                {seedScaffold ? (
                  <Button variant='outline' size='xs' onClick={() => seed(scaffold)}>
                    <Wand2 />
                    Scaffold
                  </Button>
                ) : null}
                <Button variant='ghost' size='xs' onClick={() => applyDraft('{}')}>
                  Start blank
                </Button>
              </div>
            ) : null}

            {mock && hasExample ? (
              <div className='flex items-center justify-between gap-2'>
                <span className='text-xs text-muted-foreground'>Override (pinned)</span>
                <Button variant='ghost' size='xs' onClick={clearMock}>
                  Reset to default
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
          </>
        )}
      </div>
    </TreeRow>
  )
}
