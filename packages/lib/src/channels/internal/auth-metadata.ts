// packages/lib/src/channels/internal/auth-metadata.ts

/**
 * Drop the `auth` block from an `Integration.metadata` blob.
 *
 * That block is failure state owned by `AuthErrorHandler`: the last classified
 * error plus `consecutiveFailures`, the counter that flips `enabled` to false
 * once it reaches `DISABLE_THRESHOLD`. Nothing clears it except a *successful
 * sync* — which a disabled channel can never run — so every path that proves the
 * credential works again has to drop it explicitly. Leaving it behind means the
 * counter survives the recovery and the next single auth blip re-disables the
 * channel on its first strike.
 */
export function withAuthFailuresCleared(metadata: unknown): Record<string, unknown> {
  const base =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {}
  delete base.auth
  return base
}
