// apps/web/src/components/evals/ui/eval-suite-panel.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { FlaskConical, Play, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { EvalCaseRow } from './eval-case-row'

/**
 * Level 1 of the Simulations drill: the saved-case list for an agent, scoped by
 * the shared `?procedure` param. At the agent root, agent-scoped cases list
 * first, then procedure-scoped cases roll up under collapsible per-procedure
 * groups. Run / Run all / New live in the `Section` header. The `Section` owns
 * its own padding — it is rendered directly, never wrapped. See
 * plans/evals/ui-plan.md §"Level 1 — suite list".
 */

interface EvalSuitePanelProps {
  agentId: string
  procedureId: string | null
  onOpenCase: (caseId: string) => void
  onNewCase: () => void
  onOpenRun: (runId: string) => void
}

export function EvalSuitePanel({
  agentId,
  procedureId,
  onOpenCase,
  onNewCase,
  onOpenRun,
}: EvalSuitePanelProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  const casesQuery = api.eval.list.useQuery({
    agentId,
    procedureId: procedureId ?? undefined,
  })
  const proceduresQuery = api.agentProcedure.list.useQuery({ agentId })
  const procedureNames = useMemo(
    () => new Map((proceduresQuery.data ?? []).map((p) => [p.procedureId, p.name])),
    [proceduresQuery.data]
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

  // Group procedure-scoped cases by procedure (agent-root view only).
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

  const scopeLabel = (c: (typeof cases)[number]) =>
    c.scope === 'agent' ? 'Whole agent' : (procedureNames.get(c.procedureId ?? '') ?? 'Procedure')

  const renderRow = (c: (typeof cases)[number]) => (
    <EvalCaseRow
      key={c.id}
      item={c}
      scopeLabel={scopeLabel(c)}
      onOpen={() => onOpenCase(c.id)}
      onRun={() => runCase.mutate({ id: c.id })}
      onDelete={() => handleDelete(c.id, c.name)}
      isRunning={runCase.isPending && runCase.variables?.id === c.id}
      isDeleting={deleteCase.isPending && deleteCase.variables?.id === c.id}
    />
  )

  const isEmpty = cases.length === 0
  const isLoading = casesQuery.isLoading

  return (
    <>
      <ConfirmDialog />
      <Section
        title='Simulations'
        icon={<FlaskConical className='size-4' />}
        collapsible={false}
        actions={
          <div className='flex items-center gap-1.5'>
            {runAll.isPending ? (
              <Badge variant='secondary' className='gap-1'>
                <Play className='size-3 animate-pulse' />
                Running…
              </Badge>
            ) : null}
            <Button
              variant='ghost'
              size='xs'
              disabled={isEmpty || runAll.isPending}
              loading={runAll.isPending}
              onClick={() => runAll.mutate({ agentId, procedureId: procedureId ?? undefined })}>
              <Play />
              Run all
            </Button>
            <Button variant='ghost' size='xs' onClick={onNewCase}>
              <Plus />
              New simulation
            </Button>
          </div>
        }>
        {isLoading || isEmpty ? (
          <EmptySection
            icon={<FlaskConical className='size-4' />}
            title='No simulations yet'
            description='Add one to test how this agent handles a conversation.'
            loading={isLoading}
          />
        ) : (
          <div className='space-y-0.5'>
            {agentScoped.map(renderRow)}

            {/* Procedure groups only at the agent root (a procedure view is already scoped). */}
            {!procedureId &&
              groups.map(([pid, list]) => {
                const open = openGroups.has(pid)
                return (
                  <TreeRow
                    key={pid}
                    icon={<FlaskConical className='size-4 text-muted-foreground/60' />}
                    title={procedureNames.get(pid) ?? 'Procedure'}
                    secondary={<span className='text-xs text-muted-foreground'>{list.length}</span>}
                    expandable
                    isOpen={open}
                    onToggleOpen={() =>
                      setOpenGroups((s) => {
                        const next = new Set(s)
                        if (next.has(pid)) next.delete(pid)
                        else next.add(pid)
                        return next
                      })
                    }>
                    {list.map(renderRow)}
                  </TreeRow>
                )
              })}

            {/* In a procedure-scoped view, procedure cases render flat. */}
            {procedureId ? procedureScoped.map(renderRow) : null}
          </div>
        )}
      </Section>
    </>
  )
}
