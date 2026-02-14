// apps/homepage/src/app/platform/live-chat/_components/live-chat-center-section.tsx
import Image from 'next/image'

/**
 * LiveChatCenterSection component displays the live chat widget interface
 * with description of integration and customization capabilities
 */
export default function LiveChatCenterSection() {
  return (
    <section className='relative bg-background border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='bg-muted/25 py-16 md:py-24'>
            <div className='mx-auto max-w-4xl space-y-12 px-6'>
              <h2 className='text-muted-foreground text-balance text-4xl font-semibold md:w-2/3'>
                Add live chat to{' '}
                <strong className='text-foreground font-semibold'>any website in seconds</strong>
              </h2>
              <div className='bg-background ring-foreground/5 overflow-hidden rounded-xl border border-transparent shadow ring-1'>
                <Image
                  src='/images/platform/live-chat/chat-widget.png'
                  width={3070}
                  height={1994}
                  alt='Live chat widget embedded on a website with customization options'
                  className='h-full w-full object-cover'
                />
              </div>
              <div className='grid gap-6 md:grid-cols-2 md:gap-12'>
                <p className='text-muted-foreground'>
                  Embed a{' '}
                  <strong className='text-foreground font-semibold'>
                    fully customizable chat widget
                  </strong>{' '}
                  on your website with a single line of code. Match your brand with custom colors,
                  positioning, and greetings—no developer required.
                </p>

                <p className='text-muted-foreground'>
                  Chat conversations{' '}
                  <strong className='text-foreground font-semibold'>
                    automatically become tickets
                  </strong>{' '}
                  in your inbox. Let AI handle common questions 24/7, then seamlessly hand off to
                  human agents when needed—all in the same conversation thread.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
