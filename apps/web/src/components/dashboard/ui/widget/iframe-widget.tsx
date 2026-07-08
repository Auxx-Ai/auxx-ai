// apps/web/src/components/dashboard/ui/widget/iframe-widget.tsx
'use client'

// Embed widget. Sandboxed iframe over the config URL (scheme already enforced
// http(s) by the layout-doc zod schema, plan 02). In edit mode an overlay div
// sits above the iframe so drag/resize gestures land on the grid instead of
// being swallowed by the frame.

import type { IframeConfig } from '@auxx/lib/dashboards/client'
import { WidgetUnconfigured } from './widget-states'

export function IframeWidget({
  config,
  isEditMode,
  onConfigure,
}: {
  config: IframeConfig
  isEditMode: boolean
  onConfigure?: () => void
}) {
  if (!config.url) {
    return <WidgetUnconfigured message='Add an embed URL' onConfigure={onConfigure} />
  }

  return (
    <div className='relative flex-1 min-h-0 overflow-hidden rounded-md border'>
      <iframe
        title='Embedded content'
        src={config.url}
        className='h-full w-full'
        sandbox='allow-scripts allow-forms allow-popups allow-same-origin'
        referrerPolicy='no-referrer'
        loading='lazy'
      />
      {/* Swallow pointer events during edit so the grid receives the drag. */}
      {isEditMode && <div className='absolute inset-0' aria-hidden />}
    </div>
  )
}
