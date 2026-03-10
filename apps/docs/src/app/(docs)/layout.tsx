import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { BookOpen, Code } from 'lucide-react'
import { baseOptions } from '@/app/layout.config'
import { source } from '@/lib/source'

const tabIcons: Record<string, React.ReactNode> = {
  'Help Center': (
    <BookOpen className='size-5 shrink-0 rounded-md bg-blue-500/10 p-0.5 text-blue-500' />
  ),
  Developers: (
    <Code className='size-5 shrink-0 rounded-md bg-purple-500/10 p-0.5 text-purple-500' />
  ),
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      {...baseOptions}
      sidebar={{
        tabs: {
          transform: (option, node) => ({
            ...option,
            icon: tabIcons[node.name as string] ?? option.icon,
          }),
        },
      }}>
      {children}
    </DocsLayout>
  )
}
