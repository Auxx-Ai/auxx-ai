// packages/ui/src/components/autosize-input.tsx
'use client'

import * as React from 'react'

/** Props for the AutosizeInput component */
export interface AutosizeInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'style'> {
  /** Ref to expose imperative methods (React 19: ref as prop) */
  ref?: React.Ref<AutosizeInputRef>
  /** Minimum width of the input in pixels */
  minWidth?: number
  /** Maximum width of the input in pixels */
  maxWidth?: number
  /** Additional width to add to the calculated width (default: 2) */
  extraWidth?: number
  /** Use placeholder width as minimum width */
  placeholderIsMinWidth?: boolean
  /** Callback when input width changes */
  onAutosize?: (newWidth: number) => void
  /** Custom styles for the input element */
  inputStyle?: React.CSSProperties
  /** Custom className for the input element */
  inputClassName?: string
  /** Custom styles for the wrapper element */
  wrapperStyle?: React.CSSProperties
}

/** Ref handle for imperative methods */
export interface AutosizeInputRef {
  /** Focus the input element */
  focus: () => void
  /** Blur the input element */
  blur: () => void
  /** Select all text in the input */
  select: () => void
  /** Get the underlying input element */
  getInput: () => HTMLInputElement | null
}

/** Sizer element styles (hidden, used for measurement) */
const sizerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  visibility: 'hidden',
  height: 0,
  overflow: 'scroll',
  whiteSpace: 'pre',
}

/** Properties to copy from input to sizer for accurate measurement */
const STYLE_PROPS_TO_COPY = [
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'textTransform',
] as const

/**
 * Copy relevant styles from input to sizer element for accurate width measurement
 */
function copyStyles(inputStyles: CSSStyleDeclaration, sizerNode: HTMLElement): void {
  for (const prop of STYLE_PROPS_TO_COPY) {
    sizerNode.style[prop] = inputStyles[prop]
  }
}

/**
 * AutosizeInput - An input that automatically adjusts its width based on content
 *
 * @example
 * ```tsx
 * <AutosizeInput
 *   value={name}
 *   onChange={(e) => setName(e.target.value)}
 *   placeholder="Enter name"
 *   minWidth={100}
 *   maxWidth={400}
 * />
 * ```
 */
function AutosizeInput({
  value,
  defaultValue,
  placeholder,
  minWidth = 1,
  maxWidth,
  extraWidth,
  placeholderIsMinWidth = false,
  onAutosize,
  inputStyle,
  inputClassName,
  wrapperStyle,
  className,
  type,
  ref,
  ...inputProps
}: AutosizeInputProps) {
  // Refs
  const inputRef = React.useRef<HTMLInputElement>(null)
  const sizerRef = React.useRef<HTMLDivElement>(null)
  const placeholderSizerRef = React.useRef<HTMLDivElement>(null)

  // State
  const [inputWidth, setInputWidth] = React.useState(minWidth)

  // Expose imperative methods
  React.useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    blur: () => inputRef.current?.blur(),
    select: () => inputRef.current?.select(),
    getInput: () => inputRef.current,
  }))

  /**
   * Copy input styles to sizer elements for accurate measurement
   */
  const copyInputStyles = React.useCallback(() => {
    if (!inputRef.current || typeof window === 'undefined' || !window.getComputedStyle) return

    const inputStyles = window.getComputedStyle(inputRef.current)

    if (sizerRef.current) {
      copyStyles(inputStyles, sizerRef.current)
    }
    if (placeholderSizerRef.current) {
      copyStyles(inputStyles, placeholderSizerRef.current)
    }
  }, [])

  /**
   * Calculate and update input width based on content
   */
  const updateInputWidth = React.useCallback(() => {
    if (!sizerRef.current || typeof sizerRef.current.scrollWidth === 'undefined') {
      return
    }

    let newWidth: number

    // Calculate width based on content and placeholder
    if (
      placeholder &&
      (!value || (value && placeholderIsMinWidth)) &&
      placeholderSizerRef.current
    ) {
      newWidth = Math.max(sizerRef.current.scrollWidth, placeholderSizerRef.current.scrollWidth) + 2
    } else {
      newWidth = sizerRef.current.scrollWidth + 2
    }

    // Add extra width (defaults to 16 for number inputs to accommodate stepper)
    const effectiveExtraWidth =
      type === 'number' && extraWidth === undefined ? 16 : parseInt(String(extraWidth), 10) || 0
    newWidth += effectiveExtraWidth

    // Apply min/max constraints
    if (newWidth < minWidth) {
      newWidth = minWidth
    }
    if (maxWidth && newWidth > maxWidth) {
      newWidth = maxWidth
    }

    // Only update if changed
    if (newWidth !== inputWidth) {
      setInputWidth(newWidth)
      onAutosize?.(newWidth)
    }
  }, [
    value,
    placeholder,
    placeholderIsMinWidth,
    minWidth,
    maxWidth,
    extraWidth,
    type,
    inputWidth,
    onAutosize,
  ])

  // Copy styles on mount and when input element changes
  React.useLayoutEffect(() => {
    copyInputStyles()
  }, [copyInputStyles])

  // Update width when relevant props change
  React.useLayoutEffect(() => {
    updateInputWidth()
  }, [updateInputWidth])

  // Determine sizer value (controlled value, default value, or empty string)
  // Replace spaces with non-breaking spaces and add zero-width space at end
  // so trailing whitespace is measured correctly by scrollWidth
  const rawSizerValue = String(value ?? defaultValue ?? '')

  const sizerValue = rawSizerValue.replace(/ /g, '\u00A0') + '\u200b'
  // Combined input styles
  const combinedInputStyle: React.CSSProperties = {
    boxSizing: 'content-box',
    width: `${inputWidth}px`,
    ...inputStyle,
  }

  // Combined wrapper styles
  const combinedWrapperStyle: React.CSSProperties = {
    display: 'inline-block',
    ...wrapperStyle,
  }

  return (
    <div className={className} style={combinedWrapperStyle}>
      <input
        ref={inputRef}
        type='text'
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={inputClassName}
        style={combinedInputStyle}
        {...inputProps}
      />

      {/* Hidden sizer for content width measurement */}
      <div ref={sizerRef} style={sizerStyle} aria-hidden='true'>
        {sizerValue}
      </div>

      {/* Hidden sizer for placeholder width measurement */}
      {placeholder && (
        <div ref={placeholderSizerRef} style={sizerStyle} aria-hidden='true'>
          {placeholder}
        </div>
      )}
    </div>
  )
}

export { AutosizeInput }
export default AutosizeInput
