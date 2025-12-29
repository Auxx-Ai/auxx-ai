import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { baseOptions } from '@/app/layout.config'
import { source } from '@/lib/source'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      sidebar={{
        // banner: <div>Banner</div>,
        // footer: <div>Lalal</div>,
        tabs: [
          {
            title: 'Getting started',
            description: 'Hello World!',
            // active for `/docs/components` and sub routes like `/docs/components/button`
            url: '/getting-started',
            // optionally, you can specify a set of urls which activates the item
            // urls: new Set(['/docs/test', '/docs/components']),
          },
          {
            title: 'Framework',
            description: 'Hello World!',
            // active for `/docs/components` and sub routes like `/docs/components/button`
            url: '/framework',
            // optionally, you can specify a set of urls which activates the item
            // urls: new Set(['/docs/test', '/docs/components']),
          },
        ],
      }}
      {...baseOptions}>
      {children}
    </DocsLayout>
  )
}
