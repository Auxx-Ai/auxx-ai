// packages/ui/src/components/autosize-field.tsx
'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@auxx/ui/lib/utils'

/** Variants for the AutosizeField component */
const autosizeFieldVariants = cva(
  // Base styles shared across all variants
  'flex w-full rounded-md px-3 py-2 text-sm ring-offset-background placeholder:text-primary-400 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 resize-none',
  {
    variants: {
      variant: {
        default:
          'border border-primary-200 focus-visible:ring-1 focus-visible:ring-blue-500 focus:border-primary-300 bg-primary-50 dark:bg-primary-100 focus:ring-primary-400',
        transparent: 'border-none bg-transparent shadow-none focus-visible:ring-0',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

/**
 * CSS properties to copy from the original textarea to the hidden measurement textarea.
 * These properties affect text rendering and sizing.
 */
const SIZING_STYLE_KEYS = [
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRightWidth',
  'borderTopWidth',
  'boxSizing',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'tabSize',
  'textIndent',
  'textRendering',
  'textTransform',
  'width',
  'wordBreak',
] as const

/** Styles applied to the hidden measurement textarea */
const HIDDEN_TEXTAREA_STYLE: Record<string, string> = {
  'min-height': '0',
  'max-height': 'none',
  height: '0',
  visibility: 'hidden',
  overflow: 'hidden',
  position: 'absolute',
  'z-index': '-1000',
  top: '0',
  right: '0',
}

/** Singleton hidden textarea used for height measurements */
let hiddenTextarea: HTMLTextAreaElement | null = null

/** Sizing info extracted from computed styles */
interface SizingInfo {
  sizingStyle: Record<string, string>
  paddingSize: number
  borderSize: number
}

/** Height calculation result */
interface HeightInfo {
  height: number
  rowHeight: number
}

/**
 * Applies hidden styles to a textarea element with !important priority.
 */
function applyHiddenStyles(element: HTMLTextAreaElement): void {
  Object.keys(HIDDEN_TEXTAREA_STYLE).forEach((key) => {
    element.style.setProperty(key, HIDDEN_TEXTAREA_STYLE[key]!, 'important')
  })
}

/**
 * Extracts sizing information from computed styles of a textarea.
 * Returns null if computed styles are unavailable.
 */
function getSizingInfo(element: HTMLTextAreaElement): SizingInfo | null {
  const computedStyle = window.getComputedStyle(element)

  if (computedStyle === null) {
    return null
  }

  const sizingStyle = SIZING_STYLE_KEYS.reduce(
    (acc, key) => {
      acc[key] = computedStyle.getPropertyValue(key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`))
      return acc
    },
    {} as Record<string, string>
  )

  const boxSizing = sizingStyle.boxSizing

  if (boxSizing === '') {
    return null
  }

  const paddingSize =
    parseFloat(sizingStyle.paddingBottom || '0') + parseFloat(sizingStyle.paddingTop || '0')

  const borderSize =
    parseFloat(sizingStyle.borderBottomWidth || '0') + parseFloat(sizingStyle.borderTopWidth || '0')

  return {
    sizingStyle,
    paddingSize,
    borderSize,
  }
}

/**
 * Calculates the scroll height accounting for box-sizing.
 */
function getScrollHeight(element: HTMLTextAreaElement, sizingInfo: SizingInfo): number {
  const scrollHeight = element.scrollHeight

  if (sizingInfo.sizingStyle.boxSizing === 'border-box') {
    return scrollHeight + sizingInfo.borderSize
  }

  return scrollHeight - sizingInfo.paddingSize
}

/**
 * Calculates the appropriate height for the textarea based on content,
 * minRows, and maxRows constraints.
 */
function calculateHeight(
  value: string,
  sizingInfo: SizingInfo,
  minRows: number = 1,
  maxRows: number = Infinity
): HeightInfo {
  // Create or reuse the hidden textarea
  if (!hiddenTextarea) {
    hiddenTextarea = document.createElement('textarea')
    hiddenTextarea.setAttribute('tabindex', '-1')
    hiddenTextarea.setAttribute('aria-hidden', 'true')
    applyHiddenStyles(hiddenTextarea)
  }

  // Ensure it's in the DOM
  if (hiddenTextarea.parentNode === null) {
    document.body.appendChild(hiddenTextarea)
  }

  const { sizingStyle, paddingSize, borderSize } = sizingInfo
  const boxSizing = sizingStyle.boxSizing

  // Apply sizing styles to hidden textarea
  Object.keys(sizingStyle).forEach((key) => {
    ;(hiddenTextarea!.style as Record<string, string>)[key] = sizingStyle[key]!
  })
  applyHiddenStyles(hiddenTextarea)

  // Measure the content height
  hiddenTextarea.value = value || 'x'
  let contentHeight = getScrollHeight(hiddenTextarea, sizingInfo)

  // Measure single row height
  hiddenTextarea.value = 'x'
  const rowHeight = hiddenTextarea.scrollHeight - paddingSize

  // Calculate min height based on minRows
  let minHeight = rowHeight * minRows
  if (boxSizing === 'border-box') {
    minHeight = minHeight + paddingSize + borderSize
  }
  contentHeight = Math.max(minHeight, contentHeight)

  // Calculate max height based on maxRows
  let maxHeight = rowHeight * maxRows
  if (boxSizing === 'border-box') {
    maxHeight = maxHeight + paddingSize + borderSize
  }
  contentHeight = Math.min(maxHeight, contentHeight)

  return {
    height: contentHeight,
    rowHeight,
  }
}

/**
 * Hook to listen for window resize events.
 */
function useWindowResize(callback: () => void): void {
  const callbackRef = React.useRef(callback)

  React.useLayoutEffect(() => {
    callbackRef.current = callback
  })

  React.useLayoutEffect(() => {
    const handler = () => callbackRef.current()
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
}

/**
 * Hook to listen for font loading events.
 */
function useFontLoading(callback: () => void): void {
  const callbackRef = React.useRef(callback)

  React.useLayoutEffect(() => {
    callbackRef.current = callback
  })

  React.useLayoutEffect(() => {
    const handler = () => callbackRef.current()

    if (document.fonts && typeof document.fonts.addEventListener === 'function') {
      document.fonts.addEventListener('loadingdone', handler)
      return () => document.fonts.removeEventListener('loadingdone', handler)
    }
  }, [])
}

/**
 * Combines multiple refs into one callback ref.
 */
function useCombinedRef<T>(
  internalRef: React.RefObject<T>,
  forwardedRef: React.ForwardedRef<T>
): React.RefCallback<T> {
  const previousRef = React.useRef<React.ForwardedRef<T>>(null)

  return React.useCallback(
    (instance: T | null) => {
      ;(internalRef as React.MutableRefObject<T | null>).current = instance

      // Clean up previous ref
      if (previousRef.current) {
        if (typeof previousRef.current === 'function') {
          previousRef.current(null)
        } else {
          previousRef.current.current = null
        }
      }

      previousRef.current = forwardedRef

      // Set new ref
      if (forwardedRef) {
        if (typeof forwardedRef === 'function') {
          forwardedRef(instance)
        } else {
          forwardedRef.current = instance
        }
      }
    },
    [forwardedRef, internalRef]
  )
}

/** Props for the AutosizeField component */
export interface AutosizeFieldProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'>,
    VariantProps<typeof autosizeFieldVariants> {
  /** Minimum number of rows to display */
  minRows?: number
  /** Maximum number of rows before scrolling */
  maxRows?: number
  /** Cache style measurements for better performance */
  cacheMeasurements?: boolean
  /** Callback fired when the height changes */
  onHeightChange?: (height: number, info: { rowHeight: number }) => void
  /** Additional styles (height will be overridden) */
  style?: React.CSSProperties
}

/**
 * An auto-resizing textarea that adjusts its height based on content.
 * Uses row-based constraints and proper computed style calculations.
 */
export const AutosizeField = React.forwardRef<HTMLTextAreaElement, AutosizeFieldProps>(
  function AutosizeField(
    {
      minRows = 1,
      maxRows,
      cacheMeasurements = false,
      onChange,
      onHeightChange,
      value,
      variant,
      className,
      style,
      ...props
    },
    forwardedRef
  ) {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const combinedRef = useCombinedRef(textareaRef, forwardedRef)

    const heightRef = React.useRef(0)
    const cachedSizingInfoRef = React.useRef<SizingInfo | null>(null)

    const isControlled = value !== undefined

    /**
     * Recalculates and applies the textarea height.
     */
    const recalculateHeight = React.useCallback(() => {
      const textarea = textareaRef.current
      if (!textarea) return

      // Get sizing info (cached or fresh)
      const sizingInfo =
        cacheMeasurements && cachedSizingInfoRef.current
          ? cachedSizingInfoRef.current
          : getSizingInfo(textarea)

      if (!sizingInfo) return

      if (cacheMeasurements) {
        cachedSizingInfoRef.current = sizingInfo
      }

      // Calculate new height
      const currentValue = textarea.value || textarea.placeholder || 'x'
      const { height, rowHeight } = calculateHeight(currentValue, sizingInfo, minRows, maxRows)

      // Apply height if changed
      if (heightRef.current !== height) {
        heightRef.current = height
        textarea.style.setProperty('height', `${height}px`, 'important')
        onHeightChange?.(height, { rowHeight })
      }
    }, [minRows, maxRows, cacheMeasurements, onHeightChange])

    // Recalculate on mount and when dependencies change
    React.useLayoutEffect(() => {
      recalculateHeight()
    })

    // Listen for window resize
    useWindowResize(recalculateHeight)

    // Listen for font loading
    useFontLoading(recalculateHeight)

    /**
     * Handles textarea input changes.
     */
    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (!isControlled) {
          recalculateHeight()
        }
        onChange?.(event)
      },
      [isControlled, onChange, recalculateHeight]
    )

    return (
      <textarea
        {...props}
        ref={combinedRef}
        value={value}
        onChange={handleChange}
        className={cn(autosizeFieldVariants({ variant, className }))}
        style={style}
      />
    )
  }
)

AutosizeField.displayName = 'AutosizeField'

export { autosizeFieldVariants }
