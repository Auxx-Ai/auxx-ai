// apps/web/src/app/(website)/platform/integration/_components/integrations-illustration.tsx
import {
  ClaudeAI,
  Cloudflare,
  Facebook,
  Gemini,
  Gmail,
  Instagram,
  Linear,
  MediaWiki,
  OpenAI,
  Outlook,
  Replit,
  Shopify,
  Vercel,
  VSCodium,
} from '~/components/logos'

export const IntegrationsIllustration = () => {
  return (
    <div>
      <div className='relative mx-auto max-w-sm'>
        <div className='w-1/7 border-foreground/10 absolute -bottom-64 -top-16 left-0 border-l border-dashed'></div>
        <div className='w-1/7 left-1/7 border-foreground/10 -top-13 absolute -bottom-56 border-l border-dashed'></div>
        <div className='w-1/7 left-2/7 border-foreground/10 absolute -bottom-52 -top-9 border-l border-dashed'></div>
        <div className='w-1/7 left-3/7 border-foreground/10 absolute -bottom-48 -top-6 border-x border-dashed'></div>
        <div className='w-1/7 left-5/7 border-foreground/10 absolute -bottom-52 -top-9 border-x border-dashed'></div>
        <div className='w-1/7 left-6/7 border-foreground/10 -top-13 absolute -bottom-64 border-r border-dashed'></div>
      </div>
      <div className='lg:before:mask-x-from-85% before:border-foreground/10 relative mx-auto max-w-xl before:absolute before:inset-0 before:border-t before:border-dashed'>
        <div className='*:bg-card *:ring-border-illustration mx-auto grid max-w-sm grid-cols-7 *:relative *:flex *:aspect-square *:items-center *:justify-center *:rounded-lg *:shadow-md *:ring-1'>
          <div className='col-start-4'>
            <Shopify className='size-5' />
          </div>
          <div className='col-start-6'>
            <Gemini className='size-5' />
          </div>
        </div>
      </div>
      <div className='lg:before:mask-x-from-85% before:border-foreground/10 relative before:absolute before:inset-0 before:border-y before:border-dashed'>
        <div className='mx-auto grid max-w-sm grid-cols-7 *:relative *:flex *:aspect-square *:items-center *:justify-center'>
          <div className='border-border-illustration bg-foreground/3 -mr-px border'>
            <Gmail className='size-5' />
          </div>
          <div className='border-border-illustration bg-foreground/3 col-start-3 -mr-px border'>
            <Outlook className=' size-5' />
          </div>
          <div className='bg-card ring-border-illustration col-start-5 rounded-lg shadow-md ring-1'>
            <Facebook className='size-5' />
          </div>
          <div className='border-border-illustration bg-foreground/3 col-start-7 -mb-px -ml-px border'>
            <Instagram className='*:fill-foreground size-5' />
          </div>
        </div>
      </div>
      <div className='lg:before:mask-x-from-85% before:border-foreground/10 relative mx-auto max-w-2xl before:absolute before:inset-0 before:border-b before:border-dashed'>
        <div className='mx-auto grid max-w-sm grid-cols-7 *:relative *:flex *:aspect-square *:items-center *:justify-center'>
          <div className='border-border-illustration bg-foreground/3 col-start-2 -mr-px -mt-px border'>
            <OpenAI className='size-5' />
          </div>
          <div className='bg-card ring-border-illustration col-start-6 rounded-lg shadow-md ring-1'>
            <ClaudeAI className='size-5' />
          </div>
        </div>
      </div>
    </div>
  )
}
