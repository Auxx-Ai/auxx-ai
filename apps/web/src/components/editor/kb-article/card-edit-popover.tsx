// apps/web/src/components/editor/kb-article/card-edit-popover.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Field, FieldLabel } from '@auxx/ui/components/field'
import { IconPicker } from '@auxx/ui/components/icon-picker'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import type { CardData } from '@auxx/ui/components/kb/article'
import { Popover, PopoverAnchor, PopoverContent } from '@auxx/ui/components/popover'
import { Textarea } from '@auxx/ui/components/textarea'
import { Link as LinkIcon, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type ArticleLinkPick, ArticleLinkPopover } from './article-link-popover'

interface CardEditPopoverProps {
  card: CardData
  knowledgeBaseId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (patch: Partial<CardData>) => void
  /** The element the popover anchors to — typically the card itself. */
  children: React.ReactNode
}

export function CardEditPopover({
  card,
  knowledgeBaseId,
  open,
  onOpenChange,
  onChange,
  children,
}: CardEditPopoverProps) {
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description ?? '')
  const [href, setHref] = useState(card.href ?? '')
  const [iconId, setIconId] = useState(card.iconId ?? null)
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const linkPickerOpenRef = useRef(false)

  useEffect(() => {
    linkPickerOpenRef.current = linkPickerOpen
  }, [linkPickerOpen])

  useEffect(() => {
    if (open) {
      setTitle(card.title)
      setDescription(card.description ?? '')
      setHref(card.href ?? '')
      setIconId(card.iconId ?? null)
    }
  }, [open, card])

  const persistAndClose = () => {
    onChange({
      title: title.trim(),
      description: description.trim() || undefined,
      href: href.trim() || undefined,
      iconId: iconId ?? undefined,
    })
    onOpenChange(false)
  }

  const handleLinkPick = (pick: ArticleLinkPick) => {
    setHref(pick.href)
    setLinkPickerOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) persistAndClose()
        else onOpenChange(true)
      }}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align='start'
        sideOffset={8}
        className='w-96 space-y-4 p-4'
        onInteractOutside={(e) => {
          if (linkPickerOpenRef.current) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (linkPickerOpenRef.current) e.preventDefault()
        }}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
        }}>
        <Field>
          <InputGroup>
            <InputGroupAddon align='inline-start' className='ml-1'>
              <IconPicker
                value={{ icon: iconId ?? 'square', color: 'gray' }}
                onChange={(v) => setIconId(v.icon)}
                hideColors
                modal={false}
                className='size-6'
              />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='Card title'
            />
          </InputGroup>
        </Field>

        <Field>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='*bold*, _italic_, `code`, [label](url)…'
            rows={3}
          />
        </Field>

        <Field>
          <InputGroup>
            <InputGroupAddon align='inline-start'>
              <LinkIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={href}
              onChange={(e) => setHref(e.target.value)}
              placeholder='auxx://kb/article/… or https://…'
            />
            <InputGroupAddon align='inline-end' className='gap-1'>
              <ArticleLinkPopover
                open={linkPickerOpen}
                onOpenChange={setLinkPickerOpen}
                knowledgeBaseId={knowledgeBaseId}
                onPick={handleLinkPick}>
                <InputGroupButton size='xs' onClick={() => setLinkPickerOpen(true)}>
                  Pick article
                </InputGroupButton>
              </ArticleLinkPopover>
              {href ? (
                <InputGroupButton
                  size='icon-xs'
                  aria-label='Clear link'
                  onClick={() => setHref('')}
                  className='hover:bg-destructive/10 hover:text-destructive'>
                  <Trash2 />
                </InputGroupButton>
              ) : null}
            </InputGroupAddon>
          </InputGroup>
        </Field>

        <div className='flex justify-end gap-2 pt-1'>
          <Button type='button' variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type='button' variant='outline' size='sm' onClick={persistAndClose}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
