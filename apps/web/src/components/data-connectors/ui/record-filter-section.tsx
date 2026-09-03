// apps/web/src/components/data-connectors/ui/record-filter-section.tsx
'use client'

import type { ConditionGroup as PersistedConditionGroup } from '@auxx/lib/conditions/client'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { generateId } from '@auxx/utils'
import { Filter, Info } from 'lucide-react'
import { useMemo } from 'react'
import {
  type Condition,
  ConditionAdd,
  ConditionList,
  ConditionProvider,
  type ConditionSystemConfig,
} from '~/components/conditions'
import type { RouterOutputs } from '~/trpc/react'
import type { SourcePath } from '../hooks/use-source-paths'
import { buildSourceFieldDefinitions } from '../lib/source-path-fields'
import { getConnectorDraftState, useConnectorDraftStore } from '../stores/connector-draft-store'

type Stream = RouterOutputs['dataConnector']['listStreams'][number]

interface RecordFilterSectionProps {
  stream: Stream
  /**
   * The stream's flattened source schema (payload-absolute). Passed down rather than
   * re-derived so the filter's vocabulary is byte-identical to the mapping tree's.
   */
  sourcePaths: SourcePath[]
}

/**
 * Per-stream record filter (plans/data-connectors/v11 §6). Conditions are evaluated
 * against the RAW SOURCE record before mapping, so this renders for BOTH
 * `definitionKind` values — unlike `PaginationSection`, the filter sits below the
 * connector contract and app connectors (Shopify) get it too.
 *
 * The one adaptation to the shared condition builder: its field vocabulary is SOURCE
 * PATHS (`orders_count`, `customer.email`), not `ResourceFieldId`s. Everywhere else
 * the builder picks target fields on a record; here it picks into the payload, which
 * is why `config.mode` is `'resource'` with NO `entityDefinitionId` — that flips
 * `ConditionAdd`/`ConditionItem` to the flat `ResourceFieldSelector` over the fields
 * we supply instead of the relationship-drilling selectors.
 *
 * Persists into the connector draft store (`recordFilter`) and commits through the one
 * connector-wide save bar, which warns that a filter change restarts the backfill.
 */
export function RecordFilterSection({ stream, sourcePaths }: RecordFilterSectionProps) {
  // Draft-first (optimistic), server prop until the bridge seeds the store. `undefined`
  // means "not seeded" — `null` is a real value (the user cleared the filter), so this
  // deliberately does NOT collapse the two with `??`.
  const draftFilter = useConnectorDraftStore(
    (s) => s.draft.streams.find((st) => st.id === stream.id)?.recordFilter
  )
  const groups =
    (draftFilter === undefined
      ? (stream.recordFilter as PersistedConditionGroup[] | null)
      : draftFilter) ?? []

  // One group, always. The stored shape is `ConditionGroup[]` (what the evaluator
  // takes), but the surface is a flat condition list — nesting buys nothing here and
  // the AND/OR rail already covers what a merchant needs to express.
  const group = groups[0]
  const conditions = useMemo<Condition[]>(() => group?.conditions ?? [], [group])
  const mintedGroupId = useMemo(() => generateId(), [])
  const groupId = group?.id ?? mintedGroupId

  const fields = useMemo(
    () =>
      buildSourceFieldDefinitions(
        sourcePaths,
        conditions.map((c) => c.fieldId).filter((id): id is string => typeof id === 'string')
      ),
    [sourcePaths, conditions]
  )

  const config = useMemo<ConditionSystemConfig>(
    () => ({
      mode: 'resource',
      fields,
      allowNesting: false,
      showGrouping: false,
      showLogicalOperators: true,
      // Field · operator · value on one row — the filter rows are short enough that the
      // stacked value input would only add height.
      display: 'inline',
    }),
    [fields]
  )

  const setConditions = (next: Condition[]) => {
    const { setRecordFilter } = getConnectorDraftState()
    // An empty list is stored as NULL, not `[{ conditions: [] }]` — an empty group
    // matches everything, so a leftover husk would read as "filter configured" in
    // every summary and diff while behaving as no filter at all.
    if (next.length === 0) {
      setRecordFilter(stream.id, null)
      return
    }
    // `evaluateGroup` reads the GROUP's `logicalOperator`; the flat list's AND/OR rail
    // writes it onto each condition after the first. Mirror it up so the two can never
    // disagree about whether the rows are AND'd or OR'd.
    setRecordFilter(stream.id, [
      { id: groupId, conditions: next, logicalOperator: next[1]?.logicalOperator ?? 'AND' },
    ])
  }

  return (
    <Section
      title='Record filter'
      icon={<Filter className='size-4' />}
      initialOpen
      collapsible={false}
      description='Only import records that match'>
      <div className='flex flex-col gap-2 px-1'>
        {/*
          An array-ROOT stream has no filterable vocabulary at all: a generic-rest
          collection endpoint yields the whole response body as ONE record, so every
          leaf reads `[].something` and none of them resolve for a filter (see
          `buildSourceFieldDefinitions`). Say so instead of rendering a picker with
          nothing in it — an empty dropdown reads as a loading bug, not a limitation.
          A stream in this shape has no conditions to lose, since none could be saved.
        */}
        {fields.length === 0 && conditions.length === 0 ? (
          <EmptySection
            icon={<Filter className='size-5' />}
            title="This stream can't be filtered"
            description='Its records are a list rather than one object per record, so there are no per-record fields to match on.'
          />
        ) : (
          <ConditionProvider
            conditions={conditions}
            config={config}
            onConditionsChange={setConditions}>
            {conditions.length === 0 ? (
              <EmptySection
                icon={<Filter className='size-5' />}
                title='No filter set'
                description="Every record is imported. Add a condition to skip the ones you don't want in your CRM."
              />
            ) : (
              <ConditionList conditions={conditions} />
            )}

            <div className='flex'>
              <ConditionAdd buttonText='Add condition' />
            </div>

            {/*
            The most important line on the screen. Without it a merchant sets this
            filter expecting the thousands of already-synced records to disappear —
            and they will not: the filter means "don't add", never "keep in sync with".

            Stated in the POSITIVE both times. The obvious phrasing ("records that
            don't match are not imported") stacks two negatives in one clause and
            makes the reader work out the direction, on the one line that exists
            precisely so nobody has to.
          */}
            {conditions.length > 0 && (
              <p className='flex items-start gap-1.5 text-xs text-muted-foreground'>
                <Info className='mt-0.5 size-3.5 shrink-0' />
                <span>
                  Matching records are imported. Records already in your CRM stay, even if they stop
                  matching.
                </span>
              </p>
            )}
          </ConditionProvider>
        )}
      </div>
    </Section>
  )
}
