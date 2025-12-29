// apps/web/src/components/datasets/settings/dataset-settings.tsx
'use client'
import { useQueryState } from 'nuqs'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Settings, Search, Zap, Layers } from 'lucide-react'
import { GeneralSettingsSection } from './sections/general-settings-section'
import { ChunkingSettingsSection } from './sections/chunking-settings-section'
import { EmbeddingSettingsSection } from './sections/embedding-settings-section'
import { SearchConfigurationSection } from './sections/search-configuration-section'
import type { Dataset } from '@auxx/database/types'

interface DatasetSettingsProps {
  dataset: Dataset
  onUpdate?: (dataset: Dataset) => void
  readOnly?: boolean
}

type SettingsSection = 'general' | 'chunking' | 'embedding' | 'search'

const SETTINGS_SECTIONS = [
  {
    id: 'general' as SettingsSection,
    label: 'General',
    icon: Settings,
    description: 'Basic dataset information and status',
  },
  {
    id: 'chunking' as SettingsSection,
    label: 'Chunking',
    icon: Layers,
    description: 'Text chunking strategy and parameters',
  },
  {
    id: 'embedding' as SettingsSection,
    label: 'Embedding',
    icon: Zap,
    description: 'Embedding model and vector configuration',
  },
  {
    id: 'search' as SettingsSection,
    label: 'Search',
    icon: Search,
    description: 'Default search configuration for workflows',
  },
]
export function DatasetSettings({ dataset, onUpdate, readOnly = false }: DatasetSettingsProps) {
  const [activeSection, setActiveSection] = useQueryState('s', {
    defaultValue: 'general',
  }) as [SettingsSection, (section: string) => void]
  const renderActiveSection = () => {
    const commonProps = { dataset, onUpdate, readOnly }
    switch (activeSection) {
      case 'general':
        return <GeneralSettingsSection {...commonProps} />
      case 'chunking':
        return <ChunkingSettingsSection {...commonProps} />
      case 'embedding':
        return <EmbeddingSettingsSection {...commonProps} />
      case 'search':
        return <SearchConfigurationSection {...commonProps} />
      default:
        return <GeneralSettingsSection {...commonProps} />
    }
  }
  return (
    <div className="overflowy-y-auto h-full flex-1">
      {/* Settings Navigation */}
      <div className="p-3 backdrop-blur-sm sticky top-0 z-10 bg-background/70 border-b border-border">
        <RadioTab
          value={activeSection}
          onValueChange={setActiveSection}
          size="sm"
          radioGroupClassName="grid w-full grid-cols-4"
          className="border border-primary-200 flex w-full">
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon
            return (
              <RadioTabItem key={section.id} value={section.id} size="sm">
                <Icon />
                {section.label}
              </RadioTabItem>
            )
          })}
        </RadioTab>
      </div>
      {/* Active Settings Section */}
      {renderActiveSection()}
    </div>
  )
}
