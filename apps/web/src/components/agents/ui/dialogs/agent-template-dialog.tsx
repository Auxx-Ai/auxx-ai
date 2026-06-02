// apps/web/src/components/agents/ui/dialogs/agent-template-dialog.tsx
'use client'

import { constants } from '@auxx/config/client'
import {
  type AgentTemplate,
  type AgentTemplateCategory,
  agentTemplates,
} from '@auxx/lib/agents/client'
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
import { getIconColor } from '@auxx/ui/components/icons'
import { InputSearch } from '@auxx/ui/components/input-search'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { cn } from '@auxx/ui/lib/utils'
import {
  BarChart3,
  Building2,
  Crown,
  GraduationCap,
  Handshake,
  Headphones,
  LayoutGrid,
  type LucideIcon,
  RefreshCcw,
  Search,
  Send,
  Settings,
  Sunrise,
  Target,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import { useAgentMutations } from '../../hooks/use-agent-mutations'

/** Lucide icon registry — extend as new template `icon` values are added. */
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  Headphones,
  RefreshCcw,
  Crown,
  Target,
  Send,
  BarChart3,
  Sunrise,
  GraduationCap,
}

/** Sidebar category icons. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  LayoutGrid,
  Headphones,
  Handshake,
  Settings,
  Building2,
}

type AgentCategoryValue = (typeof constants.agentTemplateCategories)[number]['value']

interface AgentTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Scopes the dialog to one agent kind; templates are filtered to it. */
  kind: 'internal' | 'chat'
}

/**
 * "Create from template" dialog for the agents list page. Mirrors the list
 * view of the entity-template dialog — no detail screen. Clicking a row
 * creates a draft agent and routes to its detail page with `?template=<id>`;
 * `AgentDockedChat` picks the param up and auto-submits the template prompt
 * as the first builder-chat turn.
 */
export function AgentTemplateDialog({ open, onOpenChange, kind }: AgentTemplateDialogProps) {
  const router = useRouter()
  const { createAgent } = useAgentMutations()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<AgentCategoryValue>('all')
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null)

  // Kind is the primary filter (set by the Create dropdown); the category
  // sidebar is an orthogonal topic filter applied on top.
  const kindTemplates = useMemo(() => agentTemplates.filter((t) => t.kind === kind), [kind])

  const filteredTemplates = useMemo(() => {
    let list: AgentTemplate[] = kindTemplates

    if (selectedCategory !== 'all') {
      list = list.filter((t) => t.categories.includes(selectedCategory as AgentTemplateCategory))
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      )
    }

    return list
  }, [searchQuery, selectedCategory, kindTemplates])

  async function handleSelectTemplate(template: AgentTemplate) {
    if (creatingTemplateId) return
    setCreatingTemplateId(template.id)
    const created = await createAgent({ kind: template.kind })
    if (!created) {
      setCreatingTemplateId(null)
      return
    }
    onOpenChange(false)
    router.push(`/app/agents/${created.slug}?template=${template.id}`)
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSearchQuery('')
      setSelectedCategory('all')
      setCreatingTemplateId(null)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className='h-dvh sm:h-[550px]'
        innerClassName='p-0'
        position='tc'
        size='3xl'
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          searchInputRef.current?.focus()
        }}>
        <div className='flex flex-col flex-1 min-h-0'>
          <DialogHeader className='border-b px-3 h-10 flex flex-row items-center justify-start mb-0'>
            <div>
              <Button variant='ghost' size='sm'>
                Agent templates
              </Button>
              <DialogTitle className='sr-only'>Create from template</DialogTitle>
              <DialogDescription className='sr-only'>
                Select an agent template to scaffold
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className='flex flex-1 flex-col sm:flex-row justify-start w-full min-h-0'>
            {/* Sidebar */}
            <div className='hidden sm:flex w-64 border-r bg-muted/30 flex-col rounded-bl-[16px]'>
              <ScrollArea>
                <h3 className='p-3 pb-0 text-sm font-semibold text-muted-foreground sticky top-0'>
                  Categories
                </h3>
                <div className='p-3'>
                  <RadioGroup
                    value={selectedCategory}
                    onValueChange={(v) => setSelectedCategory(v as AgentCategoryValue)}>
                    {constants.agentTemplateCategories.map((category) => {
                      const count =
                        category.value === 'all'
                          ? kindTemplates.length
                          : kindTemplates.filter((t) =>
                              t.categories.includes(category.value as AgentTemplateCategory)
                            ).length

                      const Icon = CATEGORY_ICONS[category.icon]

                      return (
                        <RadioGroupItemCard
                          key={category.value}
                          label={category.label}
                          value={category.value}
                          description={`${count} template${count !== 1 ? 's' : ''}`}
                          icon={Icon ? <Icon /> : undefined}
                        />
                      )
                    })}
                  </RadioGroup>
                </div>
              </ScrollArea>
            </div>

            {/* Template list */}
            <div className='flex-1 overflow-hidden flex flex-col'>
              <div className='py-3 px-3 sm:px-6'>
                <InputSearch
                  ref={searchInputRef}
                  placeholder='Search templates...'
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onClear={() => setSearchQuery('')}
                />
              </div>

              {filteredTemplates.length > 0 ? (
                <ScrollArea className='flex-1'>
                  <div className='p-3 sm:p-6 space-y-2'>
                    {filteredTemplates.map((template) => {
                      const Icon = TEMPLATE_ICONS[template.icon]
                      const colorData = getIconColor(template.color)
                      const isCreating = creatingTemplateId === template.id
                      const isAnyCreating = creatingTemplateId !== null
                      return (
                        <button
                          type='button'
                          key={template.id}
                          onClick={() => handleSelectTemplate(template)}
                          disabled={isAnyCreating}
                          className={cn(
                            'group flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200 cursor-pointer text-left w-full',
                            isAnyCreating && !isCreating && 'opacity-50 cursor-default',
                            isCreating && 'bg-muted'
                          )}>
                          <div className='flex items-start gap-3 flex-1 min-w-0'>
                            <div
                              className={cn(
                                'size-8 rounded-lg flex items-center justify-center shrink-0 inset-shadow-xs inset-shadow-black/20 [&_svg]:size-4',
                                colorData.inverseColor
                              )}>
                              {Icon ? <Icon /> : null}
                            </div>
                            <div className='flex flex-col flex-1 min-w-0'>
                              <span className='text-sm font-medium truncate'>{template.name}</span>
                              <span className='text-xs text-muted-foreground line-clamp-1 mt-0.5'>
                                {template.description}
                              </span>
                            </div>
                          </div>
                          {template.categories.length > 0 && (
                            <div className='flex gap-1 shrink-0 ml-11 sm:ml-0'>
                              {template.categories.map((cat) => (
                                <Badge key={cat} variant='outline' className='text-xs'>
                                  {cat}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </ScrollArea>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'>
                      <Search />
                    </EmptyMedia>
                    <EmptyTitle>No templates found</EmptyTitle>
                    <EmptyDescription>
                      {searchQuery
                        ? 'No templates match your search. Try adjusting your query.'
                        : 'No templates available in this category.'}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}

              {filteredTemplates.length > 0 && (
                <div className='border-t px-6 py-3 bg-muted/30'>
                  <p className='text-sm text-muted-foreground'>
                    Showing {filteredTemplates.length} template
                    {filteredTemplates.length !== 1 ? 's' : ''}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
