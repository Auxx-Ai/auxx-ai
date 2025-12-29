import * as React from 'react'
import {
  Children,
  type ReactElement,
  cloneElement,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react'
import { type ButtonProps } from '@auxx/ui/components/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@auxx/ui/lib/utils'

const buttonGroupVariants = cva('flex', {
  variants: {
    orientation: { horizontal: '', vertical: 'flex-col w-fit' },
    size: { default: '', sm: 'text-xs', lg: 'text-base' },
  },
  defaultVariants: { orientation: 'horizontal', size: 'default' },
})

export interface ButtonGroupProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof buttonGroupVariants> {
  /**
   * Determines if buttons function as toggles or standard buttons
   */
  mode?: 'default' | 'toggle'

  /**
   * For toggle mode, determines if only one button can be active (like radio)
   * or multiple (like checkboxes)
   */
  toggleMode?: 'single' | 'multiple'

  /**
   * Whether to style buttons with connected pill appearance
   */
  isPill?: boolean

  /**
   * Whether to enable keyboard navigation with arrow keys
   */
  enableKeyboardNavigation?: boolean

  /**
   * Initial selected indices (for uncontrolled component)
   */
  defaultValue?: number[]

  /**
   * Selected indices (for controlled component)
   */
  value?: number[]

  /**
   * Callback when selection changes (for controlled component)
   */
  onChange?: (selectedIndices: number[]) => void

  /**
   * Callback when a button is clicked
   * @param index Index of the clicked button
   * @param checked Whether the button is now checked (toggle mode only)
   * @param state Array of all currently selected indices
   */
  onClick?: (index: number, checked: boolean, state: number[]) => void

  /**
   * Button components to render in the group
   */
  children: ReactElement<ButtonProps>[]
}

/**
 * ButtonGroup component for grouping related buttons with optional toggle behavior.
 *
 * @example
 * // Basic usage
 * <ButtonGroup>
 *   <Button>Option 1</Button>
 *   <Button>Option 2</Button>
 *   <Button>Option 3</Button>
 * </ButtonGroup>
 *
 * @example
 * // Toggle mode (radio behavior)
 * <ButtonGroup
 *   mode="toggle"
 *   toggleMode="single"
 *   isPill
 *   onChange={(indices) => console.log('Selected:', indices)}
 * >
 *   <Button variant="outline">Option 1</Button>
 *   <Button variant="outline">Option 2</Button>
 *   <Button variant="outline">Option 3</Button>
 * </ButtonGroup>
 */
export function ButtonGroup({
  className,
  orientation = 'horizontal',
  size = 'default',
  mode = 'default',
  toggleMode = 'single',
  isPill = false,
  defaultValue = [],
  value,
  onChange,
  onClick,
  children,
  enableKeyboardNavigation = true,
  ...props
}: ButtonGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  const totalButtons = Children.count(children)
  const isToggleMode = mode === 'toggle'

  // State for uncontrolled usage
  const [internalSelectedIndices, setInternalSelectedIndices] = useState<number[]>(defaultValue)

  // Use value from props if provided (controlled) or internal state (uncontrolled)
  const selectedIndices = value !== undefined ? value : internalSelectedIndices

  // Store focus index for keyboard navigation
  const [focusIndex, setFocusIndex] = useState<number>(-1)

  const handleButtonClick = useCallback(
    (index: number) => {
      if (!isToggleMode) {
        // In default mode, just call onClick with the index, false for checked, and current state
        onClick?.(index, false, selectedIndices)
        return
      }

      const isCurrentlySelected = selectedIndices.includes(index)
      let newSelection: number[]

      if (toggleMode === 'single') {
        // Single selection: replace with just the clicked index or clear if already selected
        newSelection =
          isCurrentlySelected && selectedIndices.length === 1
            ? [] // Allow deselecting the only selected button
            : [index]
      } else {
        // Multiple selection: toggle the index
        newSelection = isCurrentlySelected
          ? selectedIndices.filter((i) => i !== index) // Remove if present
          : [...selectedIndices, index] // Add if not present
      }

      // Call the onClick handler
      onClick?.(index, !isCurrentlySelected, newSelection)

      // Call onChange if provided (for controlled usage)
      onChange?.(newSelection)

      // Update internal state for uncontrolled usage
      if (value === undefined) {
        setInternalSelectedIndices(newSelection)
      }

      // Update focus index for keyboard navigation
      setFocusIndex(index)
    },
    [isToggleMode, toggleMode, selectedIndices, value, onChange, onClick]
  )

  // Handle keyboard navigation
  useEffect(() => {
    if (!enableKeyboardNavigation || !groupRef.current) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle key events when the group or one of its buttons has focus
      if (!groupRef.current?.contains(document.activeElement)) return

      let newFocusIndex = focusIndex
      const isHorizontal = orientation === 'horizontal'

      switch (e.key) {
        case isHorizontal ? 'ArrowRight' : 'ArrowDown':
          e.preventDefault()
          newFocusIndex =
            focusIndex === -1 || focusIndex >= totalButtons - 1
              ? 0 // Wrap to first
              : focusIndex + 1
          break
        case isHorizontal ? 'ArrowLeft' : 'ArrowUp':
          e.preventDefault()
          newFocusIndex =
            focusIndex <= 0
              ? totalButtons - 1 // Wrap to last
              : focusIndex - 1
          break
        case 'Home':
          e.preventDefault()
          newFocusIndex = 0
          break
        case 'End':
          e.preventDefault()
          newFocusIndex = totalButtons - 1
          break
        case ' ':
        case 'Enter':
          // If a button has focus, simulate a click
          if (focusIndex !== -1 && buttonRefs.current[focusIndex]) {
            e.preventDefault()
            handleButtonClick(focusIndex)
          }
          return // Don't update focus index
        default:
          return // Don't handle other keys
      }

      // Focus the new button
      if (newFocusIndex !== focusIndex && buttonRefs.current[newFocusIndex]) {
        buttonRefs.current[newFocusIndex]?.focus()
        setFocusIndex(newFocusIndex)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusIndex, totalButtons, enableKeyboardNavigation, handleButtonClick, orientation])

  return (
    <div
      ref={groupRef}
      role={isToggleMode ? 'group' : undefined}
      aria-label="Button group"
      className={cn(buttonGroupVariants({ orientation, size }), className)}
      {...props}>
      {Children.map(children, (child, index) => {
        const isFirst = index === 0
        const isLast = index === totalButtons - 1
        const isSelected = selectedIndices.includes(index)
        const isHorizontal = orientation === 'horizontal'

        // Determine role and aria attributes for toggle mode
        const ariaProps = isToggleMode
          ? {
              role: toggleMode === 'single' ? 'radio' : 'checkbox',
              'aria-checked': isSelected,
              'aria-posinset': index + 1,
              'aria-setsize': totalButtons,
            }
          : {}

        return cloneElement(child, {
          ref: (el: HTMLButtonElement) => {
            buttonRefs.current[index] = el
            // Forward the ref if the child has one
            if (typeof child.ref === 'function') {
              child.ref(el)
            } else if (child.ref) {
              ;(child.ref as React.MutableRefObject<HTMLButtonElement>).current = el
            }
          },
          className: cn(
            {
              'rounded-s-none': isHorizontal && isPill && !isFirst,
              'rounded-e-none': isHorizontal && isPill && !isLast,
              'border-s-0': isHorizontal && isPill && !isFirst,

              'rounded-t-none': !isHorizontal && isPill && !isFirst,
              'rounded-b-none': !isHorizontal && isPill && !isLast,
              'border-t-0': !isHorizontal && isPill && !isFirst,
            },
            child.props.className
          ),
          onClick: (e) => {
            // Call the child's onClick if it exists
            child.props.onClick?.(e)
            // Call our handler
            handleButtonClick(index)
          },
          onFocus: (e) => {
            child.props.onFocus?.(e)
            setFocusIndex(index)
          },
          // For toggle mode, set the data-state attribute for styling
          ...(isToggleMode && { 'data-state': isSelected ? 'on' : 'off' }),
          // Add aria attributes for accessibility
          ...ariaProps,
        })
      })}
    </div>
  )
}
