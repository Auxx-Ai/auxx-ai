// packages/sdk/src/runtime/wrap-event-handler.ts

/**
 * Wraps event handler with error handling for sync and async errors.
 */
export function wrapEventHandler(
  handler: Function,
  options: {
    componentDisplayName?: string | null
    eventName: string
  }
): Function {
  return (...args: any[]) => {
    try {
      const returnValue = handler(...args)

      // Handle promise rejections
      if (returnValue instanceof Promise) {
        returnValue.catch((error) => {
          console.error(
            `[EventHandler] Unhandled Promise Rejection in ${options.eventName}` +
            (options.componentDisplayName ? ` in ${options.componentDisplayName}` : ''),
            error
          )
        })
      }

      return returnValue
    } catch (error) {
      console.error(
        `[EventHandler] Uncaught Error in ${options.eventName}` +
        (options.componentDisplayName ? ` in ${options.componentDisplayName}` : ''),
        error
      )
      return null
    }
  }
}

/**
 * Get component display name from props if available.
 */
export function getComponentDisplayName(props: Record<string, any>): string | null {
  const prop = props['componentDisplayName']
  if (typeof prop === 'string') {
    return prop
  }
  return null
}
