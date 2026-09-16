// packages/sdk/src/root/financial-source/types.ts

/**
 * The account a financial source read was made against. Every projected row
 * carries these three values verbatim, and they are the first three members of
 * the `sourceKey` tuple, so two providers — or the same provider's live and
 * test books — can never collide on one external id.
 */
export interface SourceAccount {
  /** Stable provider identifier, e.g. `shopify_payments` or `affirm`. */
  readonly providerKey: string
  /** The provider's own id for the account the rows were read from. */
  readonly externalAccountId: string
  /** Book the rows belong to, e.g. `live` or `test`. */
  readonly environment: string
}

/**
 * One read pass over the provider. Rows are stamped with the acquisition that
 * produced them so a later pass can be told apart from the one before it.
 */
export interface Acquisition {
  /** Identifier for this pass, e.g. `scan:456`. */
  readonly id: string
  /** ISO-8601 instant the pass began. */
  readonly startedAt: string
}

/**
 * A provider-shaped row, already normalized by the app. The platform reads it
 * through the declared field mappings, so its members stay deliberately open.
 */
export type SourceRow = Record<string, unknown>

/**
 * One row of a financial source field mapping — a provider-neutral source path
 * bound to a platform target attribute. Assignable to the data connector's
 * `ConnectorContributingFieldToTarget`.
 */
export interface FinancialSourceFieldMapping {
  /** Provider JSON path, relative to the mapping's `rootPath`. */
  readonly sourcePath: string
  /** Platform target attribute the value is written to. */
  readonly target: string
  /** Secondary identity-match key. Candidates are OR'd, so each one widens the match. */
  readonly match?: boolean | 'exclusive'
}
