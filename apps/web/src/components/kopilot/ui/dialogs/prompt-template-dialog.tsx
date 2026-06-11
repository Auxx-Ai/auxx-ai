// apps/web/src/components/kopilot/ui/dialogs/prompt-template-dialog.tsx

'use client'

import { constants } from '@auxx/config/client'
import type { DocJSON } from '@auxx/lib/kb/markdown'
import type { SystemTemplateGalleryItem } from '@auxx/lib/prompt-templates'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { EntityIcon } from '@auxx/ui/components/icons'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { DEFAULT_TABS } from '~/components/editor/inline-picker'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import { PromptEditor } from '~/components/editor/prompt-editor'
import { TemplateGalleryDialog } from '~/components/templates/ui'
import { usePromptTemplateMutations } from '../../hooks/use-prompt-template-mutations'
import { useSystemTemplates } from '../../hooks/use-prompt-templates'

const TEMPLATE_REFERENCE_TABS: ReferenceTab[] = [...DEFAULT_TABS, 'tools', 'resources', 'fields']

function emptyPromptDoc(): DocJSON {
  return {
    type: 'doc',
    content: [{ type: 'block', attrs: { blockType: 'text' }, content: [] }],
  }
}

function deepEqualDoc(a: DocJSON, b: DocJSON): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

interface PromptTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PromptTemplateDialog({ open, onOpenChange }: PromptTemplateDialogProps) {
  const { templates, isLoading } = useSystemTemplates()
  const { install } = usePromptTemplateMutations()

  const [editedPrompt, setEditedPrompt] = useState<DocJSON>(emptyPromptDoc)
  const [editorKey, setEditorKey] = useState(0)
  const [isCustomizing, setIsCustomizing] = useState(false)

  function handleInstall(template: SystemTemplateGalleryItem, onDone: () => void) {
    install.mutate(
      {
        systemTemplateId: template.id,
        prompt: deepEqualDoc(editedPrompt, template.prompt) ? undefined : editedPrompt,
      },
      { onSuccess: onDone }
    )
  }

  return (
    <TemplateGalleryDialog<SystemTemplateGalleryItem>
      open={open}
      onOpenChange={onOpenChange}
      title='Prompt Templates'
      description='Browse and install prompt templates'
      crumbLabel='Prompt templates'
      itemNoun='prompt'
      layout='cards'
      items={templates}
      isLoading={isLoading}
      categories={constants.promptTemplateCategories}
      renderIcon={(template) => (
        <EntityIcon
          iconId={template.icon.iconId}
          color={template.icon.color}
          size='lg'
          variant='muted'
        />
      )}
      renderNameBadge={(template) =>
        template.installed ? (
          <Badge variant='outline' className='shrink-0 text-[10px]'>
            <Check className='size-3' />
            Installed
          </Badge>
        ) : null
      }
      // Seed the editor with the template prompt, then fall through to the detail page.
      onSelectItem={(template) => {
        setEditedPrompt(template.prompt)
        setIsCustomizing(false)
        setEditorKey((k) => k + 1)
      }}
      detailCrumb={(template) => template.name}
      detailBusy={install.isPending}
      onDetailExit={() => {
        setEditedPrompt(emptyPromptDoc())
        setIsCustomizing(false)
        setEditorKey((k) => k + 1)
      }}
      renderDetail={(template) => (
        <ScrollArea className='h-[460px]'>
          <div className='space-y-4 p-6'>
            <div className='flex items-start gap-3'>
              <EntityIcon
                iconId={template.icon.iconId}
                color={template.icon.color}
                size='xl'
                variant='muted'
              />
              <div>
                <h2 className='text-lg font-semibold'>{template.name}</h2>
                <p className='mt-0.5 text-sm text-muted-foreground'>{template.description}</p>
                <div className='mt-2 flex items-center gap-1.5'>
                  {template.installed && (
                    <Badge variant='outline' className='text-xs'>
                      <Check className='size-3' />
                      Installed
                    </Badge>
                  )}
                  {template.categories.map((cat) => (
                    <Badge key={cat} variant='secondary' className='text-xs'>
                      {constants.promptTemplateCategories.find((c) => c.value === cat)?.label ??
                        cat}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <h3 className='text-sm font-medium'>Prompt</h3>
                {!template.installed && (
                  <Button
                    variant='ghost'
                    size='xs'
                    onClick={() => {
                      if (isCustomizing) {
                        setIsCustomizing(false)
                        setEditedPrompt(template.prompt)
                        setEditorKey((k) => k + 1)
                      } else {
                        setIsCustomizing(true)
                        setEditorKey((k) => k + 1)
                      }
                    }}>
                    {isCustomizing ? 'Cancel' : 'Customize'}
                  </Button>
                )}
              </div>
              {isCustomizing ? (
                <div className='rounded-xl border bg-background p-4'>
                  <PromptEditor
                    key={editorKey}
                    initialContent={template.prompt.content as never}
                    onChange={({ json }) => setEditedPrompt(json as DocJSON)}
                    referenceTabs={TEMPLATE_REFERENCE_TABS}
                  />
                </div>
              ) : (
                <div className='rounded-xl border bg-muted/30 p-4'>
                  <PromptEditor
                    key={`preview-${template.id}`}
                    initialContent={template.prompt.content as never}
                    onChange={() => {}}
                    editable={false}
                    referenceTabs={TEMPLATE_REFERENCE_TABS}
                  />
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      )}
      renderDetailFooter={(template, { back }) =>
        template.installed ? null : (
          <Button
            variant='outline'
            size='sm'
            onClick={() => handleInstall(template, back)}
            loading={install.isPending}
            loadingText='Installing...'>
            Install prompt
          </Button>
        )
      }
    />
  )
}
