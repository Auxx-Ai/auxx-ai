// apps/chat-widget/src/components/tab-bar.tsx
//
// Bottom tab bar with Home + Messages. Only rendered when the active tab's
// stack is at root — pushing a deep frame (thread, kb-article…) hides the
// bar so the user can focus on content.

import { Home, MessageSquare } from 'lucide-react'
import { cn } from '~/lib/cn'
import type { TabId } from '~/navigation/use-tab-router'

interface TabBarProps {
  activeTab: TabId
  onChange: (tab: TabId) => void
}

const TABS: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
]

export function TabBar({ activeTab, onChange }: TabBarProps) {
  return (
    <nav
      className='auxx-chat-clip-bottom flex shrink-0 items-stretch justify-around divide-x divide-[color:var(--auxx-chat-hairline)] border-t border-[color:var(--auxx-chat-hairline)] bg-transparent'
      aria-label='Widget sections'>
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab
        const IconComponent = tab.icon
        return (
          <button
            key={tab.id}
            type='button'
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-medium transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? 'page' : undefined}>
            <IconComponent className='size-5' aria-hidden='true' />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
