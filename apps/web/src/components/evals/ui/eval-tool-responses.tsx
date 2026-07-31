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
 * against the server's Zod `outputSchema` on edit.
 *
 * A tool may carry SEVERAL responses, each with an optional `args` matcher
 * (`subset`, where the configured keys must be present and deep-equal, or
 * `exact`). Stored order is match order: the resolver returns the first whose
 * matcher accepts the call, so a matcher-less response shadows everything after
 * it (flagged inline). Without this, a tool could only be pinned to one frozen
 * output for every call, which is why "order 1234 → found, 9999 → not found"
 * previously had to be authored through Kopilot's `update_eval_case_mock`.
 *
 * `control` tools never reach the catalog; `system` (platform read) toolsets
 * sort to the bottom and collapse by default. See
 * plans/mcp/v4/tool-catalog-unification.md and tool-visibility-plan.md.
 */

type ToolEntry = ToolCatalogEntry

/**
 * Does this response fire for every call to its tool?
 *
 * Not just "has no `args`": an `args` matcher whose `value` is `{}` is ALSO a
 * catch-all, because `argsMatch` runs `Object.entries(value).every(...)`, and
 * over no entries that is vacuously true, for `subset` and `exact` alike. Both
 * shapes shadow every response beneath them, so both have to count.
 */
function isCatchAll(mock: SimulationToolMock): boolean {
  return !mock.args || Object.keys(mock.args.value).length === 0
}

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

  const mocksFor = (toolName: string) => mocks.filter((m) => m.toolName === toolName)

  /** Append a new response for a tool. Stored order IS match order. */
  const addMock = (toolName: string, output: unknown, args?: SimulationToolMock['args']) => {
    onChange([
      ...mocks,
      { id: generateId('mock'), toolName, output, usage: 'repeat', ...(args ? { args } : {}) },
    ])
  }
  const patchMock = (mockId: string, patch: Partial<SimulationToolMock>) => {
    onChange(mocks.map((m) => (m.id === mockId ? { ...m, ...patch } : m)))
  }
  const removeMock = (mockId: string) => onChange(mocks.filter((m) => m.id !== mockId))
  const removeAllFor = (toolName: string) => onChange(mocks.filter((m) => m.toolName !== toolName))

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
      mocks={mocksFor(tool.name)}
      isOpen={openTool === tool.name}
      onToggle={() => setOpenTool((t) => (t === tool.name ? null : tool.name))}
      onAdd={(output, args) => addMock(tool.name, output, args)}
      onPatch={patchMock}
      onRemoveMock={removeMock}
      onRemoveAll={() => removeAllFor(tool.name)}
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
          description={isLoading ? undefined : 'This agent has no tools. Add one to mock it.'}
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
  /** Every response authored for this tool, in stored (= match) order. */
  mocks: SimulationToolMock[]
  isOpen: boolean
  onToggle: () => void
  onAdd: (output: unknown, args?: SimulationToolMock['args']) => void
  onPatch: (mockId: string, patch: Partial<SimulationToolMock>) => void
  onRemoveMock: (mockId: string) => void
  onRemoveAll: () => void
}

function ToolResponseRow({
  agentId,
  tool,
  mocks,
  isOpen,
  onToggle,
  onAdd,
  onPatch,
  onRemoveMock,
  onRemoveAll,
}: ToolResponseRowProps) {
  const hasExample = tool.exampleOutput !== undefined
  // Empty-but-correctly-shaped seed, derived at render time from the entry's
  // JSON Schema — never stored. Tools without a schema author freely.
  const scaffold = useMemo(
    () => (hasExample ? undefined : scaffoldFromJsonSchema(tool.outputsJsonSchema)),
    [hasExample, tool.outputsJsonSchema]
  )
  const seedScaffold = scaffold !== undefined && scaffold !== null
  // No literal mock + a declared example ⇒ the runtime serves the live default.
  const onDefault = mocks.length === 0 && hasExample

  const seedValue = hasExample ? tool.exampleOutput : seedScaffold ? scaffold : {}

  const status =
    mocks.length > 0
      ? hasExample
        ? `override${mocks.length > 1 ? ` · ${mocks.length}` : ''}`
        : `mocked${mocks.length > 1 ? ` · ${mocks.length}` : ''}`
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
              mocks.length > 0
                ? 'text-green-600'
                : hasExample
                  ? 'text-blue-600'
                  : 'text-muted-foreground'
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
        mocks.length > 0 ? (
          <TreeRowButton
            variant='destructive'
            tooltipText={hasExample ? 'Reset to default' : 'Clear responses'}
            onClick={onRemoveAll}>
            <Trash2 />
          </TreeRowButton>
        ) : undefined
      }>
      <div className='space-y-2 py-1.5 pe-2 ps-12'>
        {onDefault ? (
          <>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-xs text-muted-foreground'>
                Tool default (live) · stays in sync with the tool's example
              </span>
              <Button variant='outline' size='xs' onClick={() => onAdd(tool.exampleOutput)}>
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
            {mocks.length === 0 ? (
              <div className='flex flex-wrap items-center gap-2'>
                {seedScaffold ? (
                  <Button variant='outline' size='xs' onClick={() => onAdd(scaffold)}>
                    <Wand2 />
                    Scaffold
                  </Button>
                ) : null}
                <Button variant='ghost' size='xs' onClick={() => onAdd({})}>
                  Start blank
                </Button>
              </div>
            ) : null}

            {mocks.map((mock, idx) => (
              <MockResponseEditor
                key={mock.id}
                agentId={agentId}
                toolName={tool.name}
                mock={mock}
                index={idx}
                total={mocks.length}
                // A response is dead code when an EARLIER response for the same
                // tool matches every call. The resolver takes the first match,
                // so nothing below it can ever fire.
                shadowedBy={mocks.findIndex((m, i) => i < idx && isCatchAll(m))}
                onPatch={(patch) => onPatch(mock.id, patch)}
                onRemove={() => onRemoveMock(mock.id)}
              />
            ))}

            {mocks.length > 0 ? (
              <div className='flex flex-wrap items-center justify-between gap-2 pt-0.5'>
                <span className='min-w-0 flex-1 text-xs text-muted-foreground'>
                  {mocks.length > 1
                    ? 'Checked top to bottom. The first matching response wins.'
                    : hasExample
                      ? 'Unmatched calls fall back to the tool default.'
                      : 'Unmatched calls fail closed.'}
                </span>
                <div className='flex shrink-0 items-center gap-1'>
                  {hasExample ? (
                    <Button variant='ghost' size='xs' onClick={onRemoveAll}>
                      Reset to default
                    </Button>
                  ) : null}
                  <Button variant='outline' size='xs' onClick={() => onAdd(seedValue)}>
                    <Plus />
                    Add response
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </TreeRow>
  )
}

// ── One authored response (args matcher + output) ────────────────────────────

interface MockResponseEditorProps {
  agentId: string
  toolName: string
  mock: SimulationToolMock
  index: number
  total: number
  /** Index of an earlier catch-all response that shadows this one, or -1. */
  shadowedBy: number
  onPatch: (patch: Partial<SimulationToolMock>) => void
  onRemove: () => void
}

function MockResponseEditor({
  agentId,
  toolName,
  mock,
  index,
  total,
  shadowedBy,
  onPatch,
  onRemove,
}: MockResponseEditorProps) {
  const utils = api.useUtils()
  const [draft, setDraft] = useState(() => JSON.stringify(mock.output, null, 2))
  const [parseError, setParseError] = useState<string | null>(null)
  const [validation, setValidation] = useState<{ error?: string; warning?: string } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Args matcher is opt-in: an existing `args` opens it, otherwise the author
  // reveals it with "Only when args match". A response with no matcher fires for
  // every call — which is exactly the v1 behavior, so the default stays familiar.
  const [argsDraft, setArgsDraft] = useState(() =>
    mock.args ? JSON.stringify(mock.args.value, null, 2) : ''
  )
  const [argsOpen, setArgsOpen] = useState(() => mock.args !== undefined)
  const [argsError, setArgsError] = useState<string | null>(null)

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
    onPatch({ output: parsed })

    // Debounced schema validation against the tool's declared outputSchema.
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void utils.eval.validateMock
        .fetch({ agentId, toolName, output: parsed })
        .then((res) => setValidation(res.ok ? { warning: res.warning } : { error: res.error }))
        .catch(() => setValidation(null))
    }, 500)
  }

  const applyArgs = (text: string) => {
    setArgsDraft(text)
    if (text.trim() === '') {
      setArgsError(null)
      onPatch({ args: undefined })
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setArgsError('Invalid JSON')
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setArgsError('Matcher must be a JSON object of argument names to values')
      return
    }
    setArgsError(null)
    onPatch({
      args: { mode: mock.args?.mode ?? 'subset', value: parsed as Record<string, unknown> },
    })
  }

  const clearArgs = () => {
    setArgsOpen(false)
    setArgsDraft('')
    setArgsError(null)
    onPatch({ args: undefined })
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <div className='space-y-1.5 rounded-md border border-border/60 p-2'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='min-w-0 flex-1 text-xs text-muted-foreground'>
          {total > 1 ? `Response ${index + 1}` : 'Response'}
          {mock.args && !isCatchAll(mock) ? (
            <span className='ms-1 text-muted-foreground/70'>
              · when args {mock.args.mode}-match
            </span>
          ) : total > 1 ? (
            <span className='ms-1 text-muted-foreground/70'>· any call</span>
          ) : null}
        </span>
        <div className='flex shrink-0 items-center gap-1'>
          {argsOpen ? null : (
            <Button variant='ghost' size='xs' onClick={() => setArgsOpen(true)}>
              Only when args match
            </Button>
          )}
          {total > 1 ? (
            <Button variant='ghost' size='xs' onClick={onRemove}>
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </div>

      {shadowedBy >= 0 ? (
        <Alert variant='warning'>
          <AlertDescription>
            Never runs: response {shadowedBy + 1} matches every call. Give that one an args matcher,
            or move this above it.
          </AlertDescription>
        </Alert>
      ) : null}

      {argsOpen ? (
        <div className='space-y-1'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <span className='min-w-0 flex-1 text-xs text-muted-foreground'>
              Match when the call args {mock.args?.mode === 'exact' ? 'equal' : 'contain'}:
            </span>
            <div className='flex shrink-0 items-center gap-1'>
              <Button
                variant='ghost'
                size='xs'
                onClick={() =>
                  onPatch({
                    args: {
                      mode: mock.args?.mode === 'exact' ? 'subset' : 'exact',
                      value: mock.args?.value ?? {},
                    },
                  })
                }>
                {mock.args?.mode === 'exact' ? 'Exact' : 'Subset'}
              </Button>
              <Button variant='ghost' size='xs' onClick={clearArgs}>
                Any call
              </Button>
            </div>
          </div>
          <CodeEditor
            language={CodeLanguage.json}
            value={argsDraft}
            onChange={applyArgs}
            minHeight={60}
            placeholder='{ "query": "jordan.lee@example.com" }'
          />
          {argsError ? (
            <Alert variant='bad'>
              <AlertDescription>{argsError}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      <CodeEditor
        language={CodeLanguage.json}
        value={draft}
        onChange={applyDraft}
        minHeight={120}
        placeholder='{}'
      />

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
  )
}
