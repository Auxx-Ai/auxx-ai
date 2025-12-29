// apps/web/src/app/(protected)/app/rules/_components/testing/thread-selector.tsx
'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@auxx/ui/components/input'
import { Button } from '@auxx/ui/components/button'
import { ScrollArea } from '@auxx/ui/components/scroll-area'

interface ThreadSelectorProps {
  onSelect: (threadId: string) => void
  filters?: string[]
}

export function ThreadSelector({ onSelect, filters }: ThreadSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('')

  // Mock threads data
  const mockThreads = [
    {
      id: 'thread-1',
      subject: 'Order #1234 - Shipping inquiry',
      from: 'customer@example.com',
      date: new Date(),
    },
    {
      id: 'thread-2',
      subject: 'Product return request',
      from: 'buyer@example.com',
      date: new Date(),
    },
    {
      id: 'thread-3',
      subject: 'Urgent: Payment issue',
      from: 'user@example.com',
      date: new Date(),
    },
  ]

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search threads..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <ScrollArea className="h-[200px] border rounded-md p-2">
        <div className="space-y-2">
          {mockThreads.map((thread) => (
            <Button
              key={thread.id}
              variant="ghost"
              className="w-full justify-start text-left"
              onClick={() => onSelect(thread.id)}>
              <div className="flex-1 overflow-hidden">
                <p className="font-medium truncate">{thread.subject}</p>
                <p className="text-sm text-muted-foreground truncate">{thread.from}</p>
              </div>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
