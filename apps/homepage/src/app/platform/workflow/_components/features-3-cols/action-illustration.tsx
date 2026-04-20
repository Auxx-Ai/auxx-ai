// apps/web/src/app/(website)/_components/features-3-cols/triggers-illustration.tsx

import { Link, Mail, Tags, User } from 'lucide-react'

// ActionIllustration renders the messaging avatar bubble used in the feature card.
export const ActionIllustration = () => {
  return (
    <div aria-hidden className='relative w-full select-none'>
      <div className='relative w-full space-y-2 py-4'>
        <div className='absolute inset-y-0 left-0 w-px bg-[length:1px_4px] bg-repeat-y opacity-25 [background-image:linear-gradient(180deg,var(--color-foreground)_1px,transparent_1px)]'></div>

        <div className='pl-4'>
          <div className='text-foreground  relative mt-0.5 inline-flex items-center gap-2 text-sm font-medium '>
            <Tags className='size-4' />
            Text Classifier
          </div>
        </div>
        <div className='pl-4'>
          <div className='text-foreground  relative mt-0.5 inline-flex items-center gap-2 text-sm font-medium '>
            <User className='size-4' />
            Create Contact
          </div>
        </div>
        <div className='pl-4'>
          <div className='text-foreground  relative mt-0.5 inline-flex items-center gap-2 text-sm font-medium '>
            <Link className='size-4' />
            Http Request
          </div>
        </div>
        <div className='bg-illustration/60 ring-border-illustration/20 relative -mx-5 flex rounded-xl p-2 text-xs shadow shadow-black/10 ring-1'>
          <div className='before:border-primary before:bg-background before:ring-background relative ml-7 mt-0.5 inline-flex items-center gap-2 text-sm font-medium before:absolute before:inset-y-0 before:-left-[19px] before:my-auto before:size-[5px] before:rounded-full before:border before:ring'>
            <div className='flex items-center -space-x-2'>
              <Mail className='size-4' />
            </div>
            Send Message
          </div>
        </div>
      </div>
    </div>
  )
}
