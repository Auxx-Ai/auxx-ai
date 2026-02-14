'use client'

import { CheckCircle2 } from 'lucide-react'
// import { CodeBlockIllustration } from '@/components/code-block-illustration'
import Image from 'next/image'
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
        <div className='relative [--color-border-illustration:--alpha(var(--color-zinc-950)/12.5%)] [--color-border:--alpha(var(--color-zinc-950)/10%)]'>
          <div className='mask-t-from-65% mask-t-to-85% absolute inset-0'>
            <img
              src='https://res.cloudinary.com/dohqjvu9k/image/upload/v1757918054/16-bg_kkevzx.webp'
              alt='tailark hero section background'
              className='opacity-7.5 size-full -scale-100 object-bottom'
              loading='lazy'
            />
          </div>
          <div className='border-b'>
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
                        Experience seamless payments.
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
                            <div className='ring-foreground/10 inset-shadow-sm inset-shadow-white bg-linear-to-b flex size-full rounded-[12px] from-emerald-50 to-indigo-200 shadow-xl shadow-indigo-600/35 ring-1'>
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
                      stroke='var(--color-white)'
                      className='drop-shadow-emerald-100 drop-shadow-xs [animation:beam-move_4.4s_linear_infinite]'
                      strokeLinecap='round'
                      strokeDasharray='42 278'
                    />
                    <path
                      d='M24 0L24 63L24 74.5L24 84'
                      stroke='var(--color-white)'
                      className='drop-shadow-blue-100 drop-shadow-xs delay-[1s] [animation:beam-move_5.4s_linear_infinite]'
                      strokeLinecap='round'
                      strokeDasharray='42 278'
                    />
                    <path
                      d='M47.0078 84L47.0078 52.3045C47.0078 51.2414 46.5846 50.222 45.8316 49.4714L37.1771 40.8452C36.4241 40.0947 36.0009 39.0753 36.0009 38.0121L36.0009 2.07412e-06'
                      stroke='var(--color-white)'
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
                      stroke='var(--color-white)'
                      strokeLinecap='round'
                      strokeDasharray='42 278'
                      className='drop-shadow-emerald-100 drop-shadow-sm delay-[1s] [animation:beam-move-down_4.4s_linear_infinite]'
                    />
                    <path
                      d='M24 84L24 21L24 9.5L24 0'
                      stroke='var(--color-white)'
                      strokeLinecap='round'
                      strokeDasharray='42 278'
                      className='drop-shadow-blue-100 drop-shadow-sm delay-[0.5s] [animation:beam-move-down_5.4s_linear_infinite]'
                    />
                    <path
                      d='M47.0078 0L47.0078 31.6955C47.0078 32.7586 46.5846 33.778 45.8316 34.5286L37.1771 43.1548C36.4241 43.9053 36.0009 44.9247 36.0009 45.9879L36.0009 84'
                      stroke='var(--color-white)'
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
                          <CheckCircle2 className='size-3 stroke-emerald-800 *:first:fill-emerald-500/35' />
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
                        stroke='var(--color-white)'
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
                        Experience seamless payments.
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
                  <div className='bg-card/75 ring-border relative h-40 overflow-hidden rounded-xl shadow-lg ring-1 backdrop-blur'>
                    {/* <CodeBlockIllustration /> */}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className='aspect-72/41 lg:hidden'>
        <Image
          src='https://res.cloudinary.com/dohqjvu9k/image/upload/v1757917121/hero-illustration_nl1gdn.png'
          alt='tailark hero section'
          width={2304}
          height={1298}
          className='size-full object-cover'
        />
      </div>
    </>
  )
}

const Card = () => {
  return (
    <div className='ring-foreground/15 bg-background relative z-10 flex aspect-video w-full flex-col justify-between overflow-hidden rounded-2xl border border-transparent px-6 py-5 shadow-2xl shadow-sky-950/15 ring-1'>
      <div className='flex justify-between'>
        <CardChip />
        <Visa />
      </div>

      <div className='flex justify-between'>
        <div className='space-y-0.5 *:block'>
          <span className='text-muted-foreground text-xs'>Markus Klooth</span>
          <span className='font-mono text-sm font-medium'>5367 4567 8901 2345</span>
        </div>
        <div className='space-y-0.5 *:block'>
          <span className='text-muted-foreground text-xs'>Exp.</span>
          <span className='font-mono text-sm font-medium'>12/25</span>
        </div>
      </div>
    </div>
  )
}

const CardChip = () => {
  return (
    <svg width='26' height='22' viewBox='0 0 26 22' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <path
        d='M5.813 0C2.647 0 0 2.648 0 5.813V16.188C0 19.352 2.648 22 5.813 22H20.188C23.352 22 26 19.352 26 16.187V5.813C26 2.649 23.352 0 20.187 0H5.813ZM5.813 2H20.188C22.223 2 24 3.777 24 5.813V7H18C17.445 7 17 6.555 17 6C17 5.445 17.445 5 18 5C18.2652 5 18.5196 4.89464 18.7071 4.70711C18.8946 4.51957 19 4.26522 19 4C19 3.73478 18.8946 3.48043 18.7071 3.29289C18.5196 3.10536 18.2652 3 18 3C16.355 3 15 4.355 15 6C15 7.292 15.844 8.394 17 8.813V13.781C15.802 14.595 15 15.961 15 17.5C15 18.423 15.293 19.281 15.781 20H10.22C10.7254 19.264 10.9973 18.3928 11 17.5C11 15.962 10.198 14.595 9 13.781V8.812C10.156 8.394 11 7.292 11 6C11 4.355 9.645 3 8 3H6C5.96868 2.99853 5.93732 2.99853 5.906 3C5.87502 2.99856 5.84398 2.99856 5.813 3C5.54778 3.0248 5.30328 3.15394 5.13328 3.35901C4.96328 3.56408 4.8817 3.82828 4.9065 4.0935C4.9313 4.35872 5.06044 4.60322 5.26551 4.77322C5.47058 4.94322 5.73478 5.0248 6 5H8C8.555 5 9 5.445 9 6C9 6.555 8.555 7 8 7H2V5.812C2 3.777 3.777 2 5.813 2ZM2 9H7V13H2V9ZM19 9H24V13H19V9ZM2 15H6.5C7.839 15 9 16.161 9 17.5C9 18.839 7.839 20 6.5 20H5.812C3.777 20 2 18.223 2 16.187V15ZM19.5 15H24V16.188C24 18.223 22.223 20 20.187 20H19.5C18.161 20 17 18.839 17 17.5C17 16.161 18.161 15 19.5 15Z'
        fill='currentColor'
      />
    </svg>
  )
}

const Visa = () => (
  <svg width='50' height='16' viewBox='0 0 72 23' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path
      d='M35.6495 0.413261L30.841 22.6604H25.0219L29.8376 0.413261H35.6495ZM60.1288 14.7776L63.1897 6.42214L64.9541 14.7776H60.1288ZM66.6178 22.6604H72L67.3044 0.413261H62.3374C62.3302 0.413261 62.3206 0.413261 62.3134 0.413261C61.2115 0.413261 60.2657 1.08065 59.8672 2.02829L59.86 2.04492L51.1336 22.6604H57.2409L58.4556 19.3353H65.9192L66.6178 22.6604ZM51.4337 15.3975C51.4577 9.52396 43.2259 9.20095 43.2835 6.57652C43.3028 5.7785 44.0686 4.92823 45.749 4.7121C46.0611 4.68123 46.4212 4.66223 46.7861 4.66223C48.4929 4.66223 50.111 5.04698 51.5514 5.73575L51.4865 5.70725L52.5068 0.988022C50.8912 0.368134 49.0211 0.00712515 47.067 0H47.0646C41.3126 0 37.2675 3.02819 37.2315 7.35791C37.1955 10.5595 40.1195 12.3431 42.3257 13.4119C44.5943 14.5021 45.3553 15.2027 45.3433 16.1741C45.3289 17.6704 43.538 18.3259 41.8624 18.352C41.7855 18.3544 41.6919 18.3544 41.6007 18.3544C39.5097 18.3544 37.5412 17.8343 35.8224 16.9151L35.8872 16.946L34.8333 21.8196C36.7202 22.5677 38.9072 23 41.1974 23C41.2334 23 41.2694 23 41.3054 23H41.3006C47.4126 23 51.4097 20.0146 51.4313 15.3903L51.4337 15.3975ZM27.3361 0.413261L17.9112 22.6604H11.7607L7.1227 4.90211C7.03388 4.03759 6.49853 3.31557 5.75433 2.95456L5.73993 2.94744C4.08829 2.14467 2.16778 1.49153 0.158443 1.08065L0 1.05452L0.139237 0.410885H10.0395C11.3886 0.410885 12.5097 1.38703 12.7186 2.66243L12.721 2.67668L15.172 15.5518L21.2265 0.408509L27.3361 0.413261Z'
      fill='currentColor'
    />
  </svg>
)
