// apps/web/src/lib/extensions/components/workflow/utility/conditional-render.tsx

/**
 * ConditionalRender component.
 * Conditionally renders children based on the evaluated condition result.
 * The condition is evaluated on the SDK side, so this component only receives
 * the boolean result.
 */
export const ConditionalRender = ({ shouldRender, children }: any) => {
  // If condition was false, don't render anything
  if (!shouldRender) {
    return null
  }

  // Render children directly
  return <>{children}</>
}
