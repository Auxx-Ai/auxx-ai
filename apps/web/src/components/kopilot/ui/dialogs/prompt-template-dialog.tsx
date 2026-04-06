// apps/web/src/components/kopilot/ui/dialogs/prompt-template-dialog.tsx

'use client'

import { constants } from '@auxx/config/client'
import type { SystemTemplateGalleryItem } from '@auxx/lib/prompt-templates'
import { AutosizeTextarea } from '@auxx/ui/components/autosize-textarea'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { EntityIcon } from '@auxx/ui/components/icons'
import { InputSearch } from '@auxx/ui/components/input-search'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import {
  Check,
  ChevronLeft,
  Handshake,
  Headphones,
  LayoutGrid,
  Loader2,
  type LucideIcon,
  Search,
  ShoppingBag,
  Sparkles,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { usePromptTemplateMutations } from '../../hooks/use-prompt-template-mutations'
import { useSystemTemplates } from '../../hooks/use-prompt-templates'

/** Map icon names from constants to Lucide components */
const categoryIcons: Record<string, LucideIcon> = {
  LayoutGrid,
  Headphones,
  ShoppingBag,
  Handshake,
  Sparkles,
}

interface PromptTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type PromptCategory = (typeof constants.promptTemplateCategories)[number]['value']

export function PromptTemplateDialog({ open, onOpenChange }: PromptTemplateDialogProps) {
  const { templates, isLoading } = useSystemTemplates()
  const { install } = usePromptTemplateMutations()
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<PromptCategory>('all')
  const [selectedTemplate, setSelectedTemplate] = useState<SystemTemplateGalleryItem | null>(null)
  const [editedPrompt, setEditedPrompt] = useState('')
  const [isCustomizing, setIsCustomizing] = useState(false)

  const filteredTemplates = useMemo(() => {
    let filtered = templates

    if (selectedCategory !== 'all') {
      filtered = filtered.filter((t) => t.categories.includes(selectedCategory))
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)
      )
    }

    return filtered
  }, [templates, selectedCategory, searchQuery])

  const handleSelectTemplate = useCallback((template: SystemTemplateGalleryItem) => {
    setSelectedTemplate(template)
    setEditedPrompt(template.prompt)
    setViewMode('detail')
  }, [])

  const handleInstall = useCallback(() => {
    if (!selectedTemplate) return

    install.mutate(
      {
        systemTemplateId: selectedTemplate.id,
        prompt: editedPrompt !== selectedTemplate.prompt ? editedPrompt : undefined,
      },
      {
        onSuccess: () => {
          setViewMode('list')
          setSelectedTemplate(null)
          setEditedPrompt('')
          setIsCustomizing(false)
        },
      }
    )
  }, [selectedTemplate, editedPrompt, install])

  const handleBack = useCallback(() => {
    setViewMode('list')
    setSelectedTemplate(null)
    setEditedPrompt('')
    setIsCustomizing(false)
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='h-[550px]'
        innerClassName='p-0'
        position='tc'
        size='3xl'
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          searchInputRef.current?.focus()
        }}>
        <div className='flex flex-col flex-1 min-h-0'>
          {viewMode === 'list' ? (
            <>
              {/* LIST VIEW */}
              <DialogHeader className='border-b px-3 h-10 flex flex-row items-center justify-start mb-0'>
                <div>
                  <Button variant='ghost' size='sm'>
                    Prompt templates
                  </Button>
                  <DialogTitle className='sr-only'>Prompt Templates</DialogTitle>
                  <DialogDescription className='sr-only'>
                    Browse and install prompt templates
                  </DialogDescription>
                </div>
              </DialogHeader>

              <div className='flex flex-1 flex-row justify-start w-full min-h-0'>
                {/* Sidebar */}
                <div className='w-64 border-r bg-muted/30 flex flex-col rounded-bl-[16px]'>
                  <ScrollArea>
                    <h3 className='p-3 pb-0 text-sm font-semibold text-muted-foreground sticky top-0'>
                      Categories
                    </h3>
                    <div className='p-3'>
                      <RadioGroup
                        value={selectedCategory}
                        onValueChange={(value) => setSelectedCategory(value as PromptCategory)}>
                        {constants.promptTemplateCategories.map((category) => {
                          const templateCount =
                            category.value === 'all'
                              ? templates.length
                              : templates.filter((t) => t.categories.includes(category.value))
                                  .length

                          const Icon = categoryIcons[category.icon]

                          return (
                            <RadioGroupItemCard
                              key={category.value}
                              label={category.label}
                              value={category.value}
                              description={
                                isLoading
                                  ? 'Loading...'
                                  : `${templateCount} prompt${templateCount !== 1 ? 's' : ''}`
                              }
                              icon={Icon ? <Icon /> : undefined}
                            />
                          )
                        })}
                      </RadioGroup>
                    </div>
                  </ScrollArea>
                </div>

                {/* Template Grid */}
                <div className='flex-1 overflow-hidden flex flex-col'>
                  <div className='py-3 px-6'>
                    <InputSearch
                      ref={searchInputRef}
                      placeholder='Search prompts by name or description...'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onClear={() => setSearchQuery('')}
                    />
                  </div>

                  {isLoading ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant='icon'>
                          <Loader2 className='animate-spin' />
                        </EmptyMedia>
                        <EmptyTitle>Loading...</EmptyTitle>
                        <EmptyDescription>Fetching prompt templates</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : filteredTemplates.length > 0 ? (
                    <ScrollArea className='flex-1'>
                      <div className='p-6 grid grid-cols-2 gap-3'>
                        {filteredTemplates.map((template) => (
                          <div
                            key={template.id}
                            onClick={() => handleSelectTemplate(template)}
                            className='group flex flex-col gap-2 rounded-2xl border p-3 hover:bg-primary-50 transition-colors duration-200 cursor-pointer'>
                            <div className='flex items-start gap-3'>
                              <EntityIcon
                                iconId={template.icon.iconId}
                                color={template.icon.color}
                                size='lg'
                                variant='muted'
                              />
                              <div className='flex flex-col flex-1 min-w-0'>
                                <div className='flex items-center gap-2'>
                                  <span className='text-sm font-semibold truncate'>
                                    {template.name}
                                  </span>
                                </div>
                                <span className='text-xs text-muted-foreground line-clamp-2 mt-0.5'>
                                  {template.description}
                                </span>
                              </div>
                            </div>
                            {template.installed && (
                              <div className='flex items-center gap-1.5'>
                                <Badge variant='outline' className='text-[10px]'>
                                  <Check className='size-3' />
                                  Installed
                                </Badge>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant='icon'>
                          <Search />
                        </EmptyMedia>
                        <EmptyTitle>No prompts found</EmptyTitle>
                        <EmptyDescription>
                          {searchQuery
                            ? 'No prompts match your search. Try adjusting your query or browse different categories.'
                            : 'No prompts available in this category yet.'}
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}

                  {!isLoading && filteredTemplates.length > 0 && (
                    <div className='border-t px-6 py-3 bg-muted/30'>
                      <p className='text-sm text-muted-foreground'>
                        Showing {filteredTemplates.length} prompt
                        {filteredTemplates.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* DETAIL VIEW */}
              <DialogHeader className='border-b px-3 h-10 flex flex-row items-center justify-start mb-0'>
                <div className='flex items-center gap-1'>
                  <Button variant='ghost' size='sm' onClick={handleBack}>
                    <ChevronLeft className='size-4' />
                    Back
                  </Button>
                  <span className='text-muted-foreground'>/</span>
                  <span className='text-sm font-medium truncate max-w-[300px]'>
                    {selectedTemplate?.name}
                  </span>
                  <DialogTitle className='sr-only'>{selectedTemplate?.name}</DialogTitle>
                  <DialogDescription className='sr-only'>Prompt template details</DialogDescription>
                </div>
              </DialogHeader>

              {selectedTemplate && (
                <div className='flex flex-col flex-1 min-h-0'>
                  <ScrollArea className='flex-1'>
                    <div className='space-y-4 p-6'>
                      <div className='flex items-start gap-3'>
                        <EntityIcon
                          iconId={selectedTemplate.icon.iconId}
                          color={selectedTemplate.icon.color}
                          size='xl'
                          variant='muted'
                        />
                        <div>
                          <h2 className='text-lg font-semibold'>{selectedTemplate.name}</h2>
                          <p className='text-sm text-muted-foreground mt-0.5'>
                            {selectedTemplate.description}
                          </p>
                          <div className='flex items-center gap-1.5 mt-2'>
                            {selectedTemplate.installed && (
                              <Badge variant='outline' className='text-xs'>
                                <Check className='size-3' />
                                Installed
                              </Badge>
                            )}
                            {selectedTemplate.categories.map((cat) => (
                              <Badge key={cat} variant='secondary' className='text-xs'>
                                {constants.promptTemplateCategories.find((c) => c.value === cat)
                                  ?.label ?? cat}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className='space-y-2'>
                        <div className='flex items-center justify-between'>
                          <h3 className='text-sm font-medium'>Prompt</h3>
                          {!selectedTemplate.installed && (
                            <Button
                              variant='ghost'
                              size='xs'
                              onClick={() => {
                                if (isCustomizing) {
                                  setIsCustomizing(false)
                                  setEditedPrompt(selectedTemplate.prompt)
                                } else {
                                  setIsCustomizing(true)
                                }
                              }}>
                              {isCustomizing ? 'Cancel' : 'Customize'}
                            </Button>
                          )}
                        </div>
                        {isCustomizing ? (
                          <div className='px-0.5 pb-0.5'>
                            <AutosizeTextarea
                              value={editedPrompt}
                              onChange={(e) => setEditedPrompt(e.target.value)}
                              minHeight={200}
                              className='text-sm rounded-xl bg-muted/30 ps-[14px]! p-4 leading-relaxed'
                              autoFocus
                            />
                          </div>
                        ) : (
                          <div className='rounded-xl border bg-muted/30 p-4'>
                            <p className='text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed'>
                              {selectedTemplate.prompt}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </ScrollArea>

                  <div className='flex justify-end gap-2 pt-4 border-t px-6 pb-6'>
                    <Button variant='ghost' size='sm' onClick={handleBack}>
                      Back
                    </Button>
                    {!selectedTemplate.installed && (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={handleInstall}
                        loading={install.isPending}
                        loadingText='Installing...'>
                        Install prompt
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
