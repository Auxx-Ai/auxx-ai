// packages/lib/src/providers/vendor-modules.d.ts

/**
 * Ambient declarations for provider dependencies that ship no types.
 *
 * Without these, `tsc` reports TS7016 and the import resolves to `any`, which
 * per the §2.10 suppression rule hides every error derived from it. Both are
 * declared as narrowly as their single call site allows.
 */

declare module 'gmail-api-parse-message' {
  /**
   * Flattens a `gmail_v1.Schema$Message` into headers/textPlain/textHtml.
   * The real return shape is untyped; callers assert it to `ParsedGmailMessage`.
   */
  export default function parse(message: unknown): unknown
}

declare module 'planer' {
  /** Strips quoted reply chains from a message body. */
  export function extractFrom(text: string, contentType: string): string
  const planer: { extractFrom: typeof extractFrom }
  export default planer
}
