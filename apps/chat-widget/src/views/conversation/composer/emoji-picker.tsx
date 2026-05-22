// apps/chat-widget/src/views/conversation/composer/emoji-picker.tsx
//
// Preact port of `packages/ui/src/components/emoji-picker.tsx`. Built on the
// widget's local Popover/Button/Icon wrappers so it can portal inside the
// shadow root. Drops color swatches + FormEmojiPicker, keeps search, category
// tabs with scroll-spy, sticky section headers, skin tone selector.
//
// Imports the emoji DATA from `@auxx/ui/components/emojis` directly. The file
// re-exports a 1.7k-line dataset + lucide icons, so this picker should sit in
// its own Vite chunk (lazy-loaded by emoji-button.tsx) — verify via build
// output and split `emojis.ts` into data+groups if tree-shaking falls short.

import {
  applyEmojiSkinTone,
  EMOJI_DATA,
  EMOJI_GROUPS,
  type EmojiGroup,
  type EmojiItem,
  SKIN_TONE_COLORS,
  SKIN_TONES,
  type SkinTone,
} from '@auxx/ui/components/emojis'
import { ChevronLeft, Search, X } from 'lucide-react'
import { memo } from 'preact/compat'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { cn } from '~/lib/cn'

const SKIN_TONE_STORAGE_KEY = 'auxx-chat-emoji-skin-tone'

function getSavedSkinTone(): SkinTone {
  if (typeof window === 'undefined') return ''
  try {
    const saved = window.localStorage.getItem(SKIN_TONE_STORAGE_KEY)
    if (saved && (SKIN_TONES as readonly string[]).includes(saved)) {
      return saved as SkinTone
    }
  } catch {
    /* ignore */
  }
  return ''
}

function saveSkinTone(tone: SkinTone): void {
  try {
    window.localStorage.setItem(SKIN_TONE_STORAGE_KEY, tone)
  } catch {
    /* ignore */
  }
}

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  /** Triggered by the picker when an action implies it should close. */
  onClose: () => void
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [skinTone, setSkinTone] = useState<SkinTone>(getSavedSkinTone)
  const [showSkinTones, setShowSkinTones] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const { activeSection, registerSection, scrollToSection } = useScrollSpy(scrollRef)

  const handleSkinToneSelect = useCallback((tone: SkinTone) => {
    setSkinTone(tone)
    saveSkinTone(tone)
    setShowSkinTones(false)
  }, [])

  const handleSelect = useCallback(
    (emoji: string) => {
      onSelect(emoji)
      setSearchQuery('')
      onClose()
    },
    [onSelect, onClose]
  )

  const handleTabClick = useCallback(
    (groupId: string) => {
      setSearchQuery('')
      scrollToSection(groupId)
    },
    [scrollToSection]
  )

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.toLowerCase()
    const all: EmojiItem[] = []
    Object.values(EMOJI_DATA).forEach((items) => all.push(...items))
    return all.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.emoji.includes(q) ||
        item.id.toLowerCase().includes(q)
    )
  }, [searchQuery])

  return (
    <div className='w-80'>
      <div className='flex items-center border-b border-[color:var(--color-border)] px-3 py-0.5'>
        <Search className='mr-2 size-4 shrink-0 opacity-50' aria-hidden='true' />
        <input
          type='text'
          placeholder='Search emojis…'
          value={searchQuery}
          onInput={(e) => setSearchQuery((e.currentTarget as HTMLInputElement).value)}
          className='h-7 w-full border-0 bg-transparent p-0 text-sm outline-none'
        />
        {searchQuery ? (
          <button
            type='button'
            onClick={() => setSearchQuery('')}
            className='flex size-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-surface)] hover:bg-[color:var(--color-border)]'>
            <X className='size-3' aria-hidden='true' />
          </button>
        ) : null}
      </div>

      <div className='flex items-center gap-0.5 border-b border-[color:var(--color-border)] p-1'>
        <SkinToneButton
          currentTone={skinTone}
          showingSelector={showSkinTones}
          onClick={() => setShowSkinTones((v) => !v)}
        />
        <div className='mx-1 h-5 w-px bg-[color:var(--color-border)]' />
        {showSkinTones ? (
          <div className='flex gap-0.5'>
            {SKIN_TONES.map((tone) => (
              <button
                key={tone || 'default'}
                type='button'
                title={tone === '' ? 'Default' : `Skin tone ${SKIN_TONES.indexOf(tone)}`}
                onClick={() => handleSkinToneSelect(tone)}
                className={cn(
                  'flex size-7 items-center justify-center rounded hover:bg-[color:var(--color-surface)]',
                  skinTone === tone && 'bg-[color:var(--color-surface)]'
                )}>
                <span className={cn('size-4 rounded-full', SKIN_TONE_COLORS[tone])} />
              </button>
            ))}
          </div>
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

      <div ref={scrollRef} className='h-64 overflow-y-auto' onWheel={(e) => e.stopPropagation()}>
        {filtered ? (
          <div className='px-2'>
            {filtered.length > 0 ? (
              <>
                <div className='sticky top-0 z-10 bg-[color:var(--color-bg)] py-2'>
                  <h3 className='text-sm font-medium text-[color:var(--color-muted)]'>
                    Search results
                  </h3>
                </div>
                <div className='grid grid-cols-10 gap-0.5'>
                  {filtered.map((item) => (
                    <Cell key={item.id} item={item} skinTone={skinTone} onSelect={handleSelect} />
                  ))}
                </div>
              </>
            ) : (
              <div className='flex h-32 items-center justify-center text-sm text-[color:var(--color-muted)]'>
                No emojis found
              </div>
            )}
          </div>
        ) : (
          EMOJI_GROUPS.map((group) => (
            <Section
              key={group.id}
              group={group}
              items={EMOJI_DATA[group.id] || []}
              skinTone={skinTone}
              onSelect={handleSelect}
              registerSection={registerSection}
            />
          ))
        )}
      </div>
    </div>
  )
}

const Cell = memo(function Cell({
  item,
  skinTone,
  onSelect,
}: {
  item: EmojiItem
  skinTone: SkinTone
  onSelect: (emoji: string) => void
}) {
  const display = item.supportsSkinTone ? applyEmojiSkinTone(item.emoji, skinTone) : item.emoji
  return (
    <button
      type='button'
      onClick={() => onSelect(display)}
      title={item.label}
      className='flex size-8 cursor-pointer items-center justify-center rounded-md text-lg hover:bg-[color:var(--color-surface)]'>
      {display}
    </button>
  )
})

const Section = memo(function Section({
  group,
  items,
  skinTone,
  onSelect,
  registerSection,
}: {
  group: EmojiGroup
  items: EmojiItem[]
  skinTone: SkinTone
  onSelect: (emoji: string) => void
  registerSection: (element: HTMLElement | null, sectionId: string) => void
}) {
  const sectionRef = useCallback(
    (el: HTMLElement | null) => registerSection(el, group.id),
    [group.id, registerSection]
  )
  return (
    <div ref={sectionRef} data-section={group.id} className='mb-0 min-h-[260px] px-2 scroll-mt-8'>
      <div className='sticky top-0 z-10 py-2'>
        <h3 className='inline-flex rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 text-sm font-medium text-[color:var(--color-muted)]'>
          {group.label}
        </h3>
      </div>
      <div className='grid grid-cols-10 gap-0.5'>
        {items.map((item) => (
          <Cell key={item.id} item={item} skinTone={skinTone} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
})

const TabButton = memo(function TabButton({
  group,
  isActive,
  onClick,
}: {
  group: EmojiGroup
  isActive: boolean
  onClick: () => void
}) {
  const Icon = group.icon
  return (
    <button
      type='button'
      title={group.label}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded text-[color:var(--color-muted)] hover:bg-[color:var(--color-surface)] hover:text-[color:var(--color-fg)]',
        isActive && 'bg-[color:var(--color-surface)] text-[color:var(--color-primary)]'
      )}>
      <Icon className='size-4' />
    </button>
  )
})

const SkinToneButton = memo(function SkinToneButton({
  currentTone,
  showingSelector,
  onClick,
}: {
  currentTone: SkinTone
  showingSelector: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      title='Skin tone'
      onClick={onClick}
      className='flex size-7 items-center justify-center rounded hover:bg-[color:var(--color-surface)]'>
      {showingSelector ? (
        <ChevronLeft className='size-4' />
      ) : (
        <span className={cn('size-4 rounded-full', SKIN_TONE_COLORS[currentTone])} />
      )}
    </button>
  )
})

function useScrollSpy(containerRef: { current: HTMLElement | null }) {
  const [activeSection, setActiveSection] = useState<string>('smileys')
  const sectionsRef = useRef<Map<string, HTMLElement>>(new Map())

  const registerSection = useCallback((element: HTMLElement | null, sectionId: string) => {
    if (!element) {
      sectionsRef.current.delete(sectionId)
      return
    }
    sectionsRef.current.set(sectionId, element)
  }, [])

  const scrollToSection = useCallback(
    (sectionId: string) => {
      const container = containerRef.current
      const element = sectionsRef.current.get(sectionId)
      if (!container || !element) return
      setActiveSection(sectionId)
      container.scrollTo({ top: element.offsetTop - 40, behavior: 'smooth' })
    },
    [containerRef]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = () => {
      const scrollTop = container.scrollTop
      let activeId = ''
      let maxTop = -1
      sectionsRef.current.forEach((element, sectionId) => {
        const offsetTop = element.offsetTop
        if (offsetTop <= scrollTop + 40 && offsetTop > maxTop) {
          maxTop = offsetTop
          activeId = sectionId
        }
      })
      if (activeId) setActiveSection(activeId)
    }
    container.addEventListener('scroll', handler, { passive: true })
    return () => container.removeEventListener('scroll', handler)
  }, [containerRef])

  return { activeSection, registerSection, scrollToSection }
}
