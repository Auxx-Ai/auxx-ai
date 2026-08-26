// apps/web/src/components/connections/ui/connection-targets.test.ts
import { describe, expect, it } from 'vitest'
import type { ConnectFlowDefinition } from '~/components/apps/hooks/use-connect-flow'
import { optionalScopesHeld, shouldOpenConnectDialog } from './connection-targets'

/**
 * The two pure decisions behind the optional-scope wiring
 * (`plans/connections/optional-oauth-scopes.md` §4.3, §4.4).
 */

describe('optionalScopesHeld — the reconnect seed', () => {
  const vocabulary = {
    oauth2Scopes: ['read_orders', 'write_orders'],
    oauth2OptionalScopes: ['read_all_orders', 'read_customers'],
  }

  it('re-requests exactly the optional scopes the connection was granted', () => {
    expect(optionalScopesHeld(['read_orders', 'read_all_orders'], vocabulary)).toEqual([
      'read_all_orders',
    ])
  })

  it('returns nothing when the connection has no granted scopes', () => {
    expect(optionalScopesHeld([], vocabulary)).toEqual([])
    expect(optionalScopesHeld(undefined, vocabulary)).toEqual([])
    expect(optionalScopesHeld(null, vocabulary)).toEqual([])
  })

  it('drops a granted scope the definition no longer declares optional', () => {
    // `read_customers` was retired from the optional list; the authorize route would intersect
    // it away, so it must never leave as `scope_add`.
    const narrowed = { ...vocabulary, oauth2OptionalScopes: ['read_all_orders'] }
    expect(optionalScopesHeld(['read_all_orders', 'read_customers'], narrowed)).toEqual([
      'read_all_orders',
    ])
  })

  it('never re-sends a floor scope as scope_add', () => {
    // The two lists are supposed to be disjoint; a row where they are not must still not
    // duplicate the always-requested floor into the additive list.
    const overlapping = {
      oauth2Scopes: ['read_orders'],
      oauth2OptionalScopes: ['read_orders', 'read_all_orders'],
    }
    expect(optionalScopesHeld(['read_orders', 'read_all_orders'], overlapping)).toEqual([
      'read_all_orders',
    ])
  })

  it('returns nothing when the definition declares no optional scopes', () => {
    expect(optionalScopesHeld(['read_all_orders'], { oauth2Scopes: ['read_orders'] })).toEqual([])
    expect(optionalScopesHeld(['read_all_orders'], {})).toEqual([])
  })

  it('follows the declared optional order and dedupes', () => {
    const duplicated = {
      oauth2Scopes: [],
      oauth2OptionalScopes: ['read_customers', 'read_all_orders', 'read_customers'],
    }
    expect(optionalScopesHeld(['read_all_orders', 'read_customers'], duplicated)).toEqual([
      'read_customers',
      'read_all_orders',
    ])
  })

  it('tolerates null columns on both sides', () => {
    expect(
      optionalScopesHeld(['read_all_orders'], {
        oauth2Scopes: null,
        oauth2OptionalScopes: null,
      })
    ).toEqual([])
  })
})

describe('shouldOpenConnectDialog — the fresh-connect trigger', () => {
  const oauth = (extra: Partial<ConnectFlowDefinition> = {}): ConnectFlowDefinition => ({
    connectionType: 'oauth2-code',
    ...extra,
  })

  it('opens for any definition that declares connection variables (unchanged behaviour)', () => {
    expect(
      shouldOpenConnectDialog(oauth({ connectionVariables: [{ key: 'shop', label: 'Shop' }] }))
    ).toBe(true)
  })

  it('still connects one-click for a bare OAuth definition with no optional scopes', () => {
    expect(shouldOpenConnectDialog(oauth())).toBe(false)
    expect(shouldOpenConnectDialog(oauth({ oauth2OptionalScopes: [] }))).toBe(false)
  })

  it('opens for a variable-less definition whose BYO client is mandatory', () => {
    // The picker renders immediately — without the dialog it would have nowhere to go (§4.3).
    expect(
      shouldOpenConnectDialog(
        oauth({ oauth2OptionalScopes: ['read_all_orders'], requiresOwnClient: true })
      )
    ).toBe(true)
  })

  it('opens for a variable-less definition that merely OFFERS a BYO client', () => {
    // `byoOpen` only exists inside the dialog, so the reachable form is used: refusing to open
    // would make the disclosure — and therefore the picker — unreachable.
    expect(
      shouldOpenConnectDialog(
        oauth({ oauth2OptionalScopes: ['read_all_orders'], ownClientOptional: true })
      )
    ).toBe(true)
  })

  it('stays one-click when optional scopes exist but BYO is neither required nor offered', () => {
    // `shouldOfferOptionalScopes` could never be true for this method, so the dialog would be
    // an empty extra click.
    expect(shouldOpenConnectDialog(oauth({ oauth2OptionalScopes: ['read_all_orders'] }))).toBe(
      false
    )
  })

  it('ignores optional scopes on a non-OAuth definition', () => {
    expect(
      shouldOpenConnectDialog({
        connectionType: 'client-credentials',
        oauth2OptionalScopes: ['read_all_orders'],
        ownClientOptional: true,
      })
    ).toBe(false)
  })
})
