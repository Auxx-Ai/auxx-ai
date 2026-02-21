// apps/web/src/instrumentation.ts

/** Called once by Next.js when the server starts. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureWebAppInitialized } = await import('~/server/bootstrap')
    await ensureWebAppInitialized()
  }
}
