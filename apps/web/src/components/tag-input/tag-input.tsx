// apps/web/src/components/tag-input/tag-input.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils/generateId'
import type { VariantProps } from 'class-variance-authority'
import React, { useCallback, useMemo } from 'react'
import { Tag, type tagVariants } from './tag'

export enum Delimiter {
  Comma = ',',
  Enter = 'Enter',
  Space = ' ',
  Tab = 'Tab',
}

type OmittedInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'value'>

export type Tag = { id: string; text: string }

// Interface for granular CSS class customization
export interface TagInputStyleClassesProps {
  container?: string
  inlineTagsContainer?: string
  tag?: { body?: string; closeButton?: string }
  input?: string
  clearAllButton?: string
}

export interface TagInputProps extends OmittedInputProps, VariantProps<typeof tagVariants> {
  placeholder?: string
  tags: Tag[]
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>
  maxTags?: number
  minTags?: number
  readOnly?: boolean
  disabled?: boolean
  onTagAdd?: (tagText: string, tagId: string) => void
  onTagRemove?: (tagText: string, tagId: string) => void
  allowDuplicates?: boolean
  validateTag?: (tagText: string) => boolean
  delimiterList?: (Delimiter | string)[]
  showCount?: boolean
  placeholderWhenFull?: string
  sortTags?: boolean
  truncate?: number
  minLength?: number
  maxLength?: number
  value?: string | number | readonly string[] | Tag[]
  onInputChange?: (value: string) => void
  customTagRenderer?: (tag: Tag, isActiveTag: boolean) => React.ReactNode
  onFocus?: React.FocusEventHandler<HTMLInputElement>
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  onTagClick?: (tag: Tag) => void
  clearAll?: boolean
  onClearAll?: () => void
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>
  activeTagIndex: number | null
  setActiveTagIndex: React.Dispatch<React.SetStateAction<number | null>>
  styleClasses?: TagInputStyleClassesProps
  addOnPaste?: boolean
  addTagsOnBlur?: boolean
  generateTagId?: () => string
}

function TagInput(props: TagInputProps) {
  const {
    id,
    placeholder,
    tags,
    setTags,
    variant,
    size,
    className,
    maxTags,
    onTagAdd,
    onTagRemove,
    allowDuplicates = false,
    showCount,
    validateTag,
    placeholderWhenFull = 'Max tags reached',
    sortTags,
    delimiterList = [Delimiter.Comma, Delimiter.Enter],
    truncate,
    minLength,
    maxLength,
    onInputChange,
    customTagRenderer,
    onFocus,
    onBlur,
    onTagClick,
    clearAll = false,
    onClearAll,
    inputProps = {},
    addTagsOnBlur = false,
    activeTagIndex,
    setActiveTagIndex,
    styleClasses = {},
    disabled = false,
    readOnly = false,
    addOnPaste = false,
    generateTagId = generateId,
    ...restInputProps
  } = props

  const [inputValue, setInputValue] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Effect to handle controlled value prop for tags
  React.useEffect(() => {
    if (props.value !== undefined && Array.isArray(props.value)) {
      if (
        props.value.length > 0 &&
        typeof props.value[0] === 'object' &&
        'id' in props.value[0] &&
        'text' in props.value[0]
      ) {
        setTags(props.value as Tag[])
      } else if (props.value.every((item) => typeof item === 'string')) {
        setTags(props.value.map((text) => ({ id: generateTagId(), text: text as string })))
      }
    }
  }, [props.value, setTags, generateTagId])

  // Check if input should be disabled
  const isInputDisabled = useMemo(
    () => disabled || readOnly || (maxTags !== undefined && tags.length >= maxTags),
    [disabled, readOnly, maxTags, tags.length]
  )

  const addTag = useCallback(
    (tagToAdd: Tag): boolean => {
      if (maxTags !== undefined && tags.length >= maxTags) {
        setInputValue('')
        return false
      }

      if (validateTag && !validateTag(tagToAdd.text)) {
        return false
      }

      if (minLength && tagToAdd.text.length < minLength) {
        return false
      }
      if (maxLength && tagToAdd.text.length > maxLength) {
        return false
      }

      const lowerCaseTagText = tagToAdd.text.toLowerCase()
      if (!allowDuplicates && tags.some((tag) => tag.text.toLowerCase() === lowerCaseTagText)) {
        return false
      }

      setTags((prevTags) => [...prevTags, tagToAdd])
      onTagAdd?.(tagToAdd.text, tagToAdd.id)
      setInputValue('')
      setActiveTagIndex(null)
      return true
    },
    [
      maxTags,
      tags,
      validateTag,
      minLength,
      maxLength,
      allowDuplicates,
      setTags,
      onTagAdd,
      setActiveTagIndex,
    ]
  )

  const handleRemoveTag = useCallback(
    (idToRemove: string) => {
      const tagToRemove = tags.find((tag) => tag.id === idToRemove)
      if (tagToRemove && !readOnly && !disabled) {
        setTags((prevTags) => prevTags.filter((tag) => tag.id !== idToRemove))
        onTagRemove?.(tagToRemove.text, tagToRemove.id)
        setActiveTagIndex(null)
        inputRef.current?.focus()
      }
    },
    [tags, readOnly, disabled, setTags, onTagRemove, setActiveTagIndex]
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (addOnPaste && !isInputDisabled) {
        e.preventDefault()
        const pastedText = e.clipboardData.getData('text')
        const effectiveDelimiter = delimiterList[0] || Delimiter.Comma
        const newTagsText = pastedText
          .split(effectiveDelimiter)
          .map((text) => text.trim())
          .filter((text) => text.length > 0)

        let tagsAdded = 0
        newTagsText.forEach((text) => {
          if (maxTags === undefined || tags.length + tagsAdded < maxTags) {
            const newTag = { id: generateTagId(), text: text }
            if (addTag(newTag)) {
              tagsAdded++
            }
          }
        })
      }
      inputProps?.onPaste?.(e)
    },
    [
      addOnPaste,
      isInputDisabled,
      delimiterList,
      tags.length,
      maxTags,
      addTag,
      generateTagId,
      inputProps,
    ]
  )

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setInputValue(newValue)
    onInputChange?.(newValue)
    setActiveTagIndex(null)
  }

  const handleInputFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    setActiveTagIndex(null)
    onFocus?.(event)
  }

  const handleInputBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (addTagsOnBlur && inputValue.trim() && !isInputDisabled) {
      const newTag = { id: generateTagId(), text: inputValue.trim() }
      addTag(newTag)
    }
    onBlur?.(event)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    inputProps?.onKeyDown?.(e)
    if (e.isDefaultPrevented()) {
      return
    }

    if (readOnly) return

    const currentInputValue = inputValue.trim()

    if (delimiterList.includes(e.key) && currentInputValue) {
      e.preventDefault()
      const newTag = { id: generateTagId(), text: currentInputValue }
      addTag(newTag)
    } else {
      switch (e.key) {
        case 'Backspace':
          if (inputValue === '' && tags.length > 0 && !isInputDisabled) {
            e.preventDefault()
            if (activeTagIndex !== null) {
              const tagToRemove = tags[activeTagIndex]
              if (tagToRemove) {
                handleRemoveTag(tagToRemove.id)
                setActiveTagIndex((prevIndex) => {
                  if (prevIndex === null) return null
                  if (tags.length === 1) return null
                  if (prevIndex === 0) return null
                  return Math.min(prevIndex - 1, tags.length - 2)
                })
              }
            } else {
              setActiveTagIndex(tags.length - 1)
            }
          }
          break

        case 'Delete':
          if (activeTagIndex !== null && !isInputDisabled) {
            e.preventDefault()
            const tagToRemove = tags[activeTagIndex]
            if (tagToRemove) {
              handleRemoveTag(tagToRemove.id)
              setActiveTagIndex(null)
              inputRef.current?.focus()
            }
          }
          break

        case 'ArrowLeft':
          if (inputValue === '' && tags.length > 0 && !e.shiftKey) {
            e.preventDefault()
            if (activeTagIndex === null) {
              setActiveTagIndex(tags.length - 1)
            } else {
              setActiveTagIndex((prevIndex) =>
                prevIndex === null ? tags.length - 1 : (prevIndex - 1 + tags.length) % tags.length
              )
            }
          }
          break

        case 'ArrowRight':
          if (inputValue === '' && tags.length > 0 && !e.shiftKey) {
            e.preventDefault()
            if (activeTagIndex === null) {
              setActiveTagIndex(0)
            } else {
              setActiveTagIndex((prevIndex) =>
                prevIndex === null ? 0 : (prevIndex + 1) % tags.length
              )
            }
          }
          break

        case 'Home':
          if (inputValue === '' && tags.length > 0 && !e.shiftKey) {
            e.preventDefault()
            setActiveTagIndex(0)
          }
          break

        case 'End':
          if (inputValue === '' && tags.length > 0 && !e.shiftKey) {
            e.preventDefault()
            setActiveTagIndex(tags.length - 1)
          }
          break

        case 'Escape':
          if (activeTagIndex !== null) {
            setActiveTagIndex(null)
          } else {
            setInputValue('')
          }
          break
      }
    }
  }

  const handleClearAll = () => {
    if (readOnly || disabled) return
    setActiveTagIndex(null)
    if (onClearAll) {
      onClearAll()
    } else {
      setTags([])
    }
  }

  const displayedTags = useMemo(() => {
    const tagsToDisplay = sortTags ? [...tags].sort((a, b) => a.text.localeCompare(b.text)) : tags
    return truncate
      ? tagsToDisplay.map((tag) => ({
          ...tag,
          text: tag.text?.length > truncate ? `${tag.text.substring(0, truncate)}...` : tag.text,
        }))
      : tagsToDisplay
  }, [tags, sortTags, truncate])

  return (
    <div className={cn('w-full', className, styleClasses?.container)}>
      <div
        className={cn(
          'flex flex-row flex-wrap items-center gap-1 py-1 px-1',
          'w-full rounded-xl border border-input text-sm',
          disabled ? 'cursor-not-allowed bg-muted opacity-50' : 'bg-transparent',
          styleClasses?.inlineTagsContainer
        )}
        onClick={() => !isInputDisabled && inputRef.current?.focus()}>
        {/* Render tags */}
        {displayedTags.map((tagObj, index) =>
          customTagRenderer ? (
            customTagRenderer(tagObj, index === activeTagIndex)
          ) : (
            <Tag
              key={tagObj.id}
              tagObj={tagObj}
              isActiveTag={index === activeTagIndex}
              variant={variant}
              size={size}
              onTagClick={onTagClick}
              onRemoveTag={handleRemoveTag}
              tagClasses={styleClasses?.tag}
              disabled={disabled}
            />
          )
        )}

        {/* Input field */}
        <Input
          ref={inputRef}
          id={id}
          type='text'
          placeholder={isInputDisabled ? placeholderWhenFull : placeholder}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onPaste={handlePaste}
          {...inputProps}
          {...restInputProps}
          className={cn(
            'tag-input-input',
            'w-full h-full px-1 flex-1 border-0 bg-transparent! shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
            styleClasses?.input
          )}
          autoComplete='off'
          disabled={isInputDisabled}
          readOnly={readOnly}
        />
      </div>

      {/* Optional Count Display */}
      {showCount && maxTags && (
        <div className='ml-auto mt-1 text-right'>
          <span className='text-sm text-muted-foreground'>
            {`${tags.length}`}/{`${maxTags}`}
          </span>
        </div>
      )}

      {/* Optional Clear All Button */}
      {clearAll && tags.length > 0 && !readOnly && (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={handleClearAll}
          disabled={disabled}
          className={cn('mt-2 text-sm', styleClasses?.clearAllButton)}>
          Clear All
        </Button>
      )}
    </div>
  )
}

export { TagInput }
