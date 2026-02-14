// apps/web/src/app/(website)/_components/features-3-cols/poll-illustration.tsx

import Image from 'next/image'
import { avatars } from '~/app/_components/avatars'

// PollIllustration renders the polling timeline graphic used in the feature card.
export const PollIllustration = () => {
  return (
    <div aria-hidden className='relative w-full select-none'>
      <div className='relative w-full space-y-2 py-4'>
        <div className='absolute inset-y-0 left-0 w-px bg-[length:1px_4px] bg-repeat-y opacity-25 [background-image:linear-gradient(180deg,var(--color-foreground)_1px,transparent_1px)]'></div>

        <div className='pl-5'>
          <div className='text-foreground before:border-muted-foreground before:bg-background before:ring-background relative mt-0.5 inline-flex items-center gap-2 text-sm font-medium before:absolute before:inset-y-0 before:-left-[22px] before:my-auto before:size-[5px] before:rounded-full before:border before:ring'>
            <div className='text-muted-foreground text-xs'>06 AM</div>
            Shipping delay message
          </div>
        </div>
        <div className='bg-illustration ring-border-illustration relative -mx-5 flex rounded-xl p-2 text-xs shadow shadow-black/10 ring-1'>
          <div className='before:border-primary before:bg-background before:ring-background relative ml-7 mt-0.5 inline-flex items-center gap-2 text-sm font-medium before:absolute before:inset-y-0 before:-left-[19px] before:my-auto before:size-[5px] before:rounded-full before:border before:ring'>
            <div className='flex items-center -space-x-2'>
              {[
                {
                  src: avatars.charles,
                  alt: 'Charles Seed',
                },
              ].map((avatar, index) => (
                <div
                  key={index}
                  className='bg-background size-6 rounded-full border p-0.5 shadow shadow-zinc-950/5 *:rounded-full'>
                  <Image
                    src={avatar.src}
                    className='aspect-square rounded-[calc(var(--avatar-radius)-2px)] object-cover'
                    alt={avatar.alt}
                    width='460'
                    height='460'
                    loading='lazy'
                    decoding='async'
                  />
                </div>
              ))}
            </div>
            Approve refund for <b>red t-shirt</b>
          </div>
        </div>
        <div className='pl-5'>
          <div className='text-foreground before:border-muted-foreground before:bg-background before:ring-background relative mt-0.5 inline-flex items-center gap-2 text-sm font-medium before:absolute before:inset-y-0 before:-left-[22px] before:my-auto before:size-[5px] before:rounded-full before:border before:ring'>
            <div className='text-muted-foreground text-xs'>01 PM</div>
            Product question
          </div>
        </div>
      </div>
    </div>
  )
}
