// packages/lib/src/files/storage/cache-port.ts

/**
 * The production {@link CachePort} — the implementation Phase 2 deliberately did
 * not write, and the last of the three ports to get one.
 *
 * Until this file existed, `FilesDeps.cache` was an interface with a test double
 * and no producer, so the two cache busts on the upload path stayed as
 * `await import('../../cache')` *inside the handlers that needed them*
 * (`upload/handlers/user-profile.ts`, `upload/handlers/chat-widget.ts`). That
 * cost two things worth more than the file it saved:
 *
 * 1. **The ordering assertion did not cover them.** `complete.test.ts` proves
 *    "nothing but database statements between `BEGIN` and `COMMIT`" by reading a
 *    journal every *port* writes to. A bust issued through a lazy import is
 *    invisible to that journal, so the one guarantee the ports exist to provide
 *    was passing vacuously for exactly the two calls that violated it in
 *    production (`ChatWidgetProcessor` busted `channel.settings_updated` from
 *    inside the route's open transaction — guide §10.3).
 * 2. **Two lazy-import sites instead of one.** The reason both were lazy is real
 *    — `cache/providers/user-profile-provider.ts` imports `files/`, so a
 *    module-scope edge from `files/` back into `cache/` closes a cycle. That is
 *    a fact about *this* file's imports, not about ten handlers'. It is stated
 *    once here and nowhere else.
 *
 * It lives beside `ports.ts` rather than inside it for the same reason
 * `queue-port.ts` does: `ports.ts` is reached by `files/ctx.ts` and by every read
 * path that only wants a `StoragePort`, and dragging the cache singletons and
 * the dehydration service into that graph to presign a URL is the cost
 * `FilesDepsSlice` exists to avoid.
 *
 * ## Why the imports are dynamic
 *
 * `cache/register-providers.ts` registers `userProfileProvider`, which imports
 * `files/assets/download.ts` and `files/storage/ports.ts`. A static
 * `import { onCacheEvent } from '../../cache'` here would put `files/server.ts`
 * and `cache/index.ts` in one cycle, whose resolution order depends on which
 * barrel the bundler reaches first. Both imports are inside the methods, so the
 * edge exists only at call time — after the transaction has committed, on a path
 * that has already done S3 and Postgres round-trips, where one resolved module
 * lookup is free.
 *
 * ## This port does not swallow
 *
 * Same policy as {@link createProductionQueuePort}: fail-open is a *call-site*
 * decision. `upload/post-commit.ts` wraps every hook in a `try/catch` because
 * "nothing after `COMMIT` may fail the request" is a property of that pipeline;
 * a future caller that wants a failed bust to be fatal must be able to have one.
 */

import type { CachePort } from './ports'

/**
 * Build the production {@link CachePort}.
 *
 * Zero-argument: neither door is org-scoped at construction — `bust` takes its
 * scope in the payload and `invalidateUser` in its argument.
 */
export function createProductionCachePort(): CachePort {
  return {
    /**
     * Declarative invalidation, straight through to `onCacheEvent`.
     *
     * The `event` cast is the one place the port's stringly-typed surface meets
     * the typed catalogue. Deliberate: typing `CachePort.bust` as
     * `(event: CacheEvent, …)` would make `files/ctx.ts` — imported by every read
     * path — depend on `cache/invalidation-graph.ts`, which is the graph this
     * file's header exists to keep open. An unknown event name is a no-op inside
     * `onCacheEvent` (`if (!mapping) return`), not a throw.
     */
    bust: async (event, payload) => {
      const { onCacheEvent } = await import('../../cache')
      type Args = Parameters<typeof onCacheEvent>
      await onCacheEvent(event as Args[0], payload as Args[1])
    },

    /**
     * Drop the user's dehydrated snapshot.
     *
     * `DehydrationService` rather than `DehydrationCacheService` directly, so
     * this goes through the same door as the other four producers
     * (`permissions/profiles/profile-invalidation.ts`,
     * `permissions/capabilities/grant-service.ts`,
     * `organizations/organization-service.ts`) and cannot drift from them.
     */
    invalidateUser: async (userId) => {
      const { DehydrationService } = await import('../../dehydration')
      await new DehydrationService().invalidateUser(userId)
    },
  }
}
