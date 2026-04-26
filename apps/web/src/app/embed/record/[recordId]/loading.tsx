// apps/web/src/app/embed/record/[recordId]/loading.tsx

import Loader from '@auxx/ui/components/loader'

/**
 * Next.js Suspense boundary for the embed route. Renders while
 * `page.tsx` awaits the auth + dehydration round-trips on the server.
 * Centered Loader matches the extension's iframe-side loading state so
 * the user sees one continuous spinner instead of a flash of plain text.
 */
export default function EmbedLoading() {
  return (
    <div className='h-screen bg-background'>
      <Loader size='sm' title='Loading' subtitle='' className='h-full' />
    </div>
  )
}
