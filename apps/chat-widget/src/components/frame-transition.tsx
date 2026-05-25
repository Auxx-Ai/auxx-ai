// apps/chat-widget/src/components/frame-transition.tsx
//
// Cross-fade / slide between two panel frames. The shell renders its current
// frame as `children`; when `viewKey` changes, the previous render is frozen
// as an "exiting" layer that slides off while the new render slides in. The
// snapshot uses Preact vnode reuse — when the keyed wrapper for the previous
// viewKey stays mounted across the swap, the underlying PanelShell is not
// remounted, so its subscriptions (Pusher, thread fetches) survive the
// animation.

import type { ComponentChildren, VNode } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'

export type SlideDirection = 'from-right' | 'from-left'

interface Exiting {
  key: string
  children: ComponentChildren
  direction: SlideDirection
}

interface FrameTransitionProps {
  viewKey: string
  direction: SlideDirection
  children: VNode | ComponentChildren
}

export function FrameTransition({ viewKey, direction, children }: FrameTransitionProps) {
  const lastKeyRef = useRef(viewKey)
  const lastChildrenRef = useRef<ComponentChildren>(children)
  const [exiting, setExiting] = useState<Exiting | null>(null)

  // Detect viewKey change during render so the entering+exiting layers are
  // committed in the same paint — avoids a one-frame flash where the new
  // content shows without its slide-in animation.
  if (lastKeyRef.current !== viewKey && (!exiting || exiting.key !== lastKeyRef.current)) {
    setExiting({
      key: lastKeyRef.current,
      children: lastChildrenRef.current,
      direction,
    })
  }

  useLayoutEffect(() => {
    lastKeyRef.current = viewKey
    lastChildrenRef.current = children
  })

  const handleExitEnd = (e: AnimationEvent) => {
    if (e.target !== e.currentTarget) return
    setExiting(null)
  }

  return (
    <div
      className={`auxx-chat-frame-transition ${exiting ? 'auxx-chat-frame-transition--animating' : ''}`}>
      {exiting ? (
        <div
          key={exiting.key}
          className='auxx-chat-frame-layer auxx-chat-frame--exiting'
          data-direction={exiting.direction}
          onAnimationEnd={handleExitEnd}>
          {exiting.children}
        </div>
      ) : null}
      <div
        key={viewKey}
        className={`auxx-chat-frame-layer ${exiting ? 'auxx-chat-frame--entering' : ''}`}
        data-direction={direction}>
        {children}
      </div>
    </div>
  )
}
