// apps/web/src/components/data-connectors/ui/pagination-section.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Section } from '@auxx/ui/components/section'
import { Waypoints } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import type { RouterOutputs } from '~/trpc/react'
import {
  type BackfillWindowSpan,
  describePagination,
  type PaginationDescription,
  type PaginationSpec,
} from '../lib/describe-pagination'
import { detectPagination } from '../lib/detect-pagination'
import { getConnectorDraftState, useConnectorDraftStore } from '../stores/connector-draft-store'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>
type Stream = RouterOutputs['dataConnector']['listStreams'][number]

/** The single live test-fetch result the detector reads (shape from `StreamSample`). */
export type StreamSample = {
  response: unknown
  recordCount: number
  responseHeaders?: Record<string, string>
} | null

/**
 * Reveal the one-click "Use this" apply on a detected proposal. The write path is
 * fully wired (Step 10 §3.4) — flip this to `false` to hide it. Inform-only otherwise.
 */
const SHOW_USE_DETECTED_PAGINATION = true

interface PaginationSectionProps {
  connector: Connector
  stream: Stream
  /** The current test-fetch result (if any) — drives the detected proposal. */
  sample: StreamSample
}

/**
 * Read-only pagination transparency (Step 10 §3.2) for a generic-rest stream. The
 * stream's *configured* pagination kind shows as a Badge in the section header —
 * hover for what it means. After a test fetch, an inform-only *detected* proposal
 * sits in the body with a one-click "Use this" apply. Self-contained: derives both
 * descriptions from the stream/sample and owns the apply mutation.
 */
export function PaginationSection({ connector, stream, sample }: PaginationSectionProps) {
  // Read the request config from the draft (reflects an unsaved edit); "Use this" writes
  // back to the draft and the save bar commits it (plans/data-connectors/v4).
  const draftStream = useConnectorDraftStore((s) =>
    s.draft.streams.find((st) => st.id === stream.id)
  )
  const draftSpan = useConnectorDraftStore(
    (s) => (s.draft.config as { backfillWindowSpan?: BackfillWindowSpan }).backfillWindowSpan
  )

  const requestConfig = (draftStream?.requestConfig ?? stream.requestConfig ?? {}) as {
    params?: Record<string, unknown>
    pagination?: PaginationSpec
  }
  const pagination = requestConfig.pagination
  const backfillWindowSpan =
    draftSpan ??
    (connector.config as { backfillWindowSpan?: BackfillWindowSpan } | null)?.backfillWindowSpan
  const pageSizeFallback = numericParam(requestConfig.params)

  const configuredPagination = describePagination(pagination, {
    backfillWindowSpan,
    pageSizeFallback,
  })
  const detected = sample
    ? detectPagination({
        body: sample.response,
        headers: sample.responseHeaders,
        pageRecordCount: sample.recordCount,
        pageLimit: pagination?.pageSize ?? pageSizeFallback,
      })
    : null
  const detectedPagination = detected
    ? describePagination(detected.spec, { pageSizeFallback })
    : null

  const handleUsePagination = () => {
    if (!detected) return
    const cur = (getConnectorDraftState().draft.streams.find((s) => s.id === stream.id)
      ?.requestConfig ?? {}) as Record<string, unknown>
    getConnectorDraftState().setRequestConfig(stream.id, { ...cur, pagination: detected.spec })
  }

  // Once the configured pagination already matches the detection, there's nothing
  // to apply — hide the whole proposal (otherwise "Use this" lingers after a click).
  const alreadyUsingDetected = !!(detected && samePaginationSpec(pagination, detected.spec))
  const hasDetected = !!(detectedPagination && detected && !alreadyUsingDetected)

  return (
    <Section
      title='Pagination'
      icon={<Waypoints className='size-4' />}
      initialOpen
      collapsible={false}
      // No body in the common case (just the header badge) — drop the section's
      // `pb-4` so it sits flush with the sibling sections, matching Sample/Schema.
      className={hasDetected ? undefined : '[&_[data-slot=section]]:pb-0'}
      description='How this fetch reads through multiple pages.'
      actions={<PaginationBadge description={configuredPagination} />}>
      {hasDetected && detectedPagination && detected && (
        <div className='flex items-center gap-2 px-1'>
          <span className='text-xs text-muted-foreground'>Detected from test fetch</span>
          <PaginationBadge description={detectedPagination} note={detected.note} />
          {SHOW_USE_DETECTED_PAGINATION && (
            <Button variant='outline' size='xs' onClick={handleUsePagination}>
              Use this
            </Button>
          )}
        </div>
      )}
    </Section>
  )
}

/** The pagination `kind` Badge (e.g. "Single page") with its plain-language tooltip. */
function PaginationBadge({
  description,
  note,
}: {
  description: PaginationDescription
  note?: string
}) {
  return (
    <Tooltip contentComponent={<PaginationTooltip description={description} note={note} />}>
      <span className='inline-flex'>
        <Badge variant='blue' size='sm'>
          {description.badge}
        </Badge>
      </span>
    </Tooltip>
  )
}

/** Plain-language tooltip body: how the fetch advances, when it stops, page size. */
function PaginationTooltip({
  description,
  note,
}: {
  description: PaginationDescription
  note?: string
}) {
  return (
    <div className='flex max-w-xs flex-col gap-1.5'>
      <p>{description.summary}</p>
      {description.details.length > 0 && (
        <dl className='flex flex-col gap-1'>
          {description.details.map((d) => (
            <div key={d.label} className='flex gap-2'>
              <dt className='w-24 shrink-0 opacity-70'>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {note && <p className='text-amber-600 dark:text-amber-500'>{note}</p>}
    </div>
  )
}

/** Shallow spec equality — pagination specs are flat records of scalars. */
function samePaginationSpec(a?: PaginationSpec, b?: PaginationSpec): boolean {
  if (!a || !b) return false
  const byKey = ([x]: [string, unknown], [y]: [string, unknown]) => x.localeCompare(y)
  const ea = Object.entries(a).sort(byKey)
  const eb = Object.entries(b).sort(byKey)
  if (ea.length !== eb.length) return false
  return ea.every(([k, v], i) => k === eb[i]?.[0] && v === eb[i]?.[1])
}

/** Pull a numeric page-size from common limit-style query params, for the size row. */
function numericParam(params?: Record<string, unknown>): number | undefined {
  for (const key of ['limit', 'per_page', 'page_size', 'maxResults', 'pageSize']) {
    const value = params?.[key]
    if (typeof value === 'number') return value
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  }
  return undefined
}
