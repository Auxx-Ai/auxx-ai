// packages/lib/src/data-connectors/connectors/stripe-financial-connections-type.ts

/**
 * The Financial Connections connector's `type` id, on its own.
 *
 * 🛑 **A leaf module with no imports, and that is the whole reason it exists.**
 * The connector implements `releaseOnDelete` by calling into `banking/feed/reaper`,
 * and the reaper has to name this type to find releasable feeds - so with the
 * constant living in the connector, the two modules import each other.
 *
 * The cycle would probably have worked (both sides use the other only inside
 * function bodies, never at module scope), but "probably" is not a property to
 * rely on: ESM cycles resolve to `undefined` bindings whenever evaluation order
 * shifts, and the failure here would be a silent one - a filter matching nothing
 * and a sweep that reports zero accounts to release while every one keeps billing.
 *
 * `stripe-financial-connections.ts` re-exports this, so every existing import
 * keeps working.
 */
export const STRIPE_FC_CONNECTOR_TYPE = 'stripe-financial-connections'
