// apps/extension/src/iframe/routes/root/types.ts

import type { PageOperation } from '../../../lib/messaging'
import type { ParsedCompany, ParsedPerson } from '../../../lib/parsers/types'

/**
 * Shared types and labels for the root capture flow. The state-machine
 * `Phase`, the host/target detector's `Target`, and the dedup-result
 * `ExistingMatch` shape all live here so the supporting modules
 * (detection, lookups, field-value builders, views) can import without
 * pulling the orchestrator file in.
 */

export type EntityType = 'contact' | 'company'

export type SupportedHost =
  | 'gmail'
  | 'linkedin'
  | 'sales-navigator'
  | 'twitter'
  | 'facebook'
  | 'instagram'

export const HOST_LABEL: Record<SupportedHost, string> = {
  gmail: 'Gmail',
  linkedin: 'LinkedIn',
  'sales-navigator': 'Sales Navigator',
  twitter: 'X',
  facebook: 'Facebook',
  instagram: 'Instagram',
}

/** FILE-field system attributes for avatar uploads, keyed by entity type. */
export const AVATAR_SYSTEM_ATTR: Record<EntityType, string> = {
  contact: 'contact_avatar',
  company: 'company_logo',
}

export type Target = {
  host: SupportedHost
  entityType: EntityType
  parseOp: PageOperation
}

/**
 * The active tab's URL + title, normalized. Captured once on boot for the
 * generic-site capture view. `hostname` is lowercased and www-stripped so
 * it can double as a company_domain value on save.
 */
export type GenericPage = {
  url: string
  title: string
  hostname: string
}

/**
 * One existing-match row for the "N similar found" list. Carries the
 * composite recordId (what `record.getById` takes) plus the entity type so
 * the click handler can push the right route variant without re-deriving
 * either from the recordId's entity-definition prefix. The display fields
 * are the denormalized EntityInstance columns surfaced by `lookupByField`
 * — used to render avatar + name + subtitle inline in the matches view.
 */
export type ExistingMatch = {
  recordId: string
  entityType: EntityType
  displayName: string | null
  secondaryDisplayValue: string | null
  avatarUrl: string | null
}

export type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'no-org' }
  | { kind: 'generic-site'; page: GenericPage | null; existingRecordId: string | null }
  | { kind: 'saving-generic'; page: GenericPage }
  | { kind: 'parsing'; target: Target }
  | {
      kind: 'ready'
      target: Target
      person: ParsedPerson | null
      company: ParsedCompany | null
      /**
       * All existing records matching the parse identity, across both
       * contact and company. Folk's "N similar found" list — clicking a
       * row pushes the corresponding detail route. Sorted with same-
       * entity-type-as-target hits first so the most likely hit shows up
       * top.
       */
      existingMatches: ExistingMatch[]
      /**
       * Lookup status. `loading` after parse but before the
       * `record.lookupByField` round-trip resolves. We need this
       * distinct from "loaded with zero matches" so the view doesn't
       * briefly render the capture form (no matches → ReadyToSaveView)
       * before the matches arrive — which is what produced the
       * "flash of Add-anyway view on back-navigation" bug.
       */
      matchesStatus: 'loading' | 'loaded'
      /**
       * Which Save button is mid-flight, if any. Drives the per-button
       * `loading` state without flipping the whole panel into the
       * "parsing" phase (which would unmount the parsed card).
       */
      savingAs: EntityType | null
    }
  | { kind: 'needs-fb-contact-info'; profileUrl: string }
  | { kind: 'error'; message: string }
