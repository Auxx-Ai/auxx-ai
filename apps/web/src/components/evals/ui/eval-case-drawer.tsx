// apps/web/src/components/evals/ui/eval-case-drawer.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { RecordId } from '@auxx/lib/resources/client'
import type { AgentEvalAssertion, AgentEvalTarget, SimulationConfig } from '@auxx/types/evals'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { Switch } from '@auxx/ui/components/switch'
import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils'
import { FlaskConical, Play, User, Wrench } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { useRecord, useResourceProperty } from '~/components/resources'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { AutoResolveBadge } from '~/components/workflow/nodes/core/answer/components/auto-resolve-badge'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'
import { AutosaveIndicator, type AutosaveState } from '../../agents/ui/shared/autosave-indicator'
import { AssertionsSection } from './assertions-section'
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

/** The contact entity slug — the subject record the persona "is". */
const CONTACT_SLUG = 'contact'

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

/** New cases start with one assertion so they're runnable and satisfy `min(1)`. */
const seedAssertions = (): AgentEvalAssertion[] => [
  { id: generateId('asrt'), type: 'terminal_outcome', data: { outcome: 'finished' } },
]

/** Stable content key for the autosave change-detector (target is not editable). */
const serializeDraft = (d: {
  name: string
  config: SimulationConfig
  assertions: AgentEvalAssertion[]
}): string => JSON.stringify({ name: d.name, config: d.config, assertions: d.assertions })

const CHANNEL_OPTIONS = [
  { value: 'chat', label: 'Chat' },
  { value: 'email', label: 'Email' },
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
      initialAssertions={loaded?.assertions ?? seedAssertions()}
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
  // Mutation objects change identity on every state transition (idle→pending→
  // success). Reaching them through a ref keeps `saveNow` stable, so the autosave
  // effect re-runs only on real edits — not on the save's own lifecycle (which
  // would otherwise loop forever).
  const mutationsRef = useRef({ create, update })
  mutationsRef.current = { create, update }
  // Serialized snapshot of what's persisted. Autosave fires only when the live
  // draft actually differs — a `firstRun` flag skips just one effect tick, but
  // field widgets can emit a normalizing `onChange` after mount, which would
  // otherwise trigger a spurious save on open. Seeded with the initial values.
  const savedSnapshot = useRef(serializeDraft({ name, config, assertions }))

  /** Persist the current snapshot now; returns the case id (creating if needed). */
  const saveNow = useCallback(async (): Promise<string | null> => {
    const cur = latest.current
    if (cur.name.trim().length === 0 || cur.config.openingMessage.trim().length === 0) return null
    setAutosave({ kind: 'saving' })
    try {
      let id = cur.caseId
      if (id == null) {
        const res = await mutationsRef.current.create.mutateAsync({
          name: cur.name,
          target: cur.target,
          config: cur.config,
          assertions: cur.assertions,
        })
        id = res.id
        setCaseId(id)
      } else {
        await mutationsRef.current.update.mutateAsync({
          id,
          patch: { name: cur.name, config: cur.config, assertions: cur.assertions },
        })
      }
      savedSnapshot.current = serializeDraft(cur)
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
    // Everything is read through refs (`latest`/`mutationsRef`/`onSavedRef`), so
    // `saveNow` is intentionally stable.
  }, [])

  // Debounced autosave whenever the draft diverges from what's persisted.
  // name/config/assertions are intentional change-triggers even though the body
  // reads them through `latest` — re-running on each edit is the point. The
  // content diff (vs `savedSnapshot`) means a mount-time normalizing onChange
  // that produces equivalent data won't save on open.
  useEffect(() => {
    if (!canSave) return
    if (serializeDraft({ name, config, assertions }) === savedSnapshot.current) return
    const t = setTimeout(() => void saveNow(), 800)
    return () => clearTimeout(t)
  }, [name, config, assertions, canSave, saveNow])

  const setConfigField = <K extends keyof SimulationConfig>(key: K, value: SimulationConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }))

  // ── Test customer (subject) ──
  const contactEntityDefId = useResourceProperty(CONTACT_SLUG, 'entityDefinitionId')
  const subjectRecordId = (config.subject.recordIds[0] as RecordId | undefined) ?? null
  const { record: subjectRecord } = useRecord({ recordId: subjectRecordId })

  // The picked contact's display values — used to seed a field when it's switched
  // to manual. `displayName`/`secondaryInfo` are what RecordBadge shows; treat
  // secondaryInfo as the email only if it reads like one.
  const resolvedName =
    typeof subjectRecord?.displayName === 'string' ? subjectRecord.displayName : undefined
  const resolvedSecondary =
    typeof subjectRecord?.secondaryInfo === 'string' ? subjectRecord.secondaryInfo : undefined
  const resolvedEmail = resolvedSecondary?.includes('@') ? resolvedSecondary : undefined

  const setSubjectRecords = (recordIds: RecordId[]) =>
    setConfig((c) => ({ ...c, subject: { ...c.subject, recordIds } }))

  // claimed.<key> === undefined ⇒ auto (the persona supplies its own value); a
  // string (including '') ⇒ manual (pinned, stated verbatim).
  const setClaimed = (key: 'name' | 'email', value: string | undefined) =>
    setConfig((c) => {
      const merged = { ...c.subject.claimed, [key]: value }
      const claimed: { name?: string; email?: string } = {}
      if (merged.name !== undefined) claimed.name = merged.name
      if (merged.email !== undefined) claimed.email = merged.email
      const hasAny = claimed.name !== undefined || claimed.email !== undefined
      return { ...c, subject: { ...c.subject, claimed: hasAny ? claimed : undefined } }
    })

  const emailIsAuto = config.subject.claimed?.email === undefined
  const nameIsAuto = config.subject.claimed?.name === undefined

  const runNow = async () => {
    const id = await saveNow()
    // The drawer is the editor surface — always run the current draft.
    if (id) run.mutate({ id, useDraft: true })
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
        <Section
          title='Customer'
          icon={<User className='size-4' />}
          className='[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'>
          <div className='flex flex-col ps-2 pe-4'>
            <VarEditorField className='p-0'>
              <VarEditorFieldRow title='Opening message' isRequired>
                <FieldInputAdapter
                  fieldType={FieldType.RICH_TEXT}
                  value={config.openingMessage}
                  onChange={(v) => setConfigField('openingMessage', (v as string) ?? '')}
                  placeholder='I want to cancel my order'
                />
              </VarEditorFieldRow>
              <VarEditorFieldRow
                title='Customer context'
                description='Background the persona knows.'>
                <FieldInputAdapter
                  fieldType={FieldType.RICH_TEXT}
                  value={config.customerContext ?? ''}
                  onChange={(v) => setConfigField('customerContext', (v as string) || null)}
                  placeholder='Has not received an order confirmation.'
                />
              </VarEditorFieldRow>
              <VarEditorFieldRow
                title='Customer record'
                description='Simulate as this contact — the agent resolves its data.'>
                <MultiRelationInput
                  entityDefinitionId={contactEntityDefId}
                  value={config.subject.recordIds as RecordId[]}
                  onChange={setSubjectRecords}
                  multi={false}
                  placeholder='Select a contact'
                  triggerProps={{ className: 'w-full ps-0' }}
                />
              </VarEditorFieldRow>
              <VarEditorFieldRow
                title='Email'
                description='The email the customer gives when asked.'>
                <div className='relative flex items-center'>
                  <div className='z-10 me-0.5 shrink-0 @sm:absolute @sm:right-full @sm:top-1/2 @sm:-translate-y-1/2'>
                    <AutoResolveBadge
                      isAuto={emailIsAuto}
                      onChange={(isAuto) =>
                        setClaimed('email', isAuto ? undefined : (resolvedEmail ?? ''))
                      }
                    />
                  </div>
                  {emailIsAuto ? (
                    <span className='flex h-8 items-center gap-1.5 px-2 text-xs'>
                      {resolvedEmail ? (
                        <>
                          <span className='truncate text-foreground'>{resolvedEmail}</span>
                          <span className='shrink-0 text-muted-foreground'>(auto resolved)</span>
                        </>
                      ) : (
                        <span className='text-muted-foreground'>Auto resolved</span>
                      )}
                    </span>
                  ) : (
                    <FieldInputAdapter
                      fieldType={FieldType.EMAIL}
                      value={config.subject.claimed?.email ?? ''}
                      onChange={(v) => setClaimed('email', (v as string) ?? '')}
                      placeholder='jordan.lee@example.com'
                    />
                  )}
                </div>
              </VarEditorFieldRow>
              <VarEditorFieldRow title='Name'>
                <div className='relative flex items-center'>
                  <div className='z-10 me-0.5 shrink-0 @sm:absolute @sm:right-full @sm:top-1/2 @sm:-translate-y-1/2'>
                    <AutoResolveBadge
                      isAuto={nameIsAuto}
                      onChange={(isAuto) =>
                        setClaimed('name', isAuto ? undefined : (resolvedName ?? ''))
                      }
                    />
                  </div>
                  {nameIsAuto ? (
                    <span className='flex h-8 items-center gap-1.5 px-2 text-xs'>
                      {resolvedName ? (
                        <>
                          <span className='truncate text-foreground'>{resolvedName}</span>
                          <span className='shrink-0 text-muted-foreground'>(auto resolved)</span>
                        </>
                      ) : (
                        <span className='text-muted-foreground'>Auto resolved</span>
                      )}
                    </span>
                  ) : (
                    <FieldInputAdapter
                      fieldType={FieldType.TEXT}
                      value={config.subject.claimed?.name ?? ''}
                      onChange={(v) => setClaimed('name', (v as string) ?? '')}
                      placeholder='Jordan Lee'
                    />
                  )}
                </div>
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
          </div>
        </Section>

        {/* Execution policy */}
        <Section title='Execution' icon={<Wrench className='size-4' />}>
          <VarEditorField className='p-0 **:data-[slot=field-row-label]:w-auto! @sm:**:data-[slot=field-row-label]:w-auto! **:data-[slot=field-row-content]:flex **:data-[slot=field-row-content]:justify-end **:data-[slot=field-row-content]:pe-3'>
            <VarEditorFieldRow
              title='Execute read-only tools live'
              description='Passthrough lets idempotent tools execute; writes are always mocked. Off = fully offline (unmatched calls fail closed).'>
              <div className='flex h-8 items-center'>
                <Switch
                  size='sm'
                  checked={config.unmatchedToolPolicy === 'passthrough_readonly'}
                  onCheckedChange={(checked) =>
                    setConfigField(
                      'unmatchedToolPolicy',
                      checked ? 'passthrough_readonly' : 'error'
                    )
                  }
                />
              </div>
            </VarEditorFieldRow>
          </VarEditorField>
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
