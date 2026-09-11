// packages/sdk/src/client/host-events.ts

import { EventBroker } from '../runtime/event-broker.js'

/**
 * Notifications the host pushes INTO an app, as opposed to the requests the
 * host makes of it (`render-component`, `execute-workflow-block`, and the rest
 * of the internal protocol).
 *
 * ## Why the wire is generic and the exports are not
 *
 * All of this travels over ONE message type, `host-event`, carrying
 * `{ name, payload }`. Adding a second kind of notification later is a new
 * `name` and a new narrow export here; it is not a new wire type, and it needs
 * no change on the host.
 *
 * What is deliberately NOT exported is a raw `onHostEvent(name, cb)`. Every
 * public API in this SDK is a purpose-built wrapper (`useRecord`, `useWorkflow`,
 * `toasts`) and `Host` itself is internal, so no app has ever named an internal
 * message string. Exposing one would mean apps could subscribe to
 * `render-workflow-panel` or `cleanup-node-render`, and that we could not rename
 * an internal message without breaking installed apps. Narrowing a published
 * API later is impossible; widening this one is a one-line addition.
 */

/** The payload of a `settings-changed` notification. */
export interface SettingsChangedEvent {
  /** Which installation's settings moved. An app may have both. */
  installationType: 'development' | 'production'
}

const brokers = new Map<string, EventBroker<any>>()

function brokerFor(name: string): EventBroker<any> {
  const existing = brokers.get(name)
  if (existing) return existing
  const created = new EventBroker<any>()
  brokers.set(name, created)
  return created
}

/**
 * INTERNAL. Called by the platform runtime when a `host-event` arrives; not
 * exported from `@auxx/sdk/client`.
 */
export function dispatchHostEvent(name: string, payload: unknown): void {
  brokers.get(name)?.trigger(payload)
}

/**
 * Subscribe to this app's settings being saved. Returns an unsubscribe function.
 *
 * The reason this exists: the app runtime iframe is long-lived and pooled per
 * installation (`AppStore._messageClients`), so module state inside an app
 * survives navigation around the host. An app that caches anything derived from
 * its settings will therefore serve a stale answer until a full page reload.
 * That is not hypothetical; it shipped, as a workflow panel that kept offering
 * read-only operations after an admin had enabled writes.
 *
 * Treat it as a cache-invalidation signal, not as a source of truth: it tells
 * you settings changed, not what they now are. Re-read them.
 *
 * @example
 * ```typescript
 * useEffect(() => onSettingsChanged(() => { cached = null; refetch() }), [])
 * ```
 */
export function onSettingsChanged(callback: (event: SettingsChangedEvent) => void): () => void {
  return brokerFor('settings-changed').addListener(callback)
}
