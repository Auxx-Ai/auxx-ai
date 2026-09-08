// packages/lib/src/dashboards/draft-edit/__tests__/support/org-fixtures.ts
//
// A small, fixed org for the normalization tests: four resources and their
// fields, shaped exactly as the `resources` org-cache key stores them. Not a
// test file.
//
// The point of the shapes here is that they reproduce the four traps the
// normalize modules exist to close: per-org ids that differ from every friendly
// name (`cust_def_1` vs "Project"), a select field whose option KEYS differ
// from its labels, a relationship for the one-hop path, and `thread` sitting in
// the cache like any other resource so a name-based resolver would happily
// return it.

import type { ResourceField } from '../../../../resources/registry/field-types'
import type { Resource } from '../../../../resources/registry/types'
import { BaseType } from '../../../../workflow-engine/core/types'

const CAPABILITIES = {
  filterable: true,
  sortable: true,
  creatable: true,
  updatable: true,
  configurable: true,
}

/** Loosely typed on purpose: the fixture states the shape the cache stores,
 * not the branded types the registry reads it back as. */
type FieldSpec = Record<string, unknown> & { key: string; label: string }

function field(over: FieldSpec): ResourceField {
  return {
    id: over.id ?? over.key,
    type: BaseType.STRING,
    capabilities: CAPABILITIES,
    ...over,
  } as unknown as ResourceField
}

export const TICKET_FIELDS: ResourceField[] = [
  field({
    id: 'fld_status',
    key: 'status',
    label: 'Status',
    type: BaseType.ENUM,
    fieldType: 'SINGLE_SELECT',
    dbColumn: 'status',
    options: {
      options: [
        { value: 'ACTIVE', label: 'Active' },
        { value: 'CLOSED', label: 'Closed' },
      ],
    },
  }),
  field({ id: 'fld_state', key: 'state', label: 'State' }),
  field({ id: 'fld_subject', key: 'subject', label: 'Subject' }),
  field({
    id: 'fld_company',
    key: 'company',
    label: 'Company',
    fieldType: 'RELATIONSHIP',
    relationship: { inverseResourceFieldId: 'cust_def_1:fld_tickets' },
  }),
]

export const PROJECT_FIELDS: ResourceField[] = [
  field({ id: 'fld_name', key: 'name', label: 'Name' }),
]

export const CONTACT_FIELDS: ResourceField[] = [
  field({ id: 'fld_email', key: 'email', label: 'Email' }),
]

/** `title` is column-backed; `wordCount` deliberately is not (system sources
 * can only aggregate direct columns). */
export const ARTICLE_FIELDS: ResourceField[] = [
  field({ id: 'title', key: 'title', label: 'Title', dbColumn: 'title' }),
  field({ id: 'wordCount', key: 'wordCount', label: 'Word count', type: BaseType.NUMBER }),
]

export const THREAD_FIELDS: ResourceField[] = [
  field({ id: 'subject', key: 'subject', label: 'Subject', dbColumn: 'subject' }),
]

type ResourceSpec = Record<string, unknown> & { id: string; label: string }

function resource(over: ResourceSpec): Resource {
  return {
    plural: `${over.label}s`,
    icon: 'circle',
    color: 'gray',
    isVisible: true,
    type: 'system',
    entityDefinitionId: over.id,
    fields: [],
    ...over,
  } as unknown as Resource
}

export const RESOURCES: Resource[] = [
  resource({
    id: 'ticket',
    label: 'Ticket',
    plural: 'Tickets',
    apiSlug: 'tickets',
    entityType: 'ticket',
    fields: TICKET_FIELDS,
  }),
  resource({
    id: 'contact',
    label: 'Contact',
    plural: 'Contacts',
    apiSlug: 'contacts',
    entityType: 'contact',
    fields: CONTACT_FIELDS,
  }),
  resource({
    id: 'thread',
    label: 'Thread',
    plural: 'Threads',
    apiSlug: 'threads',
    entityType: 'thread',
    fields: THREAD_FIELDS,
  }),
  resource({
    id: 'article',
    label: 'Article',
    plural: 'Articles',
    apiSlug: 'articles',
    entityType: 'article',
    fields: ARTICLE_FIELDS,
  }),
  // The per-org custom def: its id is a cuid nothing friendly looks like, which
  // is the whole reason source normalization exists.
  resource({
    id: 'cust_def_1',
    label: 'Project',
    plural: 'Projects',
    apiSlug: 'projects',
    type: 'custom',
    organizationId: 'org_1',
    fields: PROJECT_FIELDS,
  }),
]

/** `getCachedResourceFields` behaviour over {@link RESOURCES}. */
export function fieldsFor(resourceId: string): ResourceField[] {
  return RESOURCES.find((r) => r.id === resourceId)?.fields ?? []
}
