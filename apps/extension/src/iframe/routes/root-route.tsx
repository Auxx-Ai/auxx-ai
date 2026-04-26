// apps/extension/src/iframe/routes/root-route.tsx

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ParseResult } from '../../lib/parsers/types'
import { useRouteStack } from '../hooks/use-route-stack'
import { createRecord, reportParserHealth, type SessionResponse, TrpcCallError } from '../trpc'
import { invokeOnPage, OWN_TAB_ID, readOwnTab } from './root/chrome-tab'
import { detectTarget, facebookContactInfoUrl, readGenericPage } from './root/detect-target'
import {
  buildAvatarFieldValue,
  buildCompanyFieldValues,
  buildContactFieldValues,
  companyToPerson,
  personToCompany,
} from './root/field-values'
import { findExistingByGenericPage, findExistingInEntity } from './root/lookups'
import type { EntityType, ExistingMatch, Phase, Target } from './root/types'
import { PhaseView } from './root/views'

/**
 * The capture-from-this-page flow. Lives inside the iframe shell's main
 * area when the route stack is `[root]`. Responsible for:
 *   - detecting supported host + target entity (contact vs company) from the
 *     active tab
 *   - invoking the parser via the background RPC
 *   - deduping against the network (externalId → primaryEmail fallback)
 *   - rendering parsed fields + Save / Open CTAs
 *
 * Signed-out / no-org cases short-circuit with the existing CTAs.
 *
 * Supporting code (types, host detection, Chrome plumbing, field-value
 * builders, lookups, view components) lives under `./root/`. This file
 * keeps just the orchestrator: the `Phase` state machine + effects + the
 * Save handlers.
 */

type Props = {
  session: SessionResponse
}

export function RootRoute({ session }: Props) {
  const { top: routeTop, push: routePush, replace: routeReplace } = useRouteStack()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  // Bumped whenever we want to force a re-parse (session change, or the
  // `panelOpened` broadcast from the SW after the user clicks the toolbar
  // button on a different profile). Without this the boot effect sticks on
  // its first `ready` state and never picks up SPA navigation.
  const [rebootToken, setRebootToken] = useState(0)
  // Tracks the (session, url) the boot effect last consumed so duplicate
  // tabNavigated/panelOpened events for an unchanged URL don't re-trigger
  // parse + reportParserHealth + lookupByField. Without this guard a
  // single SPA pushState burst (Instagram fires several per real
  // navigation) costs us N round-trips per burst.
  const lastBootedKey = useRef<string | null>(null)

  // SW broadcasts on:
  //   - `panelOpened` — every showFrame/toggleFrame
  //   - `tabNavigated` — URL changes (including SPA pushState inside LinkedIn)
  // Either signal bumps the boot effect so we re-detect + re-parse.
  //
  // Both broadcasts go to every iframe in every tab via
  // chrome.runtime.sendMessage. We must filter on tabId so a navigation
  // in tab 4 doesn't trigger a re-parse in tab 3's iframe — without this
  // filter, every URL change anywhere causes every open iframe to re-read
  // the active tab and re-parse, which is what was driving the
  // continuous lookup loop.
  useEffect(() => {
    const handler = (msg: unknown): void => {
      if (typeof msg !== 'object' || msg === null) return
      const m = msg as { type?: string; tabId?: number }
      if (m.type !== 'panelOpened' && m.type !== 'tabNavigated') return
      if (OWN_TAB_ID !== null && typeof m.tabId === 'number' && m.tabId !== OWN_TAB_ID) return
      setRebootToken((n) => n + 1)
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  // Boot: auth + active tab → detect target. Re-runs on session change and
  // on every panelOpened bump.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebootToken is a tick counter that intentionally forces this effect to re-run without being referenced inside the body.
  useEffect(() => {
    let cancelled = false

    async function boot() {
      if (!session.signedIn) {
        setPhase({ kind: 'signed-out' })
        lastBootedKey.current = 'signed-out'
        return
      }
      if (!session.state.organizationId) {
        setPhase({ kind: 'no-org' })
        lastBootedKey.current = 'no-org'
        return
      }
      const tab = await readOwnTab()
      if (cancelled) return
      // Skip when we've already booted this exact (org, url) pair —
      // suppresses the parse/lookup storm when the SW broadcasts
      // tabNavigated for an unchanged URL (or for a URL we just parsed).
      const key = `${session.state.organizationId}::${tab?.url ?? ''}`
      if (lastBootedKey.current === key) return
      lastBootedKey.current = key
      const target = detectTarget(tab?.url)
      if (!target) {
        setPhase({ kind: 'generic-site', page: readGenericPage(tab), existingRecordId: null })
        return
      }
      // Facebook only parses from the About → Contact and Basic Info tab.
      // Route the user there via a hint before attempting the parse.
      if (target.host === 'facebook' && tab?.url) {
        try {
          const hintUrl = facebookContactInfoUrl(new URL(tab.url))
          if (hintUrl) {
            setPhase({ kind: 'needs-fb-contact-info', profileUrl: hintUrl })
            return
          }
        } catch {
          /* bad url — fall through to parse */
        }
      }
      setPhase({ kind: 'parsing', target })
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [session, rebootToken])

  // Parse + (async, non-blocking) dedup.
  useEffect(() => {
    if (phase.kind !== 'parsing') return
    let cancelled = false
    const target = phase.target

    async function run() {
      const result = await invokeOnPage<ParseResult>(target.parseOp)
      if (cancelled) return

      // Parser health is informational, don't await.
      void reportParserHealth({
        host: target.host,
        url: window.location.href,
        parsed: !!result && (result.people.length > 0 || result.companies.length > 0),
        extensionVersion: chrome.runtime.getManifest().version,
      }).catch(() => {
        /* swallow */
      })

      // Facebook special case: the parser self-detects person vs company
      // (Pages and People share the same URL shape). Re-route entityType
      // from the result rather than inventing an "either" Target variant.
      const resolvedTarget: Target =
        target.host === 'facebook' && (result?.companies.length ?? 0) > 0
          ? { ...target, entityType: 'company' }
          : target

      const person = resolvedTarget.entityType === 'contact' ? (result?.people[0] ?? null) : null
      const company =
        resolvedTarget.entityType === 'company' ? (result?.companies[0] ?? null) : null

      setPhase({
        kind: 'ready',
        target: resolvedTarget,
        person,
        company,
        existingMatches: [],
        matchesStatus: 'loading',
        savingAs: null,
      })

      // Cross-entity dedup: the "Save as contact / Save as company" buttons
      // mean a prior capture may live under either entity. Check both in
      // parallel; prefer a match in the primary entity type, fall back to
      // the other.
      if (!person && !company) return
      const primary = resolvedTarget.entityType
      const other: EntityType = primary === 'contact' ? 'company' : 'contact'
      const parseExternalId = person?.externalId ?? company?.externalId ?? null
      // Don't gate on `cancelled` here — it flips to true on the normal
      // parsing→ready transition (the cleanup below runs when phase
      // changes), which would silently drop the lookup result. The
      // setPhase updater already guards against stale state via
      // `current.kind` + externalId identity checks.
      void Promise.all([
        findExistingInEntity(primary, person, company),
        findExistingInEntity(other, person, company),
      ]).then(([primaryHits, otherHits]) => {
        // Same-entity-type hits first (matches the Save button's primary
        // pick), then cross-entity hits. Dedup by composite recordId in
        // case lookupByField returned the same row from both branches.
        const merged: ExistingMatch[] = []
        const seen = new Set<string>()
        for (const m of [...primaryHits, ...otherHits]) {
          if (seen.has(m.recordId)) continue
          seen.add(m.recordId)
          merged.push(m)
        }
        // Always flip matchesStatus to 'loaded' even when there are zero
        // hits — the empty-result case is a meaningful state (capture
        // view), distinct from "still checking" (loading state).
        setPhase((current) => {
          if (current.kind !== 'ready') return current
          const currentExternalId =
            current.person?.externalId ?? current.company?.externalId ?? null
          if (currentExternalId !== parseExternalId) return current
          return { ...current, existingMatches: merged, matchesStatus: 'loaded' }
        })
      })
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [phase])

  // Generic-site dedup: look up company by `website:<host>` externalId or
  // company_domain so unsupported pages flip to "Already in Auxx" instead of
  // offering Save twice for the same host.
  useEffect(() => {
    if (phase.kind !== 'generic-site' || !phase.page) return
    const page = phase.page
    let cancelled = false
    void findExistingByGenericPage(page).then((existing) => {
      if (cancelled || !existing) return
      setPhase((current) =>
        current.kind === 'generic-site' && current.page?.hostname === page.hostname
          ? { ...current, existingRecordId: existing }
          : current
      )
    })
    return () => {
      cancelled = true
    }
  }, [phase])

  /**
   * After a successful save, navigate to the newly-created record's
   * detail view. If the user came via "Add anyway?" (root.capture sub-
   * view), `replace` it so the back chevron returns to the matches root
   * — not to a now-stale capture form. Otherwise (saved from a no-
   * matches root.matches view, or from generic-site capture), `push`
   * so back returns to where they were.
   *
   * `created.recordId` is the composite `<entityDef>:<instance>` that
   * the detail route fetches via `record.getById`.
   */
  const navigateToDetail = useCallback(
    (entityType: EntityType, recordId: string) => {
      const target = { kind: entityType, recordId } as const
      if (routeTop.kind === 'root' && routeTop.view === 'capture') {
        routeReplace(target)
      } else {
        routePush(target)
      }
    },
    [routeTop, routePush, routeReplace]
  )

  const handleSaveGenericCompany = useCallback(async () => {
    if (phase.kind !== 'generic-site' || !phase.page) return
    const page = phase.page
    setPhase({ kind: 'saving-generic', page })
    try {
      const created = await createRecord({
        entityDefinitionId: 'company',
        values: {
          company_name: page.title,
          company_domain: page.hostname,
          company_notes: page.url,
          external_id: [`website:${page.hostname}`],
        },
      })
      navigateToDetail('company', created.recordId)
    } catch (err) {
      setPhase({ kind: 'error', message: saveErrorMessage(err) })
    }
  }, [phase, navigateToDetail])

  const handleSaveAs = useCallback(
    async (entityType: EntityType) => {
      if (phase.kind !== 'ready') return
      if (phase.savingAs) return
      // Snapshot the ready phase so the avatar upload + create can run
      // without us flipping back to "parsing" (which would unmount the
      // suggestions list and lose the in-flight `savingAs` flag).
      const ready = phase
      setPhase({ ...ready, savingAs: entityType })
      try {
        if (entityType === 'contact') {
          const person = ready.person ?? companyToPerson(ready.company)
          if (!person) {
            setPhase({ kind: 'error', message: 'Nothing to save.' })
            return
          }
          const avatarValue = await buildAvatarFieldValue('contact', person.avatarUrl)
          const created = await createRecord({
            entityDefinitionId: 'contact',
            values: { ...buildContactFieldValues(person), ...avatarValue },
          })
          navigateToDetail('contact', created.recordId)
          return
        }
        const company = ready.company ?? personToCompany(ready.person)
        if (!company) {
          setPhase({ kind: 'error', message: 'Nothing to save.' })
          return
        }
        const avatarValue = await buildAvatarFieldValue('company', company.avatarUrl)
        const created = await createRecord({
          entityDefinitionId: 'company',
          values: { ...buildCompanyFieldValues(company), ...avatarValue },
        })
        navigateToDetail('company', created.recordId)
      } catch (err) {
        setPhase({ kind: 'error', message: saveErrorMessage(err) })
      }
    },
    [phase, navigateToDetail]
  )

  return (
    <PhaseView
      phase={phase}
      onSaveAs={handleSaveAs}
      onSaveGenericCompany={handleSaveGenericCompany}
    />
  )
}

function saveErrorMessage(err: unknown): string {
  if (err instanceof TrpcCallError) {
    return `Save failed (${err.code ?? err.httpStatus ?? 'error'}): ${err.message}`
  }
  if (err instanceof Error) return err.message
  return 'Save failed.'
}
