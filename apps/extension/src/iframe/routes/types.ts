// apps/extension/src/iframe/routes/types.ts

import type { ParsedCompany, ParsedPerson } from '../../lib/parsers/types'

/**
 * Route stack for the iframe.
 *
 * v1 keeps navigation in-memory (discriminated union + useState) rather than
 * pulling in a router. The stack always has `root` at the bottom; detail
 * routes are pushed on top and popped by the header's back button.
 */

export type Route =
  | { kind: 'root' }
  | {
      kind: 'contact'
      person: ParsedPerson
      existingRecordId: string | null
    }
  | {
      kind: 'company'
      company: ParsedCompany
      existingRecordId: string | null
    }

export type RouteStack = [Route, ...Route[]]

export const INITIAL_STACK: RouteStack = [{ kind: 'root' }]

export function titleFor(route: Route): string {
  switch (route.kind) {
    case 'root':
      return 'Auxx'
    case 'contact':
      return (
        route.person.fullName ??
        `${route.person.firstName ?? ''} ${route.person.lastName ?? ''}`.trim() ??
        'Contact'
      )
    case 'company':
      return route.company.name ?? route.company.domain ?? 'Company'
  }
}
