// apps/web/src/components/dashboard/lib/widget-filter-fields.test.ts
//
// The widget filter builder used to offer every field on the source resource.
// The query builders DROP a condition they cannot compile — deliberately, so a
// stored view naming a retired field still renders — which meant an author could
// build `from is customer@x.com` on a thread widget, see it saved, and get the
// UNFILTERED list back. `inbox is X` next to it worked (real column), so the
// failure read as a data problem rather than a dropped filter.
//
// The fixtures below are copied field-for-field from
// `packages/lib/src/resources/registry/resources/thread-fields.ts` — the real
// registry can't be imported here (it lives behind the server barrel, which
// pulls bullmq & friends into a jsdom test), so each case names the registry row
// it mirrors and only carries the keys the gate reads.

import type { WidgetSource } from '@auxx/lib/dashboards/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { describe, expect, it } from 'vitest'
import { isWidgetFilterableField } from './widget-filter-fields'

const threadSource: WidgetSource = { kind: 'system', tableId: 'thread' }
const entitySource: WidgetSource = { kind: 'entity', entityDefinitionId: 'edf_contact' }

const CAPS = {
  filterable: true,
  sortable: false,
  creatable: false,
  updatable: false,
  configurable: false,
}

function field(over: Partial<ResourceField> = {}): ResourceField {
  return {
    id: 'f',
    key: 'f',
    label: 'F',
    type: 'string',
    capabilities: CAPS,
    ...over,
  } as unknown as ResourceField
}

describe('isWidgetFilterableField — system source (thread)', () => {
  it.each([
    ['subject', 'subject'],
    ['status', 'status'],
    ['assignee', 'assigneeId'],
    ['inbox', 'inboxId'],
    ['lastMessageAt', 'lastMessageAt'],
  ])('offers %s — a real column the system builder compares against', (key, dbColumn) => {
    expect(
      isWidgetFilterableField(field({ key, dbColumn, systemAttribute: key as never }), threadSource)
    ).toBe(true)
  })

  it.each([
    'from',
    'to',
    'body',
    'freeText',
    'hasAttachments',
    'hasDraft',
    'sent',
  ])('hides %s — a mail-query predicate with no column, dropped fail-open by the system builder', (key) => {
    // Registry shape: `dbColumn: undefined`, filterable, not a relation.
    expect(
      isWidgetFilterableField(
        field({ key, dbColumn: undefined, systemAttribute: key as never }),
        threadSource
      )
    ).toBe(false)
  })

  it('hides visitIp — a column-less scalar the builder has no typed comparison for', () => {
    // Registry shape: no `dbColumn` key at all, FieldValue-backed, but SCALAR —
    // `isFieldValueBackedRelation` excludes it, and so does the builder.
    expect(
      isWidgetFilterableField(
        field({ key: 'visitIp', systemAttribute: 'visit_ip' as never }),
        threadSource
      )
    ).toBe(false)
  })

  it('offers tags — column-less, but an OWNING relation routed to a FieldValue subquery', () => {
    expect(
      isWidgetFilterableField(
        field({
          key: 'tags',
          systemAttribute: 'thread_tags' as never,
          relationship: { relationshipType: 'has_many', isInverse: false } as never,
        }),
        threadSource
      )
    ).toBe(true)
  })

  it('hides messages — the INVERSE side of an FK, so no FieldValue row exists to find', () => {
    expect(
      isWidgetFilterableField(
        field({
          key: 'messages',
          systemAttribute: 'thread_messages' as never,
          relationship: { relationshipType: 'has_many', isInverse: true } as never,
        }),
        threadSource
      )
    ).toBe(false)
  })

  it('hides a non-filterable field even when it has a column', () => {
    expect(
      isWidgetFilterableField(
        field({
          key: 'subject',
          dbColumn: 'subject',
          capabilities: { ...CAPS, filterable: false },
        }),
        threadSource
      )
    ).toBe(false)
  })

  it('hides a hidden field', () => {
    expect(
      isWidgetFilterableField(
        field({ key: 'subject', dbColumn: 'subject', capabilities: { ...CAPS, hidden: true } }),
        threadSource
      )
    ).toBe(false)
  })
})

describe('isWidgetFilterableField — entity source', () => {
  it('offers a column-less custom field — EntityInstance fields resolve through FieldValue', () => {
    expect(isWidgetFilterableField(field({ key: 'notes' }), entitySource)).toBe(true)
  })

  it('still respects filterable', () => {
    expect(
      isWidgetFilterableField(
        field({ key: 'notes', capabilities: { ...CAPS, filterable: false } }),
        entitySource
      )
    ).toBe(false)
  })
})
