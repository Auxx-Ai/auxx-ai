// apps/web/src/components/editor/placeholders/field-shim.ts

import type { OrgSlug, UserSlug, VisitorSlug } from '@auxx/lib/placeholders/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import { BaseType } from '@auxx/lib/workflow-engine/types'
import type { FieldId } from '@auxx/types/field'

/**
 * Synthesize a `ResourceField` for a synthetic `org:<slug>` token so
 * `FieldInputRow` can render a fallback editor for it.
 *
 * Organization has no `CustomField` rows — the placeholder resolver reads
 * its three columns (`name`, `handle`, `website`) directly off the
 * `Organization` DB row. The shim carries the minimum fields `FieldInputRow`
 * needs: `id`, `label`, `fieldType`, `type`, `required`, `capabilities`.
 */
export function shimFieldForOrg(slug: OrgSlug): ResourceField {
  const label = ORG_LABELS[slug]
  const fieldType = slug === 'website' ? 'URL' : 'TEXT'
  return {
    id: `org:${slug}` as FieldId,
    key: slug,
    label,
    type: BaseType.STRING,
    fieldType,
    required: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true,
      configurable: false,
    },
  }
}

const ORG_LABELS: Record<OrgSlug, string> = {
  name: 'Name',
  handle: 'Handle',
  website: 'Website',
}

/**
 * Synthesize a `ResourceField` for a synthetic `user:<slug>` token.
 * User tokens resolve against the sender's cached `userProfile` row on
 * the server, so every fallback-supported slug is plain TEXT (or EMAIL).
 */
export function shimFieldForUser(slug: UserSlug): ResourceField {
  const label = USER_LABELS[slug]
  const fieldType = slug === 'email' ? 'EMAIL' : 'TEXT'
  return {
    id: `user:${slug}` as FieldId,
    key: slug,
    label,
    type: BaseType.STRING,
    fieldType,
    required: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true,
      configurable: false,
    },
  }
}

const USER_LABELS: Record<UserSlug, string> = {
  id: 'ID',
  email: 'Email',
  name: 'Name',
  firstName: 'First Name',
  lastName: 'Last Name',
}

/**
 * Synthesize a `ResourceField` for a synthetic `visitor:<slug>` token. Used
 * by the chat-widget greeting template; resolved client-side from the
 * widget's identify() claims, so all fallback-supported slugs are TEXT (or
 * EMAIL).
 */
export function shimFieldForVisitor(slug: VisitorSlug): ResourceField {
  const label = VISITOR_LABELS[slug]
  const fieldType = slug === 'email' ? 'EMAIL' : 'TEXT'
  return {
    id: `visitor:${slug}` as FieldId,
    key: slug,
    label,
    type: BaseType.STRING,
    fieldType,
    required: false,
    capabilities: {
      filterable: false,
      sortable: false,
      creatable: false,
      updatable: true,
      configurable: false,
    },
  }
}

const VISITOR_LABELS: Record<VisitorSlug, string> = {
  name: 'Name',
  email: 'Email',
  externalId: 'External ID',
}
