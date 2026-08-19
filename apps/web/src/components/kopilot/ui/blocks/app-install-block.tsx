// apps/web/src/components/kopilot/ui/blocks/app-install-block.tsx

'use client'

import { AppInstallCard } from '~/components/apps/ui/app-install-card'
import type { BlockRendererProps } from './block-registry'
import type { AppInstallData } from './block-schemas'
import { useStreamSafeIds } from './use-stream-safe-ids'

/**
 * `auxx:app-install` — offer to install a marketplace app, and then to connect
 * an account for it, without ever navigating away from the surface the chat is
 * sitting in (the workflow builder, typically).
 *
 * The state machine itself lives in {@link AppInstallCard}, shared with the
 * workflow builder's uninstalled-app-node panel. All this block adds is the
 * stream-safety guard below.
 */
export function AppInstallBlock({ data, lastValueTruncated }: BlockRendererProps<AppInstallData>) {
  // Mid-stream the fence reads `{"appSlug":"u` — withhold the slug until its
  // JSON string is closed, or the card would query and 404 on a prefix and
  // flash "not available" before the real slug lands.
  const [appSlug] = useStreamSafeIds(data.appSlug ? [data.appSlug] : [], lastValueTruncated)
  if (!appSlug) return null

  return (
    <div className='not-prose my-2'>
      <AppInstallCard appSlug={appSlug} />
    </div>
  )
}
