// apps/web/src/components/evals/ui/eval-suite-panel.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { FlaskConical, Play, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { EvalCaseRow } from './eval-case-row'
import { EvalSuggestionsSection } from './eval-suggestions-section'

/**
 * Level 1 of the Simulations drill: the saved-case list for an agent, split into
 * two stacked sections — **Agent simulations** (whole-conversation tests) and
 * **Procedure simulations** (per-procedure, pinned to a version). Both list
 * regardless of the page's `?procedure` selection. Each section owns its own
 * New / Run-all. See plans/evals/ui-plan.md §"Level 1 — suite list".
 */

/**
 * Bleeds the `Section`'s `data-slot=section-content` past the section's `p-3`
 * padding so the tree rows span full width; an inner `ps-2 pe-4` div re-pads.
 */
const SECTION_BLEED = '[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'

interface EvalSuitePanelProps {
  agentId: string
  onOpenCase: (caseId: string) => void
  /** `procedureId` pins a new procedure-scoped case; `null` ⇒ agent scope. */
  onNewCase: (procedureId: string | null) => void
  onOpenRun: (runId: string) => void
  /** The page's `?procedure` selection — gates the Suggested Simulations section. */
  selectedProcedureId?: string | null
}

export function EvalSuitePanel({
  agentId,
  onOpenCase,
  onNewCase,
  onOpenRun,
  selectedProcedureId,
}: EvalSuitePanelProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  // Procedure groups default to open; track the ones the user has collapsed.
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set())

  const casesQuery = api.eval.list.useQuery({ agentId })
  const proceduresQuery = api.agentProcedure.list.useQuery({ agentId })
  const procedures = proceduresQuery.data ?? []
  const procedureNames = useMemo(
    () => new Map(procedures.map((p) => [p.procedureId, p.name])),
    [procedures]
  )

  const invalidate = () => utils.eval.list.invalidate({ agentId })

  const runCase = api.eval.run.useMutation({
    onSuccess: ({ runId }) => {
      void invalidate()
      onOpenRun(runId)
    },
    onError: (err) => toastError({ title: 'Failed to run simulation', description: err.message }),
  })

  const deleteCase = api.eval.delete.useMutation({
    onSuccess: invalidate,
    onError: (err) =>
      toastError({ title: 'Failed to delete simulation', description: err.message }),
  })

  const runAll = api.eval.runAll.useMutation({
    onSuccess: () => void invalidate(),
    onError: (err) => toastError({ title: 'Failed to run all', description: err.message }),
  })

  const cases = casesQuery.data ?? []
  const agentScoped = cases.filter((c) => c.scope === 'agent')
  const procedureScoped = cases.filter((c) => c.scope === 'procedure')

  // suggestionIds already accepted into saved cases — so re-generated proposals
  // for the same provenance are filtered out client-side.
  const acceptedSuggestionIds = useMemo(
    () => new Set(cases.map((c) => c.suggestionId).filter((id): id is string => id != null)),
    [cases]
  )

  // Group procedure-scoped cases by procedure.
  const groups = useMemo(() => {
    const map = new Map<string, typeof procedureScoped>()
    for (const c of procedureScoped) {
      const key = c.procedureId ?? 'unknown'
      const list = map.get(key) ?? []
      list.push(c)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [procedureScoped])

  const handleDelete = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: 'Delete simulation?',
      description: `"${name}" and its run history will be removed. This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) deleteCase.mutate({ id })
  }

  const renderRow = (c: (typeof cases)[number], depth: number) => (
    <EvalCaseRow
      key={c.id}
      item={c}
      depth={depth}
      onEdit={() => onOpenCase(c.id)}
      onRun={() => runCase.mutate({ id: c.id, useDraft: true })}
      onDelete={() => handleDelete(c.id, c.name)}
      onOpenRun={onOpenRun}
      isRunning={runCase.isPending && runCase.variables?.id === c.id}
      isDeleting={deleteCase.isPending && deleteCase.variables?.id === c.id}
    />
  )

  const isLoading = casesQuery.isLoading
  const runningAll = runAll.isPending

  return (
    <>
      <ConfirmDialog />

      {/* Agent simulations — whole-conversation tests */}
      <Section
        title='Agent simulations'
        icon={<FlaskConical className='size-4' />}
        collapsible={false}
        className={SECTION_BLEED}
        actions={
          <div className='flex items-center gap-1.5'>
            <Button
              variant='ghost'
              size='xs'
              disabled={agentScoped.length === 0 || runningAll}
              loading={runningAll}
              onClick={() =>
                runAll.mutate({ agentId, caseIds: agentScoped.map((c) => c.id), useDraft: true })
              }>
              <Play />
              Run all
            </Button>
            <Button variant='ghost' size='xs' onClick={() => onNewCase(null)}>
              <Plus />
              New
            </Button>
          </div>
        }>
        <div className='flex flex-col ps-2 pe-4'>
          {isLoading ? (
            <EmptySection icon={<FlaskConical className='size-4' />} title='Loading…' loading />
          ) : agentScoped.length === 0 ? (
            <EmptySection
              icon={<FlaskConical className='size-4' />}
              title='No agent simulations yet'
              description='Test how this agent handles a whole conversation.'
            />
          ) : (
            agentScoped.map((c) => renderRow(c, 0))
          )}
        </div>
      </Section>

      {/* Procedure simulations — per-procedure, pinned to a version */}
      <Section
        title='Procedure simulations'
        icon={<FlaskConical className='size-4' />}
        collapsible={false}
        className={SECTION_BLEED}
        actions={
          <div className='flex items-center gap-1.5'>
            <Button
              variant='ghost'
              size='xs'
              disabled={procedureScoped.length === 0 || runningAll}
              loading={runningAll}
              onClick={() =>
                runAll.mutate({
                  agentId,
                  caseIds: procedureScoped.map((c) => c.id),
                  useDraft: true,
                })
              }>
              <Play />
              Run all
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='ghost' size='xs' disabled={procedures.length === 0}>
                  <Plus />
                  New
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {procedures.map((p) => (
                  <DropdownMenuItem key={p.procedureId} onClick={() => onNewCase(p.procedureId)}>
                    {p.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }>
        <div className='flex flex-col ps-2 pe-4'>
          {isLoading ? (
            <EmptySection icon={<FlaskConical className='size-4' />} title='Loading…' loading />
          ) : procedureScoped.length === 0 ? (
            <EmptySection
              icon={<FlaskConical className='size-4' />}
              title='No procedure simulations yet'
              description='Pin a procedure and test it in isolation.'
            />
          ) : (
            groups.map(([pid, list]) => {
              const open = !closedGroups.has(pid)
              return (
                <TreeRow
                  key={pid}
                  depth={0}
                  rowClassName='hover:bg-primary-100'
                  icon={<FlaskConical className='size-4 text-muted-foreground/60' />}
                  title={procedureNames.get(pid) ?? 'Procedure'}
                  secondary={<span className='text-xs text-muted-foreground'>{list.length}</span>}
                  expandable
                  isOpen={open}
                  onToggleOpen={() =>
                    setClosedGroups((s) => {
                      const next = new Set(s)
                      if (next.has(pid)) next.delete(pid)
                      else next.add(pid)
                      return next
                    })
                  }>
                  {list.map((c) => renderRow(c, 1))}
                </TreeRow>
              )
            })
          )}
        </div>
      </Section>

      {/* Suggested simulations — procedure-scoped view only (`?procedure` set). */}
      {selectedProcedureId ? (
        <EvalSuggestionsSection
          key={selectedProcedureId}
          agentId={agentId}
          procedureId={selectedProcedureId}
          onOpenCase={onOpenCase}
          acceptedSuggestionIds={acceptedSuggestionIds}
          onAccepted={invalidate}
        />
      ) : null}
    </>
  )
}
