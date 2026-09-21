// packages/lib/src/accounting/documents/document-entry-key.ts

/**
 * The claim and document-number key for one generation of a document's entry.
 *
 * Generation 1 is the internal number verbatim and must stay so, or every
 * document already in a ledger re-keys. A repost cannot reuse it: Save reverses
 * the original at `-R1`, which frees the claim but leaves the number standing on
 * the reversed row, so generation N > 1 keys on `<number>-G<N>`.
 */
export function documentEntryKey(internalNumber: string, generation: number): string | undefined {
  return generation > 1 ? `${internalNumber}-G${generation}` : undefined
}
