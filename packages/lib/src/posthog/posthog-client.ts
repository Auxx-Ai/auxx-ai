import { configService } from '@auxx/credentials'
import { PostHog } from 'posthog-node'

export function PostHogClient() {
  const posthogKey = configService.get<string>('POSTHOG_KEY')
  if (!posthogKey) {
    return null
  }

  return new PostHog(posthogKey, {
    host: configService.get<string>('POSTHOG_HOST'),
    flushAt: 1,
    flushInterval: 0,
  })
}
