import { Button } from '@auxx/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'
import type { Editor } from '@tiptap/react'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Redo,
  Strikethrough,
  Undo,
} from 'lucide-react'

type Props = {
  editor: Editor
  value: string
  handleSend: (value: string, editor: Editor) => void
  isSending: boolean
}
/**
 * TipTap Menu bar for the editor
 *
 *
 */
const TipTapMenuBar = ({ editor, handleSend, isSending, value }: Props) => {
  return (
    <div className='flex w-full items-center'>
      <div className='flex flex-wrap items-center'>
        <Tooltip>
          <TooltipTrigger asChild>
            <input
              type='color'
              onInput={(event) => editor.chain().focus().setColor(event.target.value).run()}
              value={editor.getAttributes('textStyle').color}
              data-testid='setColor'
            />
          </TooltipTrigger>
          <TooltipContent>Bold</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleBold().run()}
              disabled={!editor.can().chain().focus().toggleBold().run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('bold') })}>
              <Bold className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Bold</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleItalic().run()}
              disabled={!editor.can().chain().focus().toggleItalic().run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('italic') })}>
              <Italic className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Italic</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleStrike().run()}
              disabled={!editor.can().chain().focus().toggleStrike().run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('strike') })}>
              <Strikethrough className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Strike</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleCode().run()}
              disabled={!editor.can().chain().focus().toggleCode().run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('code') })}>
              <Code className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Code</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('heading', { level: 1 }) })}>
              <Heading1 className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Heading 1</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('heading', { level: 2 }) })}>
              <Heading2 className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Heading 2</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('heading', { level: 3 }) })}>
              <Heading3 className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Heading 3</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('heading', { level: 4 }) })}>
              <Heading4 className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Heading 4</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('heading', { level: 5 }) })}>
              <Heading5 className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Heading 5</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('heading', { level: 6 }) })}>
              <Heading6 className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Heading 6</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('bulletList') })}>
              <List className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Bullet List</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('orderedList') })}>
              <ListOrdered className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Ordered List</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              className={cn('h-7 w-7', { 'is-active': editor.isActive('blockquote') })}>
              <Quote className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Blockquote</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().undo().run()}
              className='h-7 w-7'
              disabled={!editor.can().chain().focus().undo().run()}>
              <Undo className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => editor.chain().focus().redo().run()}
              className='h-7 w-7'
              disabled={!editor.can().chain().focus().redo().run()}>
              <Redo className='size-4 text-secondary-foreground' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo</TooltipContent>
        </Tooltip>
      </div>
      <div className='ml-auto flex items-center'>
        <Button
          variant='default'
          size={'sm'}
          disabled={isSending}
          onClick={async () => {
            // editor?.commands.clearContent()
            await handleSend(value, editor)
          }}>
          <Loader2 className={cn('animate-spin', { hidden: !isSending })} />
          Send
        </Button>
      </div>
    </div>
  )
}

export default TipTapMenuBar
