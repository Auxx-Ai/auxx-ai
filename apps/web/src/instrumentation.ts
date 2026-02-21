// apps/web/src/instrumentation.ts

import { ensureWebAppInitialized } from '~/server/bootstrap'

/** Called once by Next.js when the server starts. */
export async function register(): Promise<void> {
  await ensureWebAppInitialized()
}
