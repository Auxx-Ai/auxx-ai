// packages/ui/src/components/autosize-field.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

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

/** Styles for hidden width measurement sizer */
const WIDTH_SIZER_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  visibility: 'hidden',
  height: 0,
  overflow: 'scroll',
  whiteSpace: 'pre',
}

/** Properties to copy from textarea to width sizer for accurate measurement */
const WIDTH_STYLE_PROPS_TO_COPY = [
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'textTransform',
  'paddingLeft',
  'paddingRight',
] as const

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
  /** Additional styles (height/width may be overridden) */
  style?: React.CSSProperties
  /** Enable width auto-sizing based on content (default: false) */
  autoWidth?: boolean
  /** Minimum width in pixels when autoWidth is enabled */
  minWidth?: number
  /** Maximum width in pixels when autoWidth is enabled */
  maxWidth?: number
  /** Callback fired when width changes (only when autoWidth is enabled) */
  onWidthChange?: (width: number) => void
}

/**
 * An auto-resizing textarea that adjusts its height based on content.
 * Optionally auto-sizes width when autoWidth prop is enabled.
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
      autoWidth = false,
      minWidth,
      maxWidth,
      onWidthChange,
      value,
      variant,
      className,
      style,
      ...props
    },
    forwardedRef
  ) {
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const widthSizerRef = React.useRef<HTMLDivElement>(null)
    const combinedRef = useCombinedRef(textareaRef, forwardedRef)

    const heightRef = React.useRef(0)
    const widthRef = React.useRef(0)
    const cachedSizingInfoRef = React.useRef<SizingInfo | null>(null)

    const isControlled = value !== undefined

    /**
     * Copy styles from textarea to width sizer for accurate measurement
     */
    const copyStylesToSizer = React.useCallback(() => {
      if (!textareaRef.current || !widthSizerRef.current || typeof window === 'undefined') return

      const computedStyles = window.getComputedStyle(textareaRef.current)
      for (const prop of WIDTH_STYLE_PROPS_TO_COPY) {
        ;(widthSizerRef.current.style as any)[prop] = computedStyles[prop]
      }
    }, [])

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

    /**
     * Recalculates and applies the textarea width (when autoWidth is enabled).
     */
    const recalculateWidth = React.useCallback(() => {
      if (!autoWidth) return

      const textarea = textareaRef.current
      const sizer = widthSizerRef.current
      if (!textarea || !sizer) return

      // Measure content width using the sizer
      let newWidth = sizer.scrollWidth + 2 // +2 for cursor space

      // Apply min/max constraints
      if (minWidth !== undefined && newWidth < minWidth) {
        newWidth = minWidth
      }
      if (maxWidth !== undefined && newWidth > maxWidth) {
        newWidth = maxWidth
      }

      // Only update if changed
      if (widthRef.current !== newWidth) {
        widthRef.current = newWidth
        textarea.style.setProperty('width', `${newWidth}px`, 'important')
        onWidthChange?.(newWidth)
      }
    }, [autoWidth, minWidth, maxWidth, onWidthChange])

    /**
     * Recalculates both height and width
     */
    const recalculateSize = React.useCallback(() => {
      recalculateHeight()
      recalculateWidth()
    }, [recalculateHeight, recalculateWidth])

    // Copy styles to sizer on mount
    React.useLayoutEffect(() => {
      if (autoWidth) {
        copyStylesToSizer()
      }
    }, [autoWidth, copyStylesToSizer])

    // Recalculate on mount and when dependencies change
    React.useLayoutEffect(() => {
      recalculateSize()
    })

    // Listen for window resize
    useWindowResize(recalculateSize)

    // Listen for font loading
    useFontLoading(recalculateSize)

    /**
     * Handles textarea input changes.
     */
    const handleChange = React.useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (!isControlled) {
          recalculateSize()
        }
        onChange?.(event)
      },
      [isControlled, onChange, recalculateSize]
    )

    // Sizer value for width measurement
    const sizerValue = (value as string) ?? ''

    return (
      <>
        <textarea
          {...props}
          data-slot='autosize'
          ref={combinedRef}
          value={value}
          onChange={handleChange}
          className={cn(autosizeFieldVariants({ variant, className }))}
          style={style}
        />
        {/* Hidden sizer for width measurement (only rendered when autoWidth is enabled) */}
        {autoWidth && (
          <div ref={widthSizerRef} style={WIDTH_SIZER_STYLE} aria-hidden='true'>
            {sizerValue || 'x'}
          </div>
        )}
      </>
    )
  }
)

AutosizeField.displayName = 'AutosizeField'

export { autosizeFieldVariants }
