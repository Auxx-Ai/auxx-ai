'use client'

import { Button } from '@auxx/ui/components/button'
import { Command, CommandInput, CommandList } from '@auxx/ui/components/command'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
// import { useCompletion } from 'ai/react'
import { ArrowUp, Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import Markdown from 'react-markdown'
import { toast } from 'sonner'
import { useEditor } from '../components'
import { addAIHighlight } from '../extensions'
import AICompletionCommands from './ai-completion-command'
import AISelectorCommands from './ai-selector-commands'

interface AISelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AISelector({ onOpenChange }: AISelectorProps) {
  const { editor } = useEditor()
  const [inputValue, setInputValue] = useState('')
  const completion = ''
  const isLoading = false
  function complete(prompt: string, options?: { body: { option: string; command?: string } }) {
    toast.error('AI generation is currently disabled.')
    return Promise.resolve()
  }
  // const { completion, complete, isLoading } = useCompletion({
  //   // id: "novel",
  //   api: '/api/generate',
  //   onResponse: (response) => {
  //     if (response.status === 429) {
  //       toast.error('You have reached your request limit for the day.')
  //       return
  //     }
  //   },
  //   onError: () => {
  //     // toast.error(e.message)
  //     toast.error('An error occurred while generating the response.')
  //   },
  // })

  const hasCompletion = completion.length > 0

  return (
    <Command className='w-[350px]'>
      {hasCompletion && (
        <div className='flex max-h-[400px]'>
          <ScrollArea>
            <div className='prose prose-sm p-2 px-4'>
              <Markdown>{completion}</Markdown>
            </div>
          </ScrollArea>
        </div>
      )}

      {isLoading && (
        <div className='flex h-12 w-full items-center px-4 text-sm font-medium text-muted-foreground text-purple-500'>
          <Sparkles className='mr-2 h-4 w-4 shrink-0' />
          AI is thinking
          <div className='ml-2 mt-1'>
            <Loader2 className='h-4 w-4 animate-spin text-purple-500' />
          </div>
        </div>
      )}
      {!isLoading && (
        <>
          <div className='relative'>
            <CommandInput
              value={inputValue}
              onValueChange={setInputValue}
              autoFocus
              placeholder={
                hasCompletion ? 'Tell AI what to do next' : 'Ask AI to edit or generate...'
              }
              onFocus={() => addAIHighlight(editor)}
            />
            <Button
              size='icon'
              className='absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-purple-500 hover:bg-purple-900'
              onClick={() => {
                if (completion)
                  return complete(completion, {
                    body: { option: 'zap', command: inputValue },
                  }).then(() => setInputValue(''))

                const slice = editor.state.selection.content()
                const text = editor.storage.markdown.serializer.serialize(slice.content)

                complete(text, { body: { option: 'zap', command: inputValue } }).then(() =>
                  setInputValue('')
                )
              }}>
              <ArrowUp className='h-4 w-4' />
            </Button>
          </div>
          <CommandList>
            {hasCompletion ? (
              <AICompletionCommands
                onDiscard={() => {
                  editor.chain().unsetHighlight().focus().run()
                  onOpenChange(false)
                }}
                completion={completion}
              />
            ) : (
              <AISelectorCommands
                onSelect={(value, option) => complete(value, { body: { option } })}
              />
            )}
          </CommandList>
        </>
      )}
    </Command>
  )
}
