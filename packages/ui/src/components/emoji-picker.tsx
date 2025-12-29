// components/ui/emoji-picker.tsx
import React, { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { Input } from '@auxx/ui/components/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Search } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'

// Emoji categories remain the same - I'm not including them here for brevity

// Commonly used emojis, grouped by category
const emojiCategories = {
  people: [
    '😀',
    '😃',
    '😄',
    '😁',
    '😆',
    '😅',
    '😂',
    '🤣',
    '😊',
    '😇',
    '🙂',
    '🙃',
    '😉',
    '😌',
    '😍',
    '🥰',
    '😘',
    '😗',
    '😙',
    '😚',
    '👋',
    '🤚',
    '🖐',
    '✋',
    '🖖',
    '👌',
    '🤌',
    '🤏',
    '✌️',
    '🤞',
    '👨',
    '👩',
    '👶',
    '👦',
    '👧',
    '🧒',
    '👴',
    '👵',
    '🧓',
    '👨‍🦰',
  ],
  nature: [
    '🐶',
    '🐱',
    '🐭',
    '🐹',
    '🐰',
    '🦊',
    '🐻',
    '🐼',
    '🐨',
    '🐯',
    '🦁',
    '🐮',
    '🐷',
    '🐸',
    '🐵',
    '🐔',
    '🐧',
    '🐦',
    '🐤',
    '🐣',
    '🌱',
    '🌲',
    '🌳',
    '🌴',
    '🌵',
    '🌷',
    '🌸',
    '🌹',
    '🌺',
    '🌻',
    '🌼',
    '🌽',
    '🌾',
    '🌿',
    '☘️',
    '🍀',
    '🍁',
    '🍂',
    '🍃',
    '🌍',
  ],
  objects: [
    '⌚',
    '📱',
    '💻',
    '⌨️',
    '🖥️',
    '🖨️',
    '💾',
    '💿',
    '📀',
    '📷',
    '📸',
    '📹',
    '🎥',
    '📺',
    '📻',
    '🎙️',
    '🎚️',
    '🎛️',
    '📢',
    '📣',
    '📌',
    '📍',
    '📎',
    '🔍',
    '🔎',
    '🔒',
    '🔓',
    '🔏',
    '🔐',
    '🔑',
    '🔨',
    '🪓',
    '⛏️',
    '🔧',
    '🔩',
    '⚙️',
    '🧱',
    '⛓️',
    '🪜',
    '📦',
  ],
  symbols: [
    '❤️',
    '🧡',
    '💛',
    '💚',
    '💙',
    '💜',
    '🖤',
    '🤍',
    '🤎',
    '💔',
    '❣️',
    '💕',
    '💞',
    '💓',
    '💗',
    '💖',
    '💘',
    '💝',
    '💟',
    '☮️',
    '✝️',
    '☪️',
    '🕉️',
    '☸️',
    '✡️',
    '🔯',
    '🕎',
    '☯️',
    '☦️',
    '🛐',
    '⚛️',
    '🆔',
    '®️',
    '™️',
    '〽️',
    '⚠️',
    '🚸',
    '🔰',
    '♻️',
    '✅',
  ],
  flags: [
    '🏁',
    '🚩',
    '🎌',
    '🏴',
    '🏳️',
    '🏳️‍🌈',
    '🏳️‍⚧️',
    '🏴‍☠️',
    '🇦🇨',
    '🇦🇩',
    '🇦🇪',
    '🇦🇫',
    '🇦🇬',
    '🇦🇮',
    '🇦🇱',
    '🇦🇲',
    '🇦🇴',
    '🇦🇶',
    '🇦🇷',
    '🇦🇸',
  ],
  organization: [
    '👥',
    '👤',
    '🗣️',
    '👪',
    '🏢',
    '🏭',
    '🏬',
    '🏣',
    '🏦',
    '🏨',
    '📈',
    '📉',
    '📊',
    '📋',
    '📁',
    '📂',
    '🗂️',
    '📝',
    '📄',
    '📑',
    '🧾',
    '📊',
    '📋',
    '📌',
    '📍',
    '📎',
    '🖇️',
    '📏',
    '📐',
    '✂️',
    '🔒',
    '🔓',
    '🔏',
    '🔐',
    '🔑',
    '🗝️',
    '🔨',
    '🪓',
    '⛏️',
    '🔧',
  ],
}

// Frequently used emojis in an organizational context
const popularEmojis = [
  '👥',
  '👤',
  '🏢',
  '📊',
  '📋',
  '📁',
  '📈',
  '🔑',
  '🏆',
  '✅',
  '💼',
  '🔄',
  '🚀',
  '⚙️',
  '📝',
  '💡',
  '🔍',
  '📢',
  '🔔',
  '🎯',
]

interface EmojiPickerProps {
  value?: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  align?: 'start' | 'end'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

export function EmojiPicker({
  value,
  onChange,
  disabled = false,
  className,
  align = 'start',
  onOpenChange,
  open,
  children,
}: EmojiPickerProps) {
  // Use internal state if open is not provided (uncontrolled mode)
  const [internalOpen, setInternalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('popular')
  const [searchQuery, setSearchQuery] = useState('')

  // Determine if component is in controlled or uncontrolled mode
  const isControlled = open !== undefined && onOpenChange !== undefined
  const isOpen = isControlled ? open : internalOpen

  // Handle open state changes based on mode
  const handleOpenChange = (newOpen: boolean) => {
    if (isControlled && onOpenChange) {
      onOpenChange(newOpen)
    } else {
      setInternalOpen(newOpen)
    }
  }

  // Filter emojis based on search query
  const getFilteredEmojis = () => {
    if (!searchQuery.trim()) {
      return null
    }

    const query = searchQuery.toLowerCase()
    const allEmojis = Object.values(emojiCategories).flat()

    return allEmojis.filter((emoji) => {
      return emoji.includes(query)
    })
  }

  const filteredEmojis = getFilteredEmojis()

  const handleEmojiSelect = (emoji: string) => {
    onChange(emoji)
    handleOpenChange(false)
  }

  // Default trigger if none provided
  const defaultTrigger = (
    <Button
      variant="outline"
      size="icon"
      className={cn('h-10 w-10 text-lg', className)}
      disabled={disabled}>
      {value}
    </Button>
  )

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children || defaultTrigger}</PopoverTrigger>
      <PopoverContent className="w-72 p-0" align={align}>
        {/* Rest of the component remains the same */}
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search emojis..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-4 p-1">
            <TabsTrigger value="popular" className="h-auto py-1 text-xs">
              Popular
            </TabsTrigger>
            <TabsTrigger value="people" className="h-auto py-1 text-xs">
              People
            </TabsTrigger>
            <TabsTrigger value="nature" className="h-auto py-1 text-xs">
              Nature
            </TabsTrigger>
            <TabsTrigger value="org" className="h-auto py-1 text-xs">
              Org
            </TabsTrigger>
          </TabsList>

          {/* Show search results if search is active */}
          {searchQuery.trim() && (
            <div className="h-52 overflow-y-auto p-2">
              {filteredEmojis?.length ? (
                <div className="grid grid-cols-8 gap-2">
                  {filteredEmojis.map((emoji, index) => (
                    <button
                      key={`search-${index}`}
                      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-lg hover:bg-muted"
                      onClick={() => handleEmojiSelect(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  No emojis found
                </div>
              )}
            </div>
          )}

          {/* Show category tabs if no search */}
          {!searchQuery.trim() && (
            <>
              <TabsContent value="popular" className="h-52 overflow-y-auto p-2">
                <div className="grid grid-cols-8 gap-2">
                  {popularEmojis.map((emoji, index) => (
                    <button
                      key={`popular-${index}`}
                      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-lg hover:bg-muted"
                      onClick={() => handleEmojiSelect(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="people" className="h-52 overflow-y-auto p-2">
                <div className="grid grid-cols-8 gap-2">
                  {emojiCategories.people.map((emoji, index) => (
                    <button
                      key={`people-${index}`}
                      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-lg hover:bg-muted"
                      onClick={() => handleEmojiSelect(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="nature" className="h-52 overflow-y-auto p-2">
                <div className="grid grid-cols-8 gap-2">
                  {emojiCategories.nature.map((emoji, index) => (
                    <button
                      key={`nature-${index}`}
                      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-lg hover:bg-muted"
                      onClick={() => handleEmojiSelect(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="org" className="h-52 overflow-y-auto p-2">
                <div className="grid grid-cols-8 gap-2">
                  {emojiCategories.organization.map((emoji, index) => (
                    <button
                      key={`org-${index}`}
                      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-lg hover:bg-muted"
                      onClick={() => handleEmojiSelect(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </TabsContent>
            </>
          )}
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}

// Form-connected version for use with react-hook-form
export const FormEmojiPicker: React.FC<
  Omit<EmojiPickerProps, 'value' | 'onChange'> & {
    value?: string
    onChange?: (value: string) => void
    onBlur?: () => void
  }
> = ({ value = '👥', onChange, onBlur, ...props }) => {
  const handleChange = (emoji: string) => {
    onChange?.(emoji)
  }

  return <EmojiPicker value={value} onChange={handleChange} {...props} />
}
