// packages/lib/src/custom-fields/field-error.ts

/**
 * The widened error shape every custom-field mutation returns: always a `code`
 * and a `message`, plus a `cause` on the database-backed arms only.
 */
type FieldMutationError = { message: string; code: string; cause?: unknown }

/**
 * Build the `Error` a router throws for a failed `updateCustomField` /
 * `deleteCustomField` / `getRelationshipPair`, carrying the mutation error's own
 * `cause`.
 *
 * Only the database-backed errors carry a `cause`; the not-found, access-denied
 * and validation shapes are just a code and a message, so `cause` is `undefined`
 * for those — which is what these call sites have always thrown.
 *
 * Callers keep the `if (result.isErr()) throw …` shape rather than passing the
 * whole `Result` to a helper: each mutation returns a union of arms whose
 * `Err<T, E>` slots carry unrelated `T`s, so inferring the ok type through a
 * generic unwrap picks the wrong one.
 *
 * @param error - The error arm of the mutation's Result
 */
export function toFieldError(error: FieldMutationError): Error {
  return new Error(error.message, { cause: error.cause })
}

/**
 * Build the `Error` a router throws for a failed `createCustomField`, carrying
 * `{ code }` as the `cause`.
 *
 * The create dialog reads that code off the thrown error to tell a duplicate
 * field name apart from a validation failure, so this cause shape is a contract
 * with the frontend — it is deliberately NOT `error.cause`.
 *
 * @param error - The error arm of `createCustomField`'s Result
 */
export function toCreateFieldError(error: FieldMutationError): Error {
  return new Error(error.message, { cause: { code: error.code } })
}
