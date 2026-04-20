'use client'

import { CheckCircle2 } from 'lucide-react'
// import { CodeBlockIllustration } from '@/components/code-block-illustration'
import { LogoIcon } from '~/components/logo'

export const ImageIllustration = () => {
  return (
    <>
      <div className='max-lg:hidden'>
        <style jsx>{`
          @keyframes beam-move {
            to {
              stroke-dashoffset: -780;
            }
          }

          @keyframes beam-move-down {
            to {
              stroke-dashoffset: 780;
            }
          }
        `}</style>
        <div className='relative [--color-border-illustration:--alpha(var(--color-zinc-950)/12.5%)] [--color-border:--alpha(var(--color-zinc-950)/10%)] dark:[--color-border-illustration:--alpha(var(--color-white)/12.5%)] dark:[--color-border:--alpha(var(--color-white)/10%)]'>
          <div className='mask-t-from-65% mask-t-to-85% mask-b-from-40% mask-b-to-90% absolute inset-0'></div>
          <div className='border-b py-20'>
            <div className='relative mx-auto grid aspect-video max-w-6xl grid-cols-3 overflow-hidden rounded-2xl lg:px-12'>
              <div className='grid grid-cols-2 pr-6'>
                <div className='grid h-full grid-rows-3 border-r'>
                  <div className='flex flex-col justify-end p-6'>
                    <div className='**:rounded-full flex w-full flex-wrap justify-end gap-1 rounded border p-4'>
                      <div className='space-y-1'>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full rounded-full border'></div>
                        </div>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full rounded-full border'></div>
                        </div>
                      </div>
                      <div className='space-y-1'>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full rounded-full border'></div>
                        </div>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full rounded-full border'></div>
                        </div>
                      </div>
                      <div className='space-y-1'>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full rounded-full border'></div>
                        </div>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full rounded-full border'></div>
                        </div>
                      </div>

                      <span className='w-full pt-6 font-mono text-[10px] uppercase'>
                        Replies drafted in seconds.
                      </span>
                    </div>
                  </div>
                  <div className='grid grid-cols-2 grid-rows-2 gap-2 rounded-l-2xl border-y border-l p-2'>
                    <div className='bg-linear-to-b to-card/75 ring-border size-full rounded rounded-l-lg ring-1'></div>
                    <div className='bg-linear-to-b to-card/75 ring-border size-full rounded rounded-r-lg ring-1'></div>
                    <div className='bg-linear-to-b to-card/75 ring-border size-full rounded rounded-l-lg ring-1'></div>
                    <div className='bg-linear-to-b to-card/75 ring-border size-full rounded rounded-r-lg ring-1'></div>
                  </div>
                  <div className='m-2 bg-[repeating-linear-gradient(45deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_6px)]'></div>
                </div>
                <div className='grid h-full grid-rows-3 border-r border-dashed p-6'>
                  <div>
                    <div aria-hidden className='scale-85 flex w-28 flex-wrap gap-2.5 opacity-75'>
                      {Array.from({ length: 10 }).map((_, index) => (
                        <div key={index} aria-hidden className='h-5 w-2.5 max-sm:last:hidden'>
                          <div className='bg-card rounded-t-xs ring-foreground/5 h-1.5 shadow ring-1' />
                          <div className='bg-foreground/5 border-foreground/10 relative mx-auto h-2 w-2 border-x' />
                          <div className='bg-card rounded-b-xs ring-foreground/5 h-1.5 shadow ring-1' />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className='mr-auto p-6'>
                    <div className='flex gap-1'>
                      <div className='size-7 border p-1'>
                        <div className='bg-card ring-border size-full ring-1'></div>
                      </div>
                      <div className='space-y-1'>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-card ring-border size-full ring-1'></div>
                        </div>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-card ring-border size-full ring-1'></div>
                        </div>
                      </div>
                    </div>

                    <div className='space-y-2 py-2'>
                      <div className='h-1 w-12 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_3px)]' />
                      <div className='flex justify-between gap-4'>
                        <div className='h-1.5 w-6 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_3px)]' />
                        <div className='h-1.5 w-10 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_3px)]' />
                      </div>
                    </div>

                    <div className='flex justify-between gap-1'>
                      <div className='space-y-1'>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full border'></div>
                        </div>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full border'></div>
                        </div>
                      </div>
                      <div className='space-y-1'>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full border'></div>
                        </div>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full border'></div>
                        </div>
                      </div>
                      <div className='space-y-1'>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full border'></div>
                        </div>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full border'></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className='flex flex-col justify-center'>
                    <div className='space-y-2 py-2'>
                      <div className='w-30 h-2 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1.5px,transparent_1.5px,transparent_4px)]' />
                      <div className='w-18 h-2 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1.5px,transparent_1.5px,transparent_4px)]' />
                    </div>
                    <div className='flex pr-2'>
                      <div
                        aria-hidden
                        className='scale-85 flex w-16 flex-wrap justify-center gap-2.5 opacity-75'>
                        {Array.from({ length: 5 }).map((_, index) => (
                          <div key={index} aria-hidden className='h-5 w-2.5 max-sm:last:hidden'>
                            <div className='bg-card rounded-t-xs ring-foreground/5 h-1.5 shadow ring-1' />
                            <div className='bg-foreground/5 border-foreground/10 relative mx-auto h-2 w-2 border-x' />
                            <div className='bg-card rounded-b-xs ring-foreground/5 h-1.5 shadow ring-1' />
                          </div>
                        ))}
                      </div>
                      <div className='mask-b-from-75% -mt-4 ml-auto h-20 w-6 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_3px)]' />
                    </div>
                  </div>
                </div>
              </div>
              <div className='flex flex-col justify-center'>
                <div className='flex items-center justify-center'>
                  <div aria-hidden className='flex items-center gap-3 max-sm:hidden'>
                    <div className='bg-border-illustration h-px w-6' />

                    <div className='ml-auto h-4 w-6 bg-[repeating-linear-gradient(45deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_6px)]' />
                    <div className='ring-border-illustration bg-card size-2 rotate-45 ring-1' />
                  </div>
                  <div className='mx-auto hidden w-fit scale-75 rounded-xl border p-1'>
                    <div className='bg-background ring-foreground/5 grid grid-rows-[auto_1fr_auto] rounded-lg p-2 shadow-md ring-1'>
                      <div className='grid grid-cols-[auto_1fr_auto] items-center gap-1'>
                        <div className='flex size-2'>
                          <div className='bg-foreground m-auto size-0.5 rounded-full'></div>
                        </div>
                        <div className='h-2 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_2px,transparent_2px,transparent_6px)]'></div>
                        <div className='flex size-2'>
                          <div className='bg-foreground m-auto size-0.5 rounded-full'></div>
                        </div>
                      </div>
                      <div className='grid grid-cols-[auto_1fr_auto]'>
                        <div className='w-2 bg-[repeating-linear-gradient(var(--color-border-illustration),var(--color-border-illustration)_2px,transparent_2px,transparent_6px)]'></div>
                        <div className='p-2'>
                          <div className='bg-muted size-16 rounded-2xl border p-1'>
                            <div className='ring-foreground/10 inset-shadow-sm inset-shadow-white dark:inset-shadow-white/5 bg-linear-to-b flex size-full rounded-[12px] from-emerald-50 to-indigo-200 dark:from-emerald-500/15 dark:to-indigo-500/25 shadow-xl shadow-indigo-600/35 ring-1'>
                              <LogoIcon
                                className='m-auto size-5 opacity-75 drop-shadow-md'
                                uniColor
                              />
                            </div>
                          </div>
                        </div>
                        <div className='w-2 bg-[repeating-linear-gradient(var(--color-border-illustration),var(--color-border-illustration)_2px,transparent_2px,transparent_6px)]'></div>
                      </div>
                      <div className='grid grid-cols-[auto_1fr_auto] items-center gap-1'>
                        <div className='flex size-2'>
                          <div className='bg-foreground m-auto size-0.5 rounded-full'></div>
                        </div>
                        <div className='h-2 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_2px,transparent_2px,transparent_6px)]'></div>
                        <div className='flex size-2'>
                          <div className='bg-foreground m-auto size-0.5 rounded-full'></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className='mx-auto w-fit rounded-xl border p-1'>
                    <div className='bg-background ring-foreground/5 grid grid-rows-[auto_1fr_auto] rounded-lg p-1 shadow-md ring-1'>
                      <div className='grid grid-cols-[auto_1fr_auto] items-center gap-1'>
                        <div className='flex size-2'>
                          <div className='bg-foreground size-0.75 m-auto rounded-full'></div>
                        </div>
                        <div className='h-1 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_2px,transparent_2px,transparent_6px)]'></div>
                        <div className='flex size-2'>
                          <div className='bg-foreground size-0.75 m-auto rounded-full'></div>
                        </div>
                      </div>
                      <div className='flex items-center justify-center px-2 py-1'>
                        <span className='font-mono text-xs'>API</span>
                      </div>
                      <div className='grid grid-cols-[auto_1fr_auto] items-center gap-1'>
                        <div className='flex size-2'>
                          <div className='bg-foreground size-0.75 m-auto rounded-full'></div>
                        </div>
                        <div className='h-1 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_2px,transparent_2px,transparent_6px)]'></div>
                        <div className='flex size-2'>
                          <div className='bg-foreground size-0.75 m-auto rounded-full'></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div aria-hidden className='flex items-center gap-3 max-sm:hidden'>
                    <div className='ring-border-illustration bg-card size-2 rotate-45 ring-1' />
                    <div className='ml-auto h-4 w-6 bg-[repeating-linear-gradient(0deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_6px)]' />
                    <div className='bg-border-illustration h-px w-6' />
                  </div>
                </div>
                <div className='relative mx-auto flex w-14 justify-center'>
                  <svg
                    width='48'
                    height='84'
                    viewBox='0 0 48 84'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                    className='absolute inset-0 mx-auto w-fit'>
                    <path
                      d='M12 0L12 61.395C12 62.4251 11.6026 63.4155 10.8906 64.1599L2.10943 73.3401C1.3974 74.0845 0.999999 75.0749 0.999999 76.105L0.999998 84'
                      stroke='var(--color-foreground)'
                      className='drop-shadow-emerald-100 drop-shadow-xs [animation:beam-move_4.4s_linear_infinite]'
                      strokeLinecap='round'
                      strokeDasharray='42 278'
                    />
                    <path
                      d='M24 0L24 63L24 74.5L24 84'
                      stroke='var(--color-foreground)'
                      className='drop-shadow-blue-100 drop-shadow-xs delay-[1s] [animation:beam-move_5.4s_linear_infinite]'
                      strokeLinecap='round'
                      strokeDasharray='42 278'
                    />
                    <path
                      d='M47.0078 84L47.0078 52.3045C47.0078 51.2414 46.5846 50.222 45.8316 49.4714L37.1771 40.8452C36.4241 40.0947 36.0009 39.0753 36.0009 38.0121L36.0009 2.07412e-06'
                      stroke='var(--color-foreground)'
                      className='drop-shadow-purple-300 drop-shadow-xs delay-[2s] [animation:beam-move_5.4s_linear_infinite]'
                      strokeLinecap='round'
                      strokeDasharray='42 278'
                    />
                  </svg>

                  <svg
                    width='48'
                    height='84'
                    viewBox='0 0 48 84'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'>
                    <path
                      d='M12 0L12 61.395C12 62.4251 11.6026 63.4155 10.8906 64.1599L2.10943 73.3401C1.3974 74.0845 0.999999 75.0749 0.999999 76.105L0.999998 84'
                      stroke='var(--border-illustration)'
                    />
                    <path d='M24 0L24 63L24 74.5L24 84' stroke='var(--border-illustration)' />
                    <path
                      d='M47.0078 84L47.0078 52.3045C47.0078 51.2414 46.5846 50.222 45.8316 49.4714L37.1771 40.8452C36.4241 40.0947 36.0009 39.0753 36.0009 38.0121L36.0009 2.07412e-06'
                      stroke='var(--border-illustration)'
                    />
                  </svg>
                </div>

                <Card />

                <div className='relative mx-auto flex w-14 justify-center'>
                  <svg
                    width='48'
                    height='84'
                    viewBox='0 0 48 84'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                    className='absolute inset-0 mx-auto w-fit'>
                    <path
                      d='M12 84L12 22.605C12 21.5749 11.6026 20.5845 10.8906 19.8401L2.10943 10.6599C1.3974 9.91547 0.999999 8.92507 0.999999 7.89497L0.999998 4.80825e-07'
                      stroke='var(--color-foreground)'
                      strokeLinecap='round'
                      strokeDasharray='42 278'
                      className='drop-shadow-emerald-100 drop-shadow-sm delay-[1s] [animation:beam-move-down_4.4s_linear_infinite]'
                    />
                    <path
                      d='M24 84L24 21L24 9.5L24 0'
                      stroke='var(--color-foreground)'
                      strokeLinecap='round'
                      strokeDasharray='42 278'
                      className='drop-shadow-blue-100 drop-shadow-sm delay-[0.5s] [animation:beam-move-down_5.4s_linear_infinite]'
                    />
                    <path
                      d='M47.0078 0L47.0078 31.6955C47.0078 32.7586 46.5846 33.778 45.8316 34.5286L37.1771 43.1548C36.4241 43.9053 36.0009 44.9247 36.0009 45.9879L36.0009 84'
                      stroke='var(--color-foreground)'
                      strokeLinecap='round'
                      strokeDasharray='42 278'
                      className='drop-shadow-purple-300 drop-shadow-sm delay-[2s] [animation:beam-move-down_5.4s_linear_infinite]'
                    />
                  </svg>
                  <svg
                    width='48'
                    height='84'
                    viewBox='0 0 48 84'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'>
                    <path
                      d='M12 84L12 22.605C12 21.5749 11.6026 20.5845 10.8906 19.8401L2.10943 10.6599C1.3974 9.91547 0.999999 8.92507 0.999999 7.89497L0.999998 4.80825e-07'
                      stroke='var(--border-illustration)'
                    />
                    <path d='M24 84L24 21L24 9.5L24 0' stroke='var(--border-illustration)' />
                    <path
                      d='M47.0078 0L47.0078 31.6955C47.0078 32.7586 46.5846 33.778 45.8316 34.5286L37.1771 43.1548C36.4241 43.9053 36.0009 44.9247 36.0009 45.9879L36.0009 84'
                      stroke='var(--border-illustration)'
                    />
                  </svg>
                </div>
                <div className='relative flex items-center justify-center'>
                  <div className='z-1 relative mx-auto w-fit rounded-xl border p-1'>
                    <div className='bg-background ring-foreground/5 grid grid-rows-[auto_1fr_auto] rounded-lg p-1 shadow-md ring-1'>
                      <div className='grid grid-cols-[auto_1fr_auto] items-center gap-1'>
                        <div className='flex size-2'>
                          <div className='bg-foreground size-0.75 m-auto rounded-full'></div>
                        </div>
                        <div className='h-1 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_2px,transparent_2px,transparent_6px)]'></div>
                        <div className='flex size-2'>
                          <div className='bg-foreground size-0.75 m-auto rounded-full'></div>
                        </div>
                      </div>
                      <div className='flex items-center justify-center px-2'>
                        <span className='flex items-center gap-2 font-mono text-xs'>
                          <CheckCircle2 className='size-3 stroke-emerald-800 dark:stroke-emerald-400 *:first:fill-emerald-500/35' />
                          <span>APP Connected</span>
                        </span>
                      </div>
                      <div className='grid grid-cols-[auto_1fr_auto] items-center gap-1'>
                        <div className='flex size-2'>
                          <div className='bg-foreground size-0.75 m-auto rounded-full'></div>
                        </div>
                        <div className='h-1 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_2px,transparent_2px,transparent_6px)]'></div>
                        <div className='flex size-2'>
                          <div className='bg-foreground size-0.75 m-auto rounded-full'></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className='absolute inset-y-0 -right-4 my-auto translate-x-px translate-y-2'>
                    <svg
                      width='120'
                      height='18'
                      viewBox='0 0 120 18'
                      fill='none'
                      xmlns='http://www.w3.org/2000/svg'
                      className='mt-4'>
                      <path
                        d='M0 1L45.9706 1C47.0458 1 48.0757 1.43285 48.8281 2.20094L62.1482 15.7991C62.9005 16.5671 63.9305 17 65.0057 17L120 17'
                        stroke='var(--border-illustration)'
                      />
                    </svg>
                    <svg
                      width='120'
                      height='18'
                      viewBox='0 0 120 18'
                      fill='none'
                      xmlns='http://www.w3.org/2000/svg'
                      className='absolute inset-0 mt-4'>
                      <path
                        d='M0 1L45.9706 1C47.0458 1 48.0757 1.43285 48.8281 2.20094L62.1482 15.7991C62.9005 16.5671 63.9305 17 65.0057 17L120 17'
                        stroke='var(--color-foreground)'
                        strokeLinecap='round'
                        strokeDasharray='42 278'
                        className='drop-shadow-green-300 drop-shadow-sm delay-[2s] [animation:beam-move_5.4s_linear_infinite]'
                      />
                    </svg>
                  </div>
                </div>
              </div>
              <div className='grid grid-rows-[1fr_auto]'>
                <div className='grid grid-cols-2 pl-6'>
                  <div className='flex h-full flex-col items-center justify-between border-l border-dashed p-4'>
                    <div className='flex flex-col justify-center'>
                      <div className='space-y-2 py-2'>
                        <div className='h-2 w-32 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_2px)]' />
                        <div className='h-2 w-20 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_2px)]' />
                      </div>
                      <div className='flex'>
                        <div
                          aria-hidden
                          className='scale-85 flex w-16 flex-wrap justify-end gap-2.5 opacity-75'>
                          {Array.from({ length: 5 }).map((_, index) => (
                            <div key={index} aria-hidden className='h-5 w-2.5 max-sm:last:hidden'>
                              <div className='bg-card rounded-t-xs ring-foreground/5 h-1.5 shadow ring-1' />
                              <div className='bg-foreground/5 border-foreground/10 relative mx-auto h-2 w-2 border-x' />
                              <div className='bg-card rounded-b-xs ring-foreground/5 h-1.5 shadow ring-1' />
                            </div>
                          ))}
                        </div>
                        <div className='mask-b-from-75% -mt-4 ml-auto h-20 w-6 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_3px)]' />
                      </div>
                    </div>
                    <div className='**:rounded-full flex w-full flex-wrap justify-end gap-1 rounded border p-4'>
                      <div className='space-y-1'>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full rounded-full border'></div>
                        </div>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full rounded-full border'></div>
                        </div>
                      </div>
                      <div className='space-y-1'>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full rounded-full border'></div>
                        </div>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full rounded-full border'></div>
                        </div>
                      </div>
                      <div className='space-y-1'>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full rounded-full border'></div>
                        </div>
                        <div className='size-3 border p-0.5'>
                          <div className='bg-linear-to-b to-card/50 size-full rounded-full border'></div>
                        </div>
                      </div>

                      <span className='w-full pt-6 font-mono text-[10px] uppercase'>
                        Replies drafted in seconds.
                      </span>
                    </div>

                    <div>
                      <div
                        aria-hidden
                        className='scale-85 flex w-28 flex-wrap justify-end gap-2.5 opacity-75'>
                        {Array.from({ length: 10 }).map((_, index) => (
                          <div key={index} aria-hidden className='h-5 w-2.5 max-sm:last:hidden'>
                            <div className='bg-card rounded-t-xs ring-foreground/5 h-1.5 shadow ring-1' />
                            <div className='bg-foreground/5 border-foreground/10 relative mx-auto h-2 w-2 border-x' />
                            <div className='bg-card rounded-b-xs ring-foreground/5 h-1.5 shadow ring-1' />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className='relative grid h-full grid-rows-2 border-l'>
                    <div className='m-2 bg-[repeating-linear-gradient(45deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_6px)]'></div>

                    <div className='-mb-2 flex flex-col justify-center rounded-r-xl border-y border-r p-6'>
                      <div className='space-y-2 py-2'>
                        <div className='h-2 w-32 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_2px)]' />
                        <div className='h-2 w-20 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_2px)]' />
                      </div>
                      <div className='flex'>
                        <div
                          aria-hidden
                          className='scale-85 flex w-16 flex-wrap justify-end gap-2.5 opacity-75'>
                          {Array.from({ length: 5 }).map((_, index) => (
                            <div key={index} aria-hidden className='h-5 w-2.5 max-sm:last:hidden'>
                              <div className='bg-card rounded-t-xs ring-foreground/5 h-1.5 shadow ring-1' />
                              <div className='bg-foreground/5 border-foreground/10 relative mx-auto h-2 w-2 border-x' />
                              <div className='bg-card rounded-b-xs ring-foreground/5 h-1.5 shadow ring-1' />
                            </div>
                          ))}
                        </div>
                        <div className='mask-b-from-75% -mt-4 ml-auto h-20 w-6 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1px,transparent_1px,transparent_3px)]' />
                      </div>
                    </div>
                  </div>
                </div>
                <div className='relative pb-2 pr-2'>
                  <div className='bg-card/75 ring-border relative flex h-40 flex-col overflow-hidden rounded-xl shadow-lg ring-1 backdrop-blur'>
                    <div className='flex items-center gap-2 border-b px-4 py-2'>
                      <div className='bg-linear-to-b ring-foreground/10 flex size-5 items-center justify-center rounded from-emerald-50 to-indigo-200 shadow-sm ring-1 dark:from-emerald-500/15 dark:to-indigo-500/25'>
                        <LogoIcon className='size-3' uniColor />
                      </div>
                      <span className='font-mono text-[10px] uppercase tracking-wide'>
                        Reply drafted
                      </span>
                      <span className='ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground'>
                        <span className='size-1 rounded-full bg-emerald-500' />
                        Ready to send
                      </span>
                    </div>
                    <div className='flex flex-1 flex-col justify-between p-4'>
                      <div className='space-y-1.5'>
                        <div className='h-1.5 w-40 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1.5px,transparent_1.5px,transparent_4px)]' />
                        <div className='h-1.5 w-48 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1.5px,transparent_1.5px,transparent_4px)]' />
                        <div className='h-1.5 w-32 bg-[repeating-linear-gradient(90deg,var(--color-border-illustration),var(--color-border-illustration)_1.5px,transparent_1.5px,transparent_4px)]' />
                      </div>
                      <div className='flex items-center gap-1.5'>
                        <span className='rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400'>
                          Shipping
                        </span>
                        <span className='text-muted-foreground rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide'>
                          KB · Order tracking
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className='px-6 pb-8 pt-24 lg:hidden'>
        <div className='mx-auto max-w-md'>
          <Card />
        </div>
      </div>
    </>
  )
}

const Card = () => {
  return (
    <div className='ring-foreground/15 bg-background relative z-10 flex aspect-video w-full flex-col gap-4 overflow-hidden rounded-2xl border border-transparent px-6 py-5 shadow-2xl shadow-sky-950/15 ring-1'>
      <div className='flex items-start justify-between'>
        <AuxxBadge />
        <Gmail />
      </div>

      <div className='flex items-start justify-between gap-4'>
        <div className='space-y-0.5 *:block'>
          <span className='text-muted-foreground text-xs'>Sarah Chen · 2m ago</span>
          <span className='text-sm font-medium'>{"Where's my order #1042?"}</span>
        </div>
        <div className='flex shrink-0 items-center gap-1.5'>
          <span className='relative flex size-1.5'>
            <span className='absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-75'></span>
            <span className='relative size-1.5 rounded-full bg-emerald-500'></span>
          </span>
          <span className='font-mono text-xs font-medium'>Resolved · 4s</span>
        </div>
      </div>

      <p className='mask-b-from-30% mask-b-to-100% text-muted-foreground flex-1 overflow-hidden text-xs leading-relaxed font-mono'>
        {
          'Hi team — I placed order #1042 last Tuesday but tracking still shows "label created". Could you take a look? I need it by Saturday for a trade show and I\'m starting to worry it won\'t arrive in time. Happy to provide any extra details you need on my end.'
        }
      </p>
    </div>
  )
}

const AuxxBadge = () => (
  <div className='bg-linear-to-b ring-foreground/10 flex size-7 items-center justify-center rounded-md from-emerald-50 to-indigo-200 shadow-md shadow-indigo-600/35 ring-1 dark:from-emerald-500/15 dark:to-indigo-500/25'>
    <LogoIcon className='size-4 drop-shadow-md' uniColor />
  </div>
)

const Gmail = () => (
  <svg width='36' height='28' viewBox='0 0 48 36' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path fill='#4285F4' d='M4 36h8V18L0 9v23c0 2.2 1.8 4 4 4z' />
    <path fill='#34A853' d='M36 36h8c2.2 0 4-1.8 4-4V9l-12 9z' />
    <path fill='#FBBC04' d='M36 4v14l12-9V6c0-3.7-4.2-5.8-7.2-3.6L36 4z' />
    <path fill='#EA4335' d='M12 18V4l12 9 12-9v14L24 27z' />
    <path fill='#C5221F' d='M0 6v3l12 9V4L7.2.4C4.2-1.8 0 .3 0 6z' />
  </svg>
)
