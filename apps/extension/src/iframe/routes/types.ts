// apps/extension/src/iframe/routes/types.ts

/**
 * Route stack for the iframe.
 *
 * v1 keeps navigation in-memory (discriminated union + useState) rather than
 * pulling in a router. The stack always has `root` at the bottom; detail
 * routes are pushed on top and popped by the header's back button.
 *
 * The root variant has a `view` discriminator so the matches→capture step
 * (folk's "Add anyway?" path) lives in the stack — that way the header's
 * back chevron handles the back-navigation for free instead of root having
 * to register a separate back-action override.
 *
 * Detail routes carry a composite `recordId` (`<entityDefinitionId>:<instanceId>`)
 * — the shape `record.lookupByField` and `record.getById` both speak — so the
 * route is fetch-driven rather than capture-driven.
 */

export type Route =
  | { kind: 'root'; view: 'matches' | 'capture' }
  | { kind: 'contact'; recordId: string }
  | { kind: 'company'; recordId: string }

export type RouteStack = [Route, ...Route[]]

export const INITIAL_STACK: RouteStack = [{ kind: 'root', view: 'matches' }]

/**
 * Strip the `<entityDefinitionId>:` prefix off a composite recordId so the
 * suffix can be used in `/app/contacts/[id]` / `/app/companies/[id]` deep
 * links. Server returns composite; deep-link routes take the bare instance id.
 */
export function instanceIdFromRecordId(recordId: string): string {
  const colon = recordId.indexOf(':')
  return colon === -1 ? recordId : recordId.slice(colon + 1)
}
