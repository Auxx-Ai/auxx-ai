// apps/web/src/components/evals/ui/simulations-tab.tsx
'use client'

import { NavStack, NavStackPanel, NavStackPanels } from '@auxx/ui/components/nav-stack'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { EvalCaseDrawer } from './eval-case-drawer'
import { EvalDrillBar } from './eval-drill-bar'
import { EvalRunDetail } from './eval-run-detail'
import { EvalSuitePanel } from './eval-suite-panel'

/**
 * The **Simulations** tab body: a NavStack drill that keeps the narrow agent
 * drawer single-column (list → case editor → run detail). The list shows both
 * agent- and procedure-scoped cases (the `?procedure` page param does not filter
 * it). The `'new'` sentinel opens the editor in create mode; a new case's scope
 * comes from `newCaseProcedureId` (a chosen procedure, or `null` for agent).
 *
 * See plans/evals/ui-plan.md §"Agent Simulations (Phase 1B)".
 */
export function SimulationsTab({ agentId }: { agentId: string }) {
  const [caseId, setCaseId] = useState<string | null>(null)
  // Procedure pinned for a NEW case (chosen from the Procedure-section "New"
  // menu); `null` ⇒ agent scope. Only meaningful while `caseId === 'new'`.
  const [newCaseProcedureId, setNewCaseProcedureId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  // The page's selected procedure (shared `?procedure` param) — gates the
  // Suggested Simulations section to the procedure-scoped view.
  const [selectedProcedureId] = useQueryState('procedure')
  const utils = api.useUtils()

  // Stack shape: a run can be reached from a case (list→case→run) or straight
  // from a list row (list→run). Derive purely from the two selections.
  const stack = runId
    ? caseId
      ? ['list', 'case', 'run']
      : ['list', 'run']
    : caseId
      ? ['list', 'case']
      : ['list']

  return (
    <NavStack
      stack={stack}
      onStackChange={(next) => {
        const top = next[next.length - 1]
        if (top === 'list') {
          setCaseId(null)
          setRunId(null)
        } else if (top === 'case') {
          setRunId(null)
        }
      }}
      className='flex h-full flex-col'>
      <NavStackPanels className='min-h-0 flex-1'>
        <NavStackPanel value='list' className='h-full'>
          <ScrollArea className='h-full' scrollbarClassName='w-1.5'>
            <EvalSuitePanel
              agentId={agentId}
              onOpenCase={setCaseId}
              onNewCase={(pid) => {
                setNewCaseProcedureId(pid)
                setCaseId('new')
              }}
              onOpenRun={setRunId}
              selectedProcedureId={selectedProcedureId}
            />
          </ScrollArea>
        </NavStackPanel>

        <NavStackPanel value='case' className='flex h-full flex-col'>
          {caseId ? (
            <EvalCaseDrawer
              key={caseId === 'new' ? `new-${newCaseProcedureId ?? 'agent'}` : caseId}
              agentId={agentId}
              caseId={caseId === 'new' ? null : caseId}
              procedureId={caseId === 'new' ? newCaseProcedureId : null}
              onSaved={() => void utils.eval.list.invalidate({ agentId })}
              onOpenRun={setRunId}
            />
          ) : null}
        </NavStackPanel>

        <NavStackPanel value='run' className='flex h-full flex-col'>
          <EvalDrillBar title='Run detail' />
          <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
            {runId ? <EvalRunDetail runId={runId} onSelectRun={setRunId} /> : null}
          </ScrollArea>
        </NavStackPanel>
      </NavStackPanels>
    </NavStack>
  )
}
