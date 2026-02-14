// packages/ui/src/components/emoji-picker.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Separator } from '@auxx/ui/components/separator'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronLeft, Search, X } from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyEmojiSkinTone,
  EMOJI_DATA,
  EMOJI_GROUPS,
  type EmojiGroup,
  type EmojiItem,
  SKIN_TONE_COLORS,
  SKIN_TONES,
  type SkinTone,
} from './emojis'

/** localStorage key for skin tone preference */
const SKIN_TONE_STORAGE_KEY = 'emoji-picker-skin-tone'

/** Get saved skin tone from localStorage */
function getSavedSkinTone(): SkinTone {
  if (typeof window === 'undefined') return ''
  const saved = localStorage.getItem(SKIN_TONE_STORAGE_KEY)
  if (saved && SKIN_TONES.includes(saved as SkinTone)) {
    return saved as SkinTone
  }
  return ''
}

/** Save skin tone to localStorage */
function saveSkinTone(tone: SkinTone): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(SKIN_TONE_STORAGE_KEY, tone)
}

/** Hook for scroll-based active section detection */
function useScrollBasedActiveSection(
  containerRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean
) {
  const [activeSection, setActiveSection] = useState<string>('')
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())

  const registerSection = useCallback((element: HTMLElement | null, sectionId: string) => {
    if (!element || !sectionId) {
      sectionRefs.current.delete(sectionId)
      return
    }
    sectionRefs.current.set(sectionId, element)
  }, [])

  const scrollToSection = useCallback(
    (sectionId: string) => {
      const container = containerRef.current
      const element = sectionRefs.current.get(sectionId)

      if (container && element) {
        // Calculate the target scroll position accounting for sticky header
        const headerOffset = 40
        const targetScrollTop = element.offsetTop - headerOffset

        // Set active section immediately for better UX
        setActiveSection(sectionId)

        container.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth',
        })
      }
    },
    [containerRef]
  )
  useEffect(() => {
    if (!isOpen) {
      setActiveSection('')
      return
    }

    // When popover opens, set first section as active and wait for DOM to be ready
    setActiveSection('smileys') // Set first section immediately

    const timeoutId = setTimeout(() => {
      const container = containerRef.current

      if (!container) {
        return
      }

      const handleScroll = () => {
        const scrollTop = container.scrollTop
        const headerOffset = 40 // Account for sticky headers
        let activeId = ''
        let maxTop = -1

        // Find the last section whose top is above scrollTop + headerOffset
        sectionRefs.current.forEach((element, sectionId) => {
          const offsetTop = element.offsetTop
          if (offsetTop <= scrollTop + headerOffset && offsetTop > maxTop) {
            maxTop = offsetTop
            activeId = sectionId
          }
        })

        if (activeId) {
          setActiveSection(activeId)
        }
      }

      // Set initial active section based on scroll position
      handleScroll()

      container.addEventListener('scroll', handleScroll, { passive: true })

      // Return cleanup function
      return () => {
        container.removeEventListener('scroll', handleScroll)
      }
    }, 100) // Small delay to allow DOM to render

    return () => {
      clearTimeout(timeoutId)
    }
  }, [containerRef, isOpen])

  return { activeSection, registerSection, scrollToSection }
}

/** Memoized emoji button component with skin tone support */
const EmojiButton = React.memo<{
  item: EmojiItem
  skinTone: SkinTone
  onSelect: (emoji: string) => void
}>(({ item, skinTone, onSelect }) => {
  // Apply skin tone modifier if the emoji supports it
  const displayEmoji = item.supportsSkinTone ? applyEmojiSkinTone(item.emoji, skinTone) : item.emoji

  return (
    <button
      className='flex size-8 cursor-pointer items-center justify-center rounded-md text-lg hover:bg-primary-100'
      onClick={() => onSelect(displayEmoji)}
      title={item.label}>
      {displayEmoji}
    </button>
  )
})

EmojiButton.displayName = 'EmojiButton'

/** Memoized section component */
const EmojiSection = React.memo<{
  group: EmojiGroup
  emojis: EmojiItem[]
  skinTone: SkinTone
  onEmojiSelect: (emoji: string) => void
  onSectionRef: (element: HTMLElement | null, sectionId: string) => void
}>(({ group, emojis, skinTone, onEmojiSelect, onSectionRef }) => {
  const sectionRef = useCallback(
    (element: HTMLElement | null) => {
      onSectionRef(element, group.id)
    },
    [group.id, onSectionRef]
  )

  return (
    <div ref={sectionRef} data-section={group.id} className='mb-0 px-2 scroll-mt-8 min-h-[260px]'>
      <div className='sticky top-0 z-10  py-2'>
        <h3 className='text-sm font-medium rounded-full bg-background border inline-flex px-1 text-muted-foreground'>
          {group.label}
        </h3>
      </div>
      <div className='grid grid-cols-10 gap-0.5'>
        {emojis.map((item) => (
          <EmojiButton key={item.id} item={item} skinTone={skinTone} onSelect={onEmojiSelect} />
        ))}
      </div>
    </div>
  )
})

EmojiSection.displayName = 'EmojiSection'

/** Tab button component */
const TabButton = React.memo<{
  group: EmojiGroup
  isActive: boolean
  onClick: () => void
}>(({ group, isActive, onClick }) => {
  const Icon = group.icon
  return (
    <Button
      size='icon-sm'
      variant='ghost'
      className={cn(isActive && 'bg-primary-100 text-info hover:text-info')}
      onClick={onClick}
      title={group.label}>
      <Icon />
    </Button>
  )
})

TabButton.displayName = 'TabButton'

/** Skin tone button showing current selection */
const SkinToneButton = React.memo<{
  currentTone: SkinTone
  showingSelector: boolean
  onClick: () => void
}>(({ currentTone, showingSelector, onClick }) => (
  <Button size='icon-sm' variant='ghost' onClick={onClick} title='Skin tone'>
    {showingSelector ? (
      <ChevronLeft className='size-4' />
    ) : (
      <span className={cn('size-4 rounded-full', SKIN_TONE_COLORS[currentTone])} />
    )}
  </Button>
))

SkinToneButton.displayName = 'SkinToneButton'

/** Skin tone selector row */
const SkinToneSelector = React.memo<{
  selected: SkinTone
  onSelect: (tone: SkinTone) => void
}>(({ selected, onSelect }) => (
  <div className='flex gap-0.5'>
    {SKIN_TONES.map((tone) => (
      <Button
        key={tone || 'default'}
        size='icon-sm'
        variant='ghost'
        onClick={() => onSelect(tone)}
        title={tone === '' ? 'Default' : `Skin tone ${SKIN_TONES.indexOf(tone)}`}
        className={cn(selected === tone && 'bg-primary-100')}>
        <span className={cn('size-4 rounded-full', SKIN_TONE_COLORS[tone])} />
      </Button>
    ))}
  </div>
))

SkinToneSelector.displayName = 'SkinToneSelector'

/** Emoji picker props */
export interface EmojiPickerProps {
  /** Current selected emoji */
  value?: string
  /** Called when an emoji is selected */
  onChange: (value: string) => void
  /** Whether the picker is disabled */
  disabled?: boolean
  /** Additional classes */
  className?: string
  /** Popover alignment */
  align?: 'start' | 'end'
  /** Controlled open state */
  open?: boolean
  /** Called when open state changes */
  onOpenChange?: (open: boolean) => void
  /** Custom trigger element */
  children?: React.ReactNode
  /** Set to false when used inside a Dialog to fix scroll issues */
  modal?: boolean
}

/** Emoji picker component */
export function EmojiPicker({
  value,
  onChange,
  disabled = false,
  className,
  align = 'start',
  onOpenChange,
  open,
  children,
  modal = true,
}: EmojiPickerProps) {
  // Use internal state if open is not provided (uncontrolled mode)
  const [internalOpen, setInternalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [skinTone, setSkinTone] = useState<SkinTone>(getSavedSkinTone)
  const [showSkinTones, setShowSkinTones] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Determine if component is in controlled or uncontrolled mode
  const isControlled = open !== undefined && onOpenChange !== undefined
  const isOpen = isControlled ? open : internalOpen

  const { activeSection, registerSection, scrollToSection } = useScrollBasedActiveSection(
    scrollContainerRef,
    isOpen
  )

  // Handle open state changes based on mode
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (isControlled && onOpenChange) {
        onOpenChange(newOpen)
      } else {
        setInternalOpen(newOpen)
      }
      // Reset skin tone selector when closing
      if (!newOpen) {
        setShowSkinTones(false)
      }
    },
    [isControlled, onOpenChange]
  )

  // Handle skin tone selection
  const handleSkinToneSelect = useCallback((tone: SkinTone) => {
    setSkinTone(tone)
    saveSkinTone(tone)
    setShowSkinTones(false)
  }, [])

  // Filter emojis based on search query
  const filteredEmojis = useMemo(() => {
    if (!searchQuery.trim()) {
      return null
    }

    const query = searchQuery.toLowerCase()
    const allEmojis: EmojiItem[] = []

    // Add all other emojis
    Object.values(EMOJI_DATA).forEach((categoryEmojis) => {
      allEmojis.push(...categoryEmojis)
    })

    return allEmojis.filter((item) => {
      return (
        item.label.toLowerCase().includes(query) ||
        item.emoji.includes(query) ||
        item.id.toLowerCase().includes(query)
      )
    })
  }, [searchQuery])

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      onChange(emoji)
      handleOpenChange(false)
      setSearchQuery('') // Clear search when closing
    },
    [onChange, handleOpenChange]
  )

  const handleTabClick = useCallback(
    (groupId: string) => {
      setSearchQuery('') // Clear search when navigating via tabs
      scrollToSection(groupId)
    },
    [scrollToSection]
  )

  // Default trigger if none provided
  const defaultTrigger = (
    <Button
      variant='outline'
      size='icon'
      className={cn('h-10 w-10 text-lg', className)}
      disabled={disabled}>
      {value || '= '}
    </Button>
  )

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange} modal={modal}>
      <PopoverTrigger asChild>{children || defaultTrigger}</PopoverTrigger>
      <PopoverContent className='w-80 p-0' align={align}>
        {/* Search input */}
        <div className='flex items-center border-b px-3 py-0.5'>
          <Search className='mr-2 size-4 shrink-0 opacity-50' />
          <Input
            placeholder='Search emojis...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='h-7 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0'
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className='flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary-100 hover:bg-bad-100 hover:text-bad-500'>
              <X className='size-3' />
            </button>
          )}
        </div>

        {/* Tab navigation with skin tone picker */}
        <div className='border-b p-1'>
          <div className='flex gap-0.5 items-center'>
            <SkinToneButton
              currentTone={skinTone}
              showingSelector={showSkinTones}
              onClick={() => setShowSkinTones(!showSkinTones)}
            />
            <Separator orientation='vertical' className='h-5 mx-1' />

            {showSkinTones ? (
              <SkinToneSelector selected={skinTone} onSelect={handleSkinToneSelect} />
            ) : (
              <div className='flex gap-0.5 overflow-x-auto'>
                {EMOJI_GROUPS.map((group) => (
                  <TabButton
                    key={group.id}
                    group={group}
                    isActive={activeSection === group.id}
                    onClick={() => handleTabClick(group.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Emoji content */}
        <div
          className='h-64 overflow-y-auto'
          ref={scrollContainerRef}
          onWheel={(e) => e.stopPropagation()}>
          {/* Show search results if search is active */}
          {searchQuery.trim() ? (
            <div className='px-2'>
              {filteredEmojis?.length ? (
                <>
                  <div className='sticky top-0 z-10 bg-background py-2'>
                    <h3 className='text-sm font-medium text-muted-foreground'>Search results</h3>
                  </div>
                  <div className='grid grid-cols-10 gap-0.5'>
                    {filteredEmojis.map((item) => (
                      <EmojiButton
                        key={item.id}
                        item={item}
                        skinTone={skinTone}
                        onSelect={handleEmojiSelect}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className='flex h-full items-center justify-center text-muted-foreground'>
                  No emojis found
                </div>
              )}
            </div>
          ) : (
            /* Show category sections */
            <div>
              {/* Category sections */}
              {EMOJI_GROUPS.map((group) => (
                <EmojiSection
                  key={group.id}
                  group={group}
                  emojis={EMOJI_DATA[group.id] || []}
                  skinTone={skinTone}
                  onEmojiSelect={handleEmojiSelect}
                  onSectionRef={registerSection}
                />
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Form-connected version for use with react-hook-form */
export const FormEmojiPicker: React.FC<
  Omit<EmojiPickerProps, 'value' | 'onChange'> & {
    value?: string
    onChange?: (value: string) => void
    onBlur?: () => void
  }
> = ({ value = '= ', onChange, onBlur, ...props }) => {
  const handleChange = useCallback(
    (emoji: string) => {
      onChange?.(emoji)
    },
    [onChange]
  )

  return <EmojiPicker value={value} onChange={handleChange} {...props} />
}
