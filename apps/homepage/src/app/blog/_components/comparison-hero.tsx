// apps/homepage/src/app/blog/_components/comparison-hero.tsx

import Image from 'next/image'

const competitors: Record<string, { name: string; color: string; logo?: string; icon?: string }> = {
  zendesk: { name: 'Zendesk', color: '#03363D', logo: '/images/logos/zendesk.svg' },
  salesforce: { name: 'Salesforce', color: '#ffffff', logo: '/images/logos/salesforce.svg' },
  freshworks: { name: 'Freshworks', color: '#ffffff', logo: '/images/logos/freshworks.svg' },
  monday: { name: 'Monday.com', color: '#ffffff', logo: '/images/logos/monday.svg' },
  pipedrive: { name: 'Pipedrive', color: '#017737', logo: '/images/logos/pipedrive.svg' },
  attio: { name: 'Attio', color: '#000000', logo: '/images/logos/attio.svg' },
  n8n: { name: 'n8n', color: '#ffffff', logo: '/images/logos/n8n.svg' },
}

export function ComparisonHero({ competitor }: { competitor: string }) {
  const comp = competitors[competitor]
  if (!comp) return null

  const isLightBg = comp.color === '#ffffff'

  return (
    <div className='not-prose mb-12 overflow-hidden rounded-xl border'>
      <div className='flex items-center justify-center gap-6 bg-muted/50 px-6 py-10 sm:gap-10 sm:py-14'>
        <div className='flex flex-col items-center gap-3'>
          <div className='flex size-16 items-center justify-center rounded-2xl bg-[#69b3fe] shadow-lg sm:size-20'>
            <svg
              width='40'
              height='40'
              data-name='Layer 1'
              xmlns='http://www.w3.org/2000/svg'
              viewBox='0 0 68 68'
              className='size-9 sm:size-11'>
              <g>
                <path
                  strokeWidth='0'
                  fill='#fff'
                  d='M7.74,39.14c-.69,0-1.39-.24-1.95-.72-1.37-1.17-1.29-3.34-.02-4.62L31.78,7.59c1.19-1.2,3.13-1.2,4.32,0l26.06,26.25c1.05,1.05,1.31,2.73.47,3.96-1.11,1.61-3.31,1.75-4.62.44l-24.04-24.22s-.04-.02-.06,0l-24.04,24.22c-.59.59-1.36.89-2.13.89Z'
                />
                <rect
                  strokeWidth='0'
                  fill='#fff'
                  x='18.88'
                  y='31.89'
                  width='13.68'
                  height='13.79'
                  rx='2.46'
                  ry='2.46'
                />
                <rect
                  strokeWidth='0'
                  fill='#fff'
                  x='33.93'
                  y='31.89'
                  width='13.68'
                  height='13.79'
                  rx='2.39'
                  ry='2.39'
                />
                <rect
                  strokeWidth='0'
                  fill='#fff'
                  x='33.93'
                  y='47.06'
                  width='13.68'
                  height='13.79'
                  rx='2.5'
                  ry='2.5'
                />
              </g>
            </svg>
          </div>
          <span className='text-sm font-semibold text-foreground sm:text-base'>Auxx.ai</span>
        </div>

        <span className='text-2xl font-bold text-muted-foreground/60 sm:text-3xl'>vs</span>

        <div className='flex flex-col items-center gap-3'>
          <div
            className='flex size-16 items-center justify-center overflow-hidden rounded-2xl shadow-lg sm:size-20'
            style={{
              backgroundColor: comp.color,
              border: isLightBg ? '1px solid hsl(var(--border))' : undefined,
            }}>
            {comp.logo ? (
              <Image
                src={comp.logo}
                alt={comp.name}
                width={48}
                height={48}
                className='size-10 object-contain sm:size-12'
              />
            ) : (
              <span className='text-2xl font-bold text-white sm:text-3xl'>{comp.icon}</span>
            )}
          </div>
          <span className='text-sm font-semibold text-foreground sm:text-base'>{comp.name}</span>
        </div>
      </div>
    </div>
  )
}
