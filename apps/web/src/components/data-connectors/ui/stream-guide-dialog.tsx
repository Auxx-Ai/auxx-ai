// apps/web/src/components/data-connectors/ui/stream-guide-dialog.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  GuideCode,
  GuideColumn,
  GuideColumns,
  GuideConcept,
  GuideConcepts,
  GuideDialog,
  GuidePage,
  GuideSection,
  GuideStep,
  GuideSteps,
} from '@auxx/ui/components/guide'
import {
  Braces,
  Brackets,
  ChevronRight,
  Database,
  FlaskConical,
  FunctionSquare,
  KeyRound,
  Link2,
  Pencil,
  RefreshCw,
  Waypoints,
} from 'lucide-react'
import { useEffect, useState } from 'react'

type StreamGuidePage = 'setup' | 'mapping'

/**
 * The stream help guide: a two-page `GuideDialog` covering everything needed to
 * wire up a stream. The "Setup" page walks the request: sample: schema: sync-mode
 * flow; the "Mapping" page explains the mapping editor. A `Setup › Mapping` header
 * (both always shown, the active one highlighted) switches between them, and the
 * body crossfades + height-springs.
 *
 * Both entry points open the SAME dialog: the stream bar / connector tabs open at
 * `setup`; the Mappings-section Help button deep-links at `mapping`. `isGenericRest`
 * hides the request/pagination copy for app-kind connectors, which don't expose
 * those controls.
 */
export function StreamGuideDialog({
  open,
  onOpenChange,
  initialPage = 'setup',
  isGenericRest = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Which page to land on when opened. Defaults to the setup walkthrough. */
  initialPage?: StreamGuidePage
  /** Hide request/pagination copy for app-kind connectors (no such controls). */
  isGenericRest?: boolean
}) {
  // Re-seed the page each time the dialog opens so a deep-linked entry point
  // always lands where it asked, regardless of where it was last closed.
  const [page, setPage] = useState<StreamGuidePage>(initialPage)
  useEffect(() => {
    if (open) setPage(initialPage)
  }, [open, initialPage])

  return (
    <GuideDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Stream guide'
      heading='Help'
      page={page}
      crumbs={[
        { label: 'Setup', active: page === 'setup', onClick: () => setPage('setup') },
        { label: 'Mapping', active: page === 'mapping', onClick: () => setPage('mapping') },
      ]}>
      <GuidePage
        value='setup'
        size='3xl'
        footer={
          <div className='flex items-center justify-between'>
            <p className='text-muted-foreground text-xs'>Press Esc to close</p>
            <Button variant='ghost' size='xs' onClick={() => setPage('mapping')}>
              Continue to mapping
              <ChevronRight />
            </Button>
          </div>
        }>
        <SetupGuideBody isGenericRest={isGenericRest} />
      </GuidePage>
      <GuidePage value='mapping' size='3xl'>
        <MappingGuideBody />
      </GuidePage>
    </GuideDialog>
  )
}

// ── Page 1: stream setup ──────────────────────────────────────────────────────

/**
 * The setup walkthrough: a numbered happy path mirroring the panel's real
 * section order, plus concept columns for the trickier vocabulary. The request
 * and pagination rows drop out for app-kind connectors.
 */
function SetupGuideBody({ isGenericRest }: { isGenericRest: boolean }) {
  return (
    <GuideColumns>
      {/* 1: the happy path, ordered like the panel itself */}
      <GuideColumn title='How a stream is set up'>
        <GuideSteps>
          {isGenericRest && (
            <GuideStep n={1} title='Request'>
              Point the stream at an endpoint: method and path, plus any headers, query params, or
              body.
            </GuideStep>
          )}
          <GuideStep n={isGenericRest ? 2 : 1} title='Sample'>
            Run a test fetch to pull a few real records and see exactly what the source returns.
          </GuideStep>
          <GuideStep n={isGenericRest ? 3 : 2} title='Source schema'>
            Lock in the shape of one record: derived from your sample, or edited by hand.
          </GuideStep>
          <GuideStep n={isGenericRest ? 4 : 3} title='Sync mode'>
            Choose whether each run re-reads everything or only what changed.
          </GuideStep>
          <GuideStep n={isGenericRest ? 5 : 4} title='Map the data'>
            Project that shape onto your definitions: that's the last step, on the{' '}
            <em className='not-italic text-foreground'>Mapping</em> page.
          </GuideStep>
        </GuideSteps>
      </GuideColumn>

      {/* 2: fetching the data */}
      <GuideColumn title='Fetching'>
        <GuideConcepts>
          <GuideConcept
            glyph={<FlaskConical className='size-3.5 text-muted-foreground' />}
            term='Sample'>
            A single live request against the source. It powers schema detection and the pagination
            hint: nothing is written to your data.
          </GuideConcept>
          {isGenericRest && (
            <GuideConcept
              glyph={
                <Badge variant='blue' size='xs'>
                  pagination
                </Badge>
              }
              term='Pagination'
              inlineGlyph>
              How the fetch walks through multiple pages of results. Detected from your test fetch;
              the badge shows what's configured.
            </GuideConcept>
          )}
        </GuideConcepts>
      </GuideColumn>

      {/* 3: shape & sync */}
      <GuideColumn title='Shape & sync'>
        <GuideConcepts>
          <GuideConcept
            glyph={<Database className='size-3.5 text-muted-foreground' />}
            term='Source schema'>
            The fields one record contains. Predefined for some connectors, auto-detected from a
            sample, or hand-edited{' '}
            <Pencil className='inline size-3 translate-y-px text-muted-foreground' />.
          </GuideConcept>
          <GuideConcept
            glyph={<RefreshCw className='size-3.5 text-muted-foreground' />}
            term='Snapshot'>
            Re-fetches the entire dataset each run. Records that vanish upstream are treated as
            deleted.
          </GuideConcept>
          <GuideConcept
            glyph={<Waypoints className='size-3.5 text-muted-foreground' />}
            term='Incremental'>
            Uses a saved cursor to fetch only what changed since the last run. Nothing is archived.
          </GuideConcept>
        </GuideConcepts>
      </GuideColumn>
    </GuideColumns>
  )
}

// ── Page 2: mapping ───────────────────────────────────────────────────────────

/**
 * The mapping explainer (formerly `MappingHelpDialog`): the editor's vocabulary
 * with the SAME glyphs/badges the editor uses. Sync mode now lives on the setup
 * page, so it's dropped from "Going further" here to avoid saying it twice.
 */
function MappingGuideBody() {
  return (
    <>
      <GuideColumns>
        {/* 1: the happy path */}
        <GuideColumn title='How mapping works'>
          <GuideSteps>
            <GuideStep n={1} title='Pick a record source'>
              Choose the part of the payload that becomes one record. An array like{' '}
              <GuideCode>orders[]</GuideCode>{' '}
              <Brackets className='inline size-3 text-muted-foreground' /> fans out to one record
              per item; a single object maps once ("whole payload"{' '}
              <Braces className='inline size-3 text-muted-foreground' />
              ).
            </GuideStep>
            <GuideStep n={2} title='Send it to a definition'>
              Map that source onto a target: Contact, Ticket, or your own definition. One source can
              fan out to several.
            </GuideStep>
            <GuideStep n={3} title='Bind fields'>
              Connect source values to fields on that definition. Fields you don't map are left
              untouched.
            </GuideStep>
            <GuideStep n={4} title='Mark an External ID'>
              <span className='inline-flex items-baseline gap-1'>
                <KeyRound className='size-3 translate-y-0.5 text-primary' />
                Set at least one field as the key
              </span>{' '}
              so re-syncs update the same record instead of creating duplicates.
            </GuideStep>
          </GuideSteps>
        </GuideColumn>

        {/* 2: identity */}
        <GuideColumn title='Keys'>
          <GuideConcepts>
            <GuideConcept
              glyph={<KeyRound className='size-3.5 text-primary' />}
              term='External ID'
              example={
                <>
                  A Shopify order's <GuideCode>id</GuideCode>: on the next sync the same order
                  updates in place instead of creating a duplicate.
                </>
              }>
              The upstream's primary key. Dedupes the record across every sync and anchors links
              that point at it. Set one per record.
            </GuideConcept>
            <GuideConcept
              glyph={<KeyRound className='size-3.5 text-amber-500' />}
              term='Match existing'
              example={
                <>
                  Match a customer on <GuideCode>email</GuideCode>: the order attaches to the
                  Contact you already have instead of creating a second one.
                </>
              }>
              A secondary key (e.g. email). If a record with this value already exists, attach to it
              instead of creating a new one: the External ID stays primary.
            </GuideConcept>
            <GuideConcept
              glyph={<KeyRound className='size-3.5 text-muted-foreground/40' />}
              term='Not an identifier'>
              A normal field: no effect on identity.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>

        {/* 3: how records get written */}
        <GuideColumn title='How records are written'>
          <GuideConcepts>
            <GuideConcept
              glyph={
                <Badge variant='amber' size='xs'>
                  contributing
                </Badge>
              }
              term='Contributing'
              inlineGlyph>
              Default. Writes into an existing, shared definition; updates only the fields you
              mapped and never removes records.
            </GuideConcept>
            <GuideConcept
              glyph={
                <Badge variant='violet' size='xs'>
                  owned
                </Badge>
              }
              term='Owned'
              inlineGlyph>
              The connector owns these records in their own definition: it can even clean up ones
              that disappear upstream.
            </GuideConcept>
            <GuideConcept
              glyph={
                <span className='flex flex-wrap gap-1'>
                  <Badge variant='default' size='xs'>
                    Always update
                  </Badge>
                  <Badge variant='sky' size='xs'>
                    Only if empty
                  </Badge>
                  <Badge variant='emerald' size='xs'>
                    Keep manual edits
                  </Badge>
                </span>
              }
              term='Per-field update rule'
              inlineGlyph>
              On each bound field, choose whether a synced value overwrites what's already there.
            </GuideConcept>
            <GuideConcept
              glyph={<Link2 className='size-3.5 text-muted-foreground' />}
              term='Relationship link'>
              Point a relationship field at a related definition via a foreign-key value. Resolved
              by identity, so sync order doesn't matter.
            </GuideConcept>
          </GuideConcepts>
        </GuideColumn>
      </GuideColumns>

      {/* Advanced: sync mode is intentionally absent (it lives on the setup page). */}
      <GuideSection title='Going further'>
        <GuideConcept
          glyph={<Brackets className='size-3.5 text-muted-foreground' />}
          term='Fan-out into nested records'>
          Drill into a nested array like <GuideCode>line_items[]</GuideCode> to project it onto its
          own definition: one child record per element, linked back to the parent.
        </GuideConcept>
        <GuideConcept term='Records deleted upstream'>
          For owned records, anything that vanishes from the source is archived automatically on the
          next full (snapshot) sync. Contributing records are never removed.
        </GuideConcept>
        <GuideConcept
          glyph={<FunctionSquare className='size-3.5 text-muted-foreground' />}
          term='Formula fields'>
          Compute a value from one or more source fields instead of binding a single value.
        </GuideConcept>
      </GuideSection>
    </>
  )
}
