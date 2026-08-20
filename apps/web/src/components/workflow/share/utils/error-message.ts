// apps/web/src/components/workflow/share/utils/error-message.ts

/**
 * Read a human-readable message out of a failed share-API response body.
 *
 * The public share surface talks to two APIs that disagree on the shape of an
 * error: the Next.js route handlers answer `{ error: 'message' }`, the Hono API
 * answers `{ success: false, error: { code, message } }`. Every caller here used
 * to read `body.message`, which neither of them sets — so every failure on the
 * public page rendered its generic fallback, whatever the server actually said.
 */
export function readErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback

  const { error, message } = body as { error?: unknown; message?: unknown }

  if (typeof error === 'string' && error) return error
  if (typeof error === 'object' && error !== null) {
    const nested = (error as { message?: unknown }).message
    if (typeof nested === 'string' && nested) return nested
  }
  if (typeof message === 'string' && message) return message

  return fallback
}
