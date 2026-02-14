'use client'
import { cn } from '@auxx/ui/lib/utils'
import * as React from 'react'
import { useCallback, useMemo } from 'react'

interface UseAutosizeTextAreaProps {
  textAreaRef: React.RefObject<HTMLTextAreaElement | null>
  minHeight?: number
  maxHeight?: number
  triggerAutoSize: string
}

export const useAutosizeTextArea = ({
  textAreaRef,
  triggerAutoSize,
  maxHeight = Number.MAX_SAFE_INTEGER,
  minHeight = 0,
}: UseAutosizeTextAreaProps) => {
  const [init, setInit] = React.useState(true)
  // Track initial scrollHeight to prevent shrinking below placeholder-visible size
  const initialScrollHeightRef = React.useRef<number | null>(null)

  // Memoize offset to avoid recreating on each render
  const offsetBorder = useMemo(() => 6, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: triggerAutoSize is used as a trigger to recalculate height; textAreaRef.current is accessed via ref
  React.useEffect(() => {
    // We need to reset the height momentarily to get the correct scrollHeight for the textarea
    const textAreaElement = textAreaRef.current
    if (textAreaElement) {
      if (init) {
        textAreaElement.style.minHeight = `${minHeight + offsetBorder}px`
        if (maxHeight > minHeight) {
          textAreaElement.style.maxHeight = `${maxHeight}px`
        }
        setInit(false)
      }
      textAreaElement.style.height = `${minHeight + offsetBorder}px`
      const scrollHeight = textAreaElement.scrollHeight

      // Capture initial scrollHeight on first calculation (placeholder-visible state)
      if (initialScrollHeightRef.current === null) {
        initialScrollHeightRef.current = scrollHeight
      }

      // We then set the height directly, outside of the render loop
      // Trying to set this with state or a ref will product an incorrect value.
      // Use the larger of: current scrollHeight, initial scrollHeight, or minHeight
      const effectiveMinHeight = Math.max(
        minHeight + offsetBorder,
        initialScrollHeightRef.current + offsetBorder
      )
      const calculatedHeight = Math.max(scrollHeight + offsetBorder, effectiveMinHeight)
      textAreaElement.style.height = `${Math.min(calculatedHeight, maxHeight)}px`
    }
  }, [triggerAutoSize, maxHeight, minHeight, offsetBorder, init])
}

export type AutosizeTextAreaRef = {
  textArea: HTMLTextAreaElement
  maxHeight: number
  minHeight: number
}

type AutosizeTextAreaProps = {
  maxHeight?: number
  minHeight?: number
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>

export const AutosizeTextarea = ({
  maxHeight = Number.MAX_SAFE_INTEGER,
  minHeight = 52,
  className,
  onChange,
  value,
  ...props
}: AutosizeTextAreaProps) => {
  const textAreaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [triggerAutoSize, setTriggerAutoSize] = React.useState('')

  useAutosizeTextArea({ textAreaRef, triggerAutoSize: triggerAutoSize, maxHeight, minHeight })

  React.useEffect(() => {
    if (value !== undefined) {
      setTriggerAutoSize(value as string)
    }
  }, [value])

  const textareaClassName = useMemo(
    () =>
      cn(
        'flex w-full rounded-md border border-primary-200 focus-visible:ring-1 focus-visible:ring-blue-500 focus:border-primary-300 bg-primary-50 dark:bg-primary-100 focus:ring-primary-400 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
        className
      ),
    [className]
  )

  return (
    <textarea
      {...props}
      value={value}
      ref={textAreaRef}
      className={textareaClassName}
      onChange={useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
          setTriggerAutoSize(e.target.value)
          onChange?.(e)
        },
        [onChange]
      )}
    />
  )
}
