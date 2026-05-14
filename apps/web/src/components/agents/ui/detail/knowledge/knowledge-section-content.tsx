// apps/web/src/components/agents/ui/detail/knowledge/knowledge-section-content.tsx
'use client'

import { Section } from '@auxx/ui/components/section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { useCallback, useState } from 'react'
import type { AgentDetail } from '../../../store/agent-store'
import type { AutosaveState } from '../../shared/autosave-indicator'
import { KnowledgeSubTab } from './knowledge-sub-tab'
import { PinnedRecordsBlock } from './pinned-records-block'

interface KnowledgeSectionContentProps {
  agent: AgentDetail
  onAutosaveChange?: (state: AutosaveState) => void
}

type SubTab = 'knowledge' | 'entities' | 'tickets' | 'datasets' | 'meetings'

const SUB_TABS: Array<{ value: SubTab; label: string; prefix: string | null }> = [
  { value: 'knowledge', label: 'Knowledge', prefix: 'article' },
  { value: 'entities', label: 'Entities', prefix: 'contact' },
  { value: 'tickets', label: 'Tickets', prefix: 'ticket' },
  { value: 'datasets', label: 'Datasets', prefix: 'dataset' },
  { value: 'meetings', label: 'Meetings', prefix: 'meeting' },
]

/**
 * Knowledge tab body. Sub-tabs split scope rows + pinned references per
 * record type. v1 ships the Knowledge sub-tab (KB → articles); the rest
 * render a stub until their tree adapters land.
 */
export function KnowledgeSectionContent({ agent, onAutosaveChange }: KnowledgeSectionContentProps) {
  const [tab, setTab] = useState<SubTab>('knowledge')

  const handleSavingChange = useCallback(
    (saving: boolean) => {
      onAutosaveChange?.(saving ? { kind: 'saving' } : { kind: 'saved', at: Date.now() })
    },
    [onAutosaveChange]
  )

  return (
    <div className='px-3 pb-6 space-y-4'>
      <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
        <TabsList className='justify-start'>
          {SUB_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {SUB_TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className='mt-4 space-y-4'>
            <Section
              title='Pinned references'
              description='Records always-on in the prompt. Tap the star to unpin.'
              initialOpen>
              <PinnedRecordsBlock
                agent={agent}
                filterPrefix={t.prefix}
                onSavingChange={handleSavingChange}
              />
            </Section>

            <Section
              title='Access scope'
              description='Which records this agent can search and read.'
              initialOpen>
              {t.value === 'knowledge' ? (
                <KnowledgeSubTab agent={agent} onSavingChange={handleSavingChange} />
              ) : (
                <p className='text-sm text-muted-foreground py-2'>
                  Tree for {t.label.toLowerCase()} lands in a follow-up. Use pinned references above
                  to scope individual records for now.
                </p>
              )}
            </Section>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
