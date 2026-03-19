// packages/lib/src/posthog/posthog-client.ts
import { configService } from '@auxx/credentials'
import { PostHog } from 'posthog-node'

let instance: PostHog | null | undefined // undefined = not yet initialized, null = no key configured

/** Returns a shared PostHog client, or null when POSTHOG_KEY is not set. */
export function getPostHogClient(): PostHog | null {
  if (instance !== undefined) return instance

  const key = configService.get<string>('POSTHOG_KEY')
  if (!key) {
    instance = null
    return null
  }

  instance = new PostHog(key, {
    host: configService.get<string>('POSTHOG_HOST'),
    flushAt: 20,
    flushInterval: 10_000,
  })
  return instance
}

/** Flushes pending events and tears down the singleton. Call during graceful shutdown. */
export async function shutdownPostHog(): Promise<void> {
  if (instance) {
    await instance.shutdown()
    instance = undefined
  }
}

/** @deprecated Use `getPostHogClient()` instead. */
export const PostHogClient = getPostHogClient
