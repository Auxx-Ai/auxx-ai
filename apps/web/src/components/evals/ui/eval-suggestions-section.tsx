// apps/web/src/components/evals/ui/eval-suggestions-section.tsx
'use client'

import type { AgentEvalTarget } from '@auxx/types/evals'
import { Button } from '@auxx/ui/components/button'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import {
  useEvalSuggestionsActions,
  useSuggestionsEntry,
} from '../stores/use-eval-suggestions-store'

/** One proposed simulation from `eval.suggest`. */
type Suggestion = RouterOutputs['eval']['suggest']['suggestions'][number]

const SECTION_BLEED = '[&>[data-slot=section]>[data-slot=section-content]]:-mx-3'

interface EvalSuggestionsSectionProps {
  agentId: string
  procedureId: string
  onOpenCase: (caseId: string) => void
  /** suggestionIds already accepted into saved cases (filtered out). */
  acceptedSuggestionIds: Set<string>
  /** Invalidate the saved-case list after an accept. */
  onAccepted: () => void
}

/**
 * Suggested Simulations: the system reads the procedure draft and proposes
 * ready-to-run cases. Open by default and auto-generates once per procedure —
 * cheap on a reload because the backend caches by draft hash. Its result +
 * dismissals are held in a session store keyed by `procedureId`, surviving the
 * section's remounts instead of re-running the model. **Add** accepts a proposal
 * via `eval.create` and drills into its drawer; the X dismisses it for the session.
 *
 * See plans/evals/phase-3-suggester.md §3.4.
 */
export function EvalSuggestionsSection({
  agentId,
  procedureId,
  onOpenCase,
  acceptedSuggestionIds,
  onAccepted,
}: EvalSuggestionsSectionProps) {
  // Cached per procedure in a session store so a remount reuses the generation
  // rather than spending tokens again; Refresh overwrites it.
  const { result, dismissed, requested } = useSuggestionsEntry(procedureId)
  const { setResult, dismiss: dismissInStore, markRequested } = useEvalSuggestionsActions()

  // A new procedure-scoped case pins the procedure's active (published) version —
  // the same resolution the New-simulation flow uses.
  const procedureQuery = api.procedure.getById.useQuery({ id: procedureId })
  const activeVersionId = procedureQuery.data?.activeVersionId ?? null

  const suggest = api.eval.suggest.useMutation({
    onSuccess: (data) => setResult(procedureId, data),
    onError: (err) =>
      toastError({ title: 'Could not generate suggestions', description: err.message }),
  })

  const create = api.eval.create.useMutation()

  // `force` bypasses the backend draft-hash cache — Refresh regenerates; the auto
  // run uses the cache (a reload then reuses a prior generation, no token spend).
  const generate = (force = false) => {
    markRequested(procedureId)
    suggest.mutate({ agentId, procedureId, force })
  }

  // Auto-generate once per procedure per session: nothing cached, not already
  // attempted (so a failed run doesn't re-fire on remount), nothing in flight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `generate` uses stable store/mutation refs; gated by result/requested
  useEffect(() => {
    if (!result && !requested && !suggest.isPending) generate()
  }, [procedureId, result, requested, suggest.isPending])

  const accept = (s: Suggestion) => {
    if (!activeVersionId) {
      toastError({
        title: 'Cannot add simulation',
        description: 'Publish the procedure once so a version exists to pin.',
      })
      return
    }
    const target: AgentEvalTarget = {
      kind: 'agent_simulation',
      scope: 'procedure',
      agentId,
      procedureId,
      procedureVersionId: activeVersionId,
    }
    create.mutate(
      {
        name: s.name,
        target,
        config: s.config,
        assertions: s.assertions,
        suggestionId: s.suggestionId,
      },
      {
        onSuccess: ({ id }) => {
          // Drop the accepted row immediately and refresh the saved list.
          dismissInStore(procedureId, s.suggestionId)
          onAccepted()
          onOpenCase(id)
        },
        onError: (err) =>
          toastError({ title: 'Could not add simulation', description: err.message }),
      }
    )
  }

  const dismiss = (suggestionId: string) => dismissInStore(procedureId, suggestionId)

  // Hide the session-dismissed and already-accepted (cross-session) proposals.
  const visible = (result?.suggestions ?? []).filter(
    (s) => !dismissed.has(s.suggestionId) && !acceptedSuggestionIds.has(s.suggestionId)
  )

  return (
    <Section
      title='Suggested simulations'
      icon={<Sparkles className='size-4' />}
      className={SECTION_BLEED}
      actions={
        <Button
          variant='ghost'
          size='xs'
          loading={suggest.isPending}
          loadingText='Generating…'
          onClick={() => generate(true)}>
          <RefreshCw />
          Refresh
        </Button>
      }>
      <div className='flex flex-col ps-2 pe-4'>
        {suggest.isPending ? (
          <EmptySection
            icon={<Sparkles className='size-4' />}
            title='Reading the procedure…'
            loading
          />
        ) : visible.length === 0 ? (
          <EmptySection
            icon={<Sparkles className='size-4' />}
            title={result ? 'No new suggestions' : 'No suggestions'}
            description={
              result
                ? 'The proposed cases are already covered. Edit the procedure and refresh.'
                : 'Nothing was generated — hit Refresh to try again.'
            }
          />
        ) : (
          <>
            {visible.map((s) => (
              <SuggestionRow
                key={s.suggestionId}
                suggestion={s}
                onAdd={() => accept(s)}
                onDismiss={() => dismiss(s.suggestionId)}
                isAdding={create.isPending && create.variables?.suggestionId === s.suggestionId}
              />
            ))}
            {result && result.dropped > 0 ? (
              <p className='px-2 py-1.5 text-xs text-muted-foreground'>
                {result.dropped} proposal{result.dropped === 1 ? ' was' : 's were'} invalid and
                skipped.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Section>
  )
}

interface SuggestionRowProps {
  suggestion: Suggestion
  onAdd: () => void
  onDismiss: () => void
  isAdding: boolean
}

function SuggestionRow({ suggestion, onAdd, onDismiss, isAdding }: SuggestionRowProps) {
  const mockedTools = suggestion.config.connectorMocks.length
  const assertionCount = suggestion.assertions.length
  const hint = [
    `${assertionCount} check${assertionCount === 1 ? '' : 's'}`,
    mockedTools > 0 ? `${mockedTools} mocked tool${mockedTools === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <TreeRow
      icon={<Sparkles className='size-4 text-muted-foreground/60 shrink-0' />}
      title={suggestion.name}
      description={suggestion.rationale}
      rowClassName='hover:bg-primary-100'
      secondary={<span className='truncate text-xs text-muted-foreground'>{hint}</span>}
      actions={
        <div className='flex items-center gap-0'>
          <TreeRowButton
            tooltipText='Add simulation'
            onClick={onAdd}
            disabled={isAdding}
            aria-label='Add simulation'>
            <Plus />
          </TreeRowButton>
          <TreeRowButton
            variant='destructive'
            tooltipText='Dismiss'
            onClick={onDismiss}
            aria-label='Dismiss suggestion'>
            <Trash2 />
          </TreeRowButton>
        </div>
      }
    />
  )
}
