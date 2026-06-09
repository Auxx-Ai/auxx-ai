// apps/web/src/components/evals/ui/eval-case-drawer.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { AgentEvalAssertion, AgentEvalTarget, SimulationConfig } from '@auxx/types/evals'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import { FlaskConical, ListChecks, Play, Plus, User, Wrench } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'
import { AutosaveIndicator, type AutosaveState } from '../../agents/ui/shared/autosave-indicator'
import { useToolIconMap } from '../hooks/use-tool-icon-map'
import { EvalDrillBar } from './eval-drill-bar'
import { EvalToolResponses } from './eval-tool-responses'

/**
 * Level 2 of the Simulations drill: the case editor. Inline, stacked `Section`s
 * (no modal) with autosave — edits persist on a debounce, mirroring the
 * procedure editor; a `Run` button flushes then enqueues.
 *
 * Covers Customer, Execution policy, Tool responses, and the assertion types
 * that don't need a field-ref widget. Field-typed inputs (starting fields,
 * `crm_field`/`local_variable`, `procedure_selected`, subject pickers) are a
 * follow-up. See plans/evals/ui-plan.md §"Level 2 — case editor".
 */

const DEFAULT_CONFIG: SimulationConfig = {
  openingMessage: '',
  customerContext: null,
  channel: 'chat',
  timeFrozenAt: null,
  maxCustomerTurns: 8,
  subject: { recordIds: [], identityVerified: false },
  startingFields: [],
  unmatchedToolPolicy: 'error',
  connectorMocks: [],
}

const CHANNEL_OPTIONS = [
  { value: 'chat', label: 'Chat' },
  { value: 'email', label: 'Email' },
]

const OUTCOME_OPTIONS = [
  { value: 'finished', label: 'Finished' },
  { value: 'handoff', label: 'Handoff' },
  { value: 'switch', label: 'Switch' },
]

interface EvalCaseDrawerProps {
  agentId: string
  /** `null` ⇒ create mode. */
  caseId: string | null
  /** Shared `?procedure` scope — pins a procedure version on new cases when set. */
  procedureId: string | null
  /** Fires after any successful persist (used to refresh the suite list). */
  onSaved: () => void
  onOpenRun: (runId: string) => void
}

export function EvalCaseDrawer({
  agentId,
  caseId,
  procedureId,
  onSaved,
  onOpenRun,
}: EvalCaseDrawerProps) {
  const isCreate = caseId == null

  const caseQuery = api.eval.getById.useQuery({ id: caseId! }, { enabled: !isCreate })
  // A new procedure-scoped case pins the procedure's active version.
  const procedureQuery = api.procedure.getById.useQuery(
    { id: procedureId! },
    { enabled: isCreate && procedureId != null }
  )

  // Wait for whichever async dependency this mode needs before mounting the form
  // (so autosave never races a half-resolved target or unloaded case).
  const waitingForCase = !isCreate && caseQuery.isLoading
  const waitingForProcedure = isCreate && procedureId != null && procedureQuery.isLoading

  if (waitingForCase || waitingForProcedure) {
    return (
      <>
        <EvalDrillBar title='Simulation' />
        <EmptySection
          icon={<FlaskConical className='size-4' />}
          title='Loading simulation…'
          loading
        />
      </>
    )
  }

  const loaded = caseQuery.data
  const activeVersionId = procedureQuery.data?.activeVersionId ?? null

  const target: AgentEvalTarget =
    loaded?.target ??
    (procedureId && activeVersionId
      ? {
          kind: 'agent_simulation',
          scope: 'procedure',
          agentId,
          procedureId,
          procedureVersionId: activeVersionId,
        }
      : { kind: 'agent_simulation', scope: 'agent', agentId })

  return (
    <EvalCaseForm
      key={caseId ?? 'new'}
      agentId={agentId}
      initialCaseId={caseId}
      initialName={loaded?.name ?? ''}
      initialConfig={loaded?.config ?? DEFAULT_CONFIG}
      initialAssertions={loaded?.assertions ?? []}
      target={target}
      onSaved={onSaved}
      onOpenRun={onOpenRun}
    />
  )
}

// ── Form ─────────────────────────────────────────────────────────────────────

interface EvalCaseFormProps {
  agentId: string
  initialCaseId: string | null
  initialName: string
  initialConfig: SimulationConfig
  initialAssertions: AgentEvalAssertion[]
  target: AgentEvalTarget
  onSaved: () => void
  onOpenRun: (runId: string) => void
}

function EvalCaseForm({
  agentId,
  initialCaseId,
  initialName,
  initialConfig,
  initialAssertions,
  target,
  onSaved,
  onOpenRun,
}: EvalCaseFormProps) {
  const [caseId, setCaseId] = useState(initialCaseId)
  const [name, setName] = useState(initialName)
  const [config, setConfig] = useState<SimulationConfig>(initialConfig)
  const [assertions, setAssertions] = useState<AgentEvalAssertion[]>(initialAssertions)
  const [autosave, setAutosave] = useState<AutosaveState>({ kind: 'idle' })

  const create = api.eval.create.useMutation()
  const update = api.eval.update.useMutation()
  const run = api.eval.run.useMutation({
    onSuccess: ({ runId }) => onOpenRun(runId),
    onError: (err) => toastError({ title: 'Failed to run', description: err.message }),
  })

  const canSave = name.trim().length > 0 && config.openingMessage.trim().length > 0

  // Always-current snapshot for the debounced/forced saver (avoids stale closures).
  const latest = useRef({ caseId, name, config, assertions, target })
  latest.current = { caseId, name, config, assertions, target }
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved

  /** Persist the current snapshot now; returns the case id (creating if needed). */
  const saveNow = useCallback(async (): Promise<string | null> => {
    const cur = latest.current
    if (name.trim().length === 0 || cur.config.openingMessage.trim().length === 0) return null
    setAutosave({ kind: 'saving' })
    try {
      let id = cur.caseId
      if (id == null) {
        const res = await create.mutateAsync({
          name: cur.name,
          target: cur.target,
          config: cur.config,
          assertions: cur.assertions,
        })
        id = res.id
        setCaseId(id)
      } else {
        await update.mutateAsync({
          id,
          patch: { name: cur.name, config: cur.config, assertions: cur.assertions },
        })
      }
      onSavedRef.current()
      setAutosave({ kind: 'saved', at: Date.now() })
      return id
    } catch (err) {
      setAutosave({ kind: 'idle' })
      toastError({
        title: 'Failed to save',
        description: err instanceof Error ? err.message : String(err),
      })
      return null
    }
    // saveNow reads from `latest`, so only `name` (gating canSave) is a real dep.
  }, [name, create, update])

  // Debounced autosave on any change (skips the initial mount). name/config/
  // assertions are intentional change-triggers even though the body reads them
  // through `latest` — re-running on each edit is the point.
  const firstRun = useRef(true)
  // biome-ignore lint/correctness/useExhaustiveDependencies: name/config/assertions are autosave triggers
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (!canSave) return
    const t = setTimeout(() => void saveNow(), 800)
    return () => clearTimeout(t)
  }, [name, config, assertions, canSave, saveNow])

  const setConfigField = <K extends keyof SimulationConfig>(key: K, value: SimulationConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }))

  const runNow = async () => {
    const id = await saveNow()
    if (id) run.mutate({ id })
  }

  return (
    <>
      <EvalDrillBar
        title={
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='Simulation name'
            className='w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground'
          />
        }
        actions={<AutosaveIndicator state={autosave} />}
      />

      <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
        {/* Customer */}
        <Section title='Customer' icon={<User className='size-4' />}>
          <VarEditorField className='p-0'>
            <VarEditorFieldRow title='Opening message' isRequired>
              <FieldInputAdapter
                fieldType={FieldType.RICH_TEXT}
                value={config.openingMessage}
                onChange={(v) => setConfigField('openingMessage', (v as string) ?? '')}
                placeholder='I want to cancel my order'
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow title='Customer context' description='Background the persona knows.'>
              <FieldInputAdapter
                fieldType={FieldType.RICH_TEXT}
                value={config.customerContext ?? ''}
                onChange={(v) => setConfigField('customerContext', (v as string) || null)}
                placeholder='Has not received an order confirmation.'
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow title='Channel'>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: CHANNEL_OPTIONS }}
                triggerProps={{ className: 'w-full pe-1 ps-0' }}
                value={config.channel}
                onChange={(v) =>
                  setConfigField('channel', ((v as string[])[0] as 'chat' | 'email') ?? 'chat')
                }
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow title='Max customer turns'>
              <FieldInputAdapter
                fieldType={FieldType.NUMBER}
                value={config.maxCustomerTurns}
                onChange={(v) => setConfigField('maxCustomerTurns', Number(v) || 1)}
              />
            </VarEditorFieldRow>
          </VarEditorField>
        </Section>

        {/* Execution policy */}
        <Section title='Execution' icon={<Wrench className='size-4' />}>
          <div className='flex items-center justify-between px-1 py-1'>
            <div>
              <div className='text-sm'>Run read-only tools for real</div>
              <p className='text-xs text-muted-foreground'>
                Passthrough lets idempotent tools execute; writes are always mocked. Off = fully
                offline (unmatched calls fail closed).
              </p>
            </div>
            <Switch
              size='sm'
              checked={config.unmatchedToolPolicy === 'passthrough_readonly'}
              onCheckedChange={(checked) =>
                setConfigField('unmatchedToolPolicy', checked ? 'passthrough_readonly' : 'error')
              }
            />
          </div>
        </Section>

        {/* Tool responses */}
        <EvalToolResponses
          agentId={agentId}
          mocks={config.connectorMocks}
          onChange={(mocks) => setConfigField('connectorMocks', mocks)}
        />

        {/* Assertions */}
        <AssertionsSection
          agentId={agentId}
          scope={target.scope}
          assertions={assertions}
          onChange={setAssertions}
        />

        <div className='h-24' />
      </ScrollArea>

      {/* Footer */}
      <div className='flex shrink-0 items-center justify-end gap-2 border-t bg-background px-3 py-2'>
        <Button
          size='sm'
          disabled={!canSave || run.isPending}
          loading={run.isPending}
          loadingText='Running…'
          onClick={runNow}>
          <Play />
          Run
        </Button>
      </div>
    </>
  )
}

// ── Assertions ─────────────────────────────────────────────────────────────

interface AssertionsSectionProps {
  agentId: string
  scope: 'agent' | 'procedure'
  assertions: AgentEvalAssertion[]
  onChange: (next: AgentEvalAssertion[]) => void
}

function AssertionsSection({ agentId, assertions, onChange }: AssertionsSectionProps) {
  // The agent's effective toolset, for the tool-call assertion pickers (deduped
  // with the Tool responses query on the same key). Options carry the catalog
  // icon so the picker shows real app icons.
  const toolsetQuery = api.eval.agentToolset.useQuery({ agentId })
  const iconMap = useToolIconMap()
  const toolOptions = (toolsetQuery.data?.tools ?? []).map((t) => ({
    value: t.name,
    label: t.displayName,
    icon: iconMap.get(t.name)?.iconId,
  }))

  const add = (a: AgentEvalAssertion) => onChange([...assertions, a])
  const remove = (id: string) => onChange(assertions.filter((a) => a.id !== id))
  const patch = (id: string, next: AgentEvalAssertion) =>
    onChange(assertions.map((a) => (a.id === id ? next : a)))

  return (
    <Section
      title='Assertions'
      collapsible={false}
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
              Terminal outcome
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                add({ id: generateId('asrt'), type: 'response_criteria', data: { criteria: [] } })
              }>
              Response criteria
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                add({ id: generateId('asrt'), type: 'tool_called', data: { toolName: '' } })
              }>
              Tool called
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                add({ id: generateId('asrt'), type: 'tool_not_called', data: { toolName: '' } })
              }>
              Tool not called
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }>
      {assertions.length === 0 ? (
        <EmptySection
          icon={<ListChecks className='size-4' />}
          title='No assertions yet'
          description='A case must assert at least one outcome before it can pass.'
        />
      ) : (
        <VarEditorField orientation='vertical' className='p-0'>
          {assertions.map((a) => (
            <VarEditorFieldRow
              key={a.id}
              title={LABEL[a.type] ?? a.type}
              onClear={() => remove(a.id)}>
              <AssertionEditor
                assertion={a}
                toolOptions={toolOptions}
                onChange={(next) => patch(a.id, next)}
              />
            </VarEditorFieldRow>
          ))}
        </VarEditorField>
      )}
    </Section>
  )
}

const LABEL: Record<string, string> = {
  terminal_outcome: 'Terminal outcome',
  response_criteria: 'Response criteria',
  tool_called: 'Tool called',
  tool_not_called: 'Tool not called',
}

function AssertionEditor({
  assertion,
  toolOptions,
  onChange,
}: {
  assertion: AgentEvalAssertion
  toolOptions: { value: string; label: string; icon?: string }[]
  onChange: (next: AgentEvalAssertion) => void
}) {
  if (assertion.type === 'terminal_outcome') {
    return (
      <div className='w-40'>
        <FieldInputAdapter
          fieldType={FieldType.SINGLE_SELECT}
          fieldOptions={{ options: OUTCOME_OPTIONS }}
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
      </div>
    )
  }
  if (assertion.type === 'response_criteria') {
    return (
      <FieldInputAdapter
        fieldType={FieldType.RICH_TEXT}
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
      <FieldInputAdapter
        fieldType={FieldType.SINGLE_SELECT}
        fieldOptions={{ options: toolOptions }}
        value={assertion.data.toolName}
        onChange={(v) =>
          onChange({
            ...assertion,
            data: { ...assertion.data, toolName: (v as string[])[0] ?? '' },
          })
        }
        placeholder='Pick a tool'
      />
    )
  }
  return null
}
