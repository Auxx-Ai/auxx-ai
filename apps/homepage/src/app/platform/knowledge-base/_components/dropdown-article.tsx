import { Archive, BookCheck, BookOpen, Edit, FileText, Settings2, Tag } from 'lucide-react'

type Article = {
  id: number
  title: string
  status: 'published' | 'draft' | 'archived'
  category: string
}

const ARTICLES: Article[] = [
  { id: 1, title: 'Getting Started Guide', status: 'published', category: 'Setup' },
  { id: 2, title: 'API Integration Tutorial', status: 'published', category: 'Development' },
  { id: 3, title: 'Troubleshooting Common Issues', status: 'draft', category: 'Support' },
  { id: 4, title: 'Advanced Configuration', status: 'draft', category: 'Setup' },
]

export const DropdownArticle = () => {
  return (
    <div className='relative overflow-hidden rounded-2xl bg-black p-2'>
      <div className='mask-r-from-50% absolute inset-0 items-center [background:radial-gradient(150%_115%_at_50%_5%,transparent_25%,var(--color-emerald-500)_60%,var(--color-white)_100%)]'></div>
      <div className='mask-l-from-35% absolute inset-0 items-center [background:radial-gradient(150%_115%_at_50%_5%,transparent_25%,var(--color-sky-500)_60%,var(--color-white)_100%)]'></div>

      <div className='relative overflow-hidden rounded-xl border border-dashed border-white/25 bg-white/10 pt-8 shadow-lg shadow-black/20'>
        <div className='absolute inset-0 bg-[radial-gradient(var(--color-white)_1px,transparent_1px)] opacity-5 [background-size:12px_12px]'></div>
        <div className='absolute inset-0 translate-y-1/2 rounded-full border border-dotted bg-white/15'></div>

        <div className='flex items-center justify-center'>
          <div className='mask-b-from-55% -mx-4 -mt-4 p-4 pb-0'>
            <div className='bg-card border-foreground/10 relative w-64 overflow-hidden rounded-t-2xl border p-1 shadow-lg shadow-black/10 *:cursor-pointer *:rounded-xl'>
              {ARTICLES.map((article) => (
                <div
                  key={article.id}
                  className='hover:bg-muted flex items-center gap-2 px-2 py-1.5'>
                  <div
                    className={`size-2 rounded-full ${article.status === 'published' ? 'bg-green-500' : article.status === 'draft' ? 'bg-yellow-500' : 'bg-gray-500'}`}
                  />
                  <FileText className='size-4 text-muted-foreground' />
                  <div className='flex-1 min-w-0'>
                    <span className='text-foreground text-sm block truncate'>{article.title}</span>
                    <span className='text-xs text-muted-foreground'>{article.category}</span>
                  </div>
                </div>
              ))}

              <div className='hover:bg-muted flex h-7 items-center gap-2 px-2'>
                <Edit className='size-4' />
                <span className='text-sm'>Create new article</span>
              </div>
              <hr className='mx-2 my-1' />
              <div className='hover:bg-muted flex h-7 items-center gap-2 px-2'>
                <BookCheck className='size-4' />
                <span className='text-sm'>Publish articles</span>
              </div>
              <hr className='mx-2 my-1' />
              <div className='hover:bg-muted flex h-7 items-center gap-2 px-2'>
                <Tag className='size-4' />
                <span className='text-sm'>Manage categories</span>
              </div>
              <div className='hover:bg-muted flex h-7 items-center gap-2 px-2'>
                <BookOpen className='size-4' />
                <span className='text-sm'>View knowledge base</span>
              </div>
              <hr className='mx-2 my-1' />
              <div className='hover:bg-muted flex h-7 items-center gap-2 px-2'>
                <Archive className='size-4' />
                <span className='text-sm'>Archive articles</span>
              </div>
              <div className='hover:bg-muted flex h-7 items-center gap-2 px-2'>
                <Settings2 className='size-4' />
                <span className='text-sm'>KB Settings</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
