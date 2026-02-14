// packages/sdk/src/runtime/register-event-handler.ts

import { eventBus } from './event-bus.js'
import type { BaseTag } from './reconciler/tags/base-tag.js'
import { getComponentDisplayName, wrapEventHandler } from './wrap-event-handler.js'

/**
 * Registers an event handler prop with the global event bus.
 * Automatically handles:
 * - Registration on mount
 * - Updates when props change
 * - Cleanup on destroy
 * - Error wrapping
 */
export function registerEventHandler(tag: BaseTag, eventName: string): void {
  // Listen for mount: register handler if present
  const removeMountListener = tag.mounted.addListener(({ instance, props }) => {
    if (props[eventName]) {
      const componentDisplayName = getComponentDisplayName(props)
      const eventHandler =
        typeof props[eventName] === 'function'
          ? wrapEventHandler(props[eventName], {
              componentDisplayName,
              eventName,
            })
          : props[eventName]

      eventBus.setTagEventListener(eventName, instance.instance_id, eventHandler)
      console.log(`[EventHandler] Registered ${eventName} for instance ${instance.instance_id}`)
    }
  })

  // Listen for props change: update handler
  const removePropsChangeListener = tag.propsChanged.addListener(
    ({ instance, prevProps, nextProps }) => {
      if (prevProps[eventName] !== nextProps[eventName]) {
        // Clear old handler
        if (prevProps[eventName]) {
          eventBus.clearTagEventListener(eventName, instance.instance_id)
          console.log(`[EventHandler] Cleared ${eventName} for instance ${instance.instance_id}`)
        }

        // Register new handler
        if (nextProps[eventName]) {
          const componentDisplayName = getComponentDisplayName(nextProps)
          const eventHandler =
            typeof nextProps[eventName] === 'function'
              ? wrapEventHandler(nextProps[eventName], {
                  componentDisplayName,
                  eventName,
                })
              : nextProps[eventName]

          eventBus.setTagEventListener(eventName, instance.instance_id, eventHandler)
          console.log(`[EventHandler] Updated ${eventName} for instance ${instance.instance_id}`)
        }
      }
    }
  )

  // Listen for destroy: cleanup
  tag.destroyed.addListener(({ instance, props }) => {
    if (props[eventName]) {
      eventBus.clearTagEventListener(eventName, instance.instance_id)
      console.log(`[EventHandler] Destroyed ${eventName} for instance ${instance.instance_id}`)
    }

    // Remove lifecycle listeners to prevent memory leaks
    removeMountListener()
    removePropsChangeListener()
  })
}
