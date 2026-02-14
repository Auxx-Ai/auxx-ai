import { Button } from '@auxx/ui/components/button'
import { Sparkles } from 'lucide-react'
import { Fragment, type ReactNode, useEffect } from 'react'
import { EditorBubble, useEditor } from '../components'
import { removeAIHighlight } from '../extensions'
import { AISelector } from './ai-selector'

interface GenerativeMenuSwitchProps {
  children: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
}
const GenerativeMenuSwitch = ({ children, open, onOpenChange }: GenerativeMenuSwitchProps) => {
  const { editor } = useEditor()

  useEffect(() => {
    if (!open) removeAIHighlight(editor)
  }, [open])
  return (
    <EditorBubble
      tippyOptions={{
        placement: open ? 'bottom-start' : 'top',
        onHidden: () => {
          onOpenChange(false)
          editor.chain().unsetHighlight().run()
        },
      }}
      className='flex w-fit max-w-[90vw] overflow-hidden rounded-md border border-muted bg-background shadow-xl'>
      {open && <AISelector open={open} onOpenChange={onOpenChange} />}
      {!open && (
        <Fragment>
          <Button
            className='gap-1 rounded-none text-purple-500'
            variant='ghost'
            onClick={() => onOpenChange(true)}
            size='sm'>
            <Sparkles className='h-5 w-5' />
            Ask AI
          </Button>
          {children}
        </Fragment>
      )}
    </EditorBubble>
  )
}

export default GenerativeMenuSwitch
