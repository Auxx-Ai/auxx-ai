// apps/web/src/components/workflow/nodes/core/note/editor/toolbar-components.tsx

import React from 'react'
import {
  Bold,
  Italic,
  Strikethrough,
  Link,
  List,
  Copy,
  Trash2,
  User,
  Palette,
  Type,
} from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Toggle } from '@auxx/ui/components/toggle'
import { cn } from '@auxx/ui/lib/utils'
import { NoteTheme } from '../types'
import { THEME_MAP } from '../constants'

interface ColorPickerProps {
  theme: NoteTheme
  onThemeChange: (theme: NoteTheme) => void
}

export const ColorPicker: React.FC<ColorPickerProps> = ({ theme, onThemeChange }) => {
  const themes: NoteTheme[] = ['yellow', 'blue', 'purple', 'pink', 'green']

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2">
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {themes.map((t) => (
          <DropdownMenuItem key={t} onClick={() => onThemeChange(t)}>
            <div className="flex items-center gap-2">
              <div className={cn('h-4 w-4 rounded', THEME_MAP[t].title)} />
              <span className="capitalize">{t}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface FontSizeSelectorProps {
  fontSize: number
  onFontSizeChange: (size: number) => void
}

export const FontSizeSelector: React.FC<FontSizeSelectorProps> = ({
  fontSize,
  onFontSizeChange,
}) => {
  const sizes = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2">
          <Type className="h-4 w-4" />
          <span className="ml-1 text-xs">{fontSize}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {sizes.map((size) => (
          <DropdownMenuItem key={size} onClick={() => onFontSizeChange(size)}>
            {size}px
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface FormattingButtonProps {
  icon: React.ReactNode
  isActive: boolean
  onClick: () => void
  tooltip?: string
}

export const FormattingButton: React.FC<FormattingButtonProps> = ({
  icon,
  isActive,
  onClick,
  tooltip,
}) => {
  return (
    <Toggle
      size="sm"
      pressed={isActive}
      onPressedChange={onClick}
      className="h-8 px-2"
      title={tooltip}>
      {icon}
    </Toggle>
  )
}

interface ToolbarDividerProps {}

export const ToolbarDivider: React.FC<ToolbarDividerProps> = () => {
  return <div className="mx-1 h-4 w-[1px] bg-border" />
}

interface OperatorButtonsProps {
  onCopy: () => void
  onDuplicate: () => void
  onDelete: () => void
  showAuthor: boolean
  onShowAuthorChange: (show: boolean) => void
}

export const OperatorButtons: React.FC<OperatorButtonsProps> = ({
  onCopy,
  onDuplicate,
  onDelete,
  showAuthor,
  onShowAuthorChange,
}) => {
  return (
    <>
      <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onCopy}>
        <Copy className="h-4 w-4" />
      </Button>
      <Toggle
        size="sm"
        pressed={showAuthor}
        onPressedChange={onShowAuthorChange}
        className="h-8 px-2">
        <User className="h-4 w-4" />
      </Toggle>
      <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onDelete}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </>
  )
}

export const formattingIcons = {
  bold: <Bold className="h-4 w-4" />,
  italic: <Italic className="h-4 w-4" />,
  strikethrough: <Strikethrough className="h-4 w-4" />,
  link: <Link className="h-4 w-4" />,
  bulletList: <List className="h-4 w-4" />,
}
