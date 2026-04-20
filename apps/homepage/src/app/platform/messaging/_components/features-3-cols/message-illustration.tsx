// apps/web/src/app/(website)/_components/features-3-cols/message-illustration.tsx

import Image from 'next/image'
import { avatars } from '@/app/_components/avatars'

// MessageIllustration renders the messaging avatar bubble used in the feature card.
export const MessageIllustration = () => (
  <div aria-hidden>
    <div className='flex items-center gap-2'>
      <Image
        src={avatars.karo}
        className='size-4 rounded-full'
        alt='Karo'
        width='460'
        height='460'
        loading='lazy'
      />
      <span className='text-sm'>Karo T.</span>
    </div>

    <div className='ring-border-illustration/10 bg-illustration/50 mt-2 w-fit rounded-2xl rounded-tl p-3 text-sm shadow ring-1'>
      Hey <span className='text-info'>James</span>, I've credited your account. You should see it in
      your account within the next 1-2 days.
    </div>
  </div>
)
