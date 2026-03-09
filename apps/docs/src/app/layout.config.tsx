import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  nav: {
    transparentMode: 'always',
    title: (
      <>
        <svg
          width='24'
          height='24'
          viewBox='0 0 68 68'
          xmlns='http://www.w3.org/2000/svg'
          aria-label='Auxx.ai Logo'>
          <circle fill='#00d492' cx='34' cy='33.5' r='34' />
          <g>
            <path
              fill='#fff'
              d='M7.74,39.14c-.69,0-1.39-.24-1.95-.72-1.37-1.17-1.29-3.34-.02-4.62L31.78,7.59c1.19-1.2,3.13-1.2,4.32,0l26.06,26.25c1.05,1.05,1.31,2.73.47,3.96-1.11,1.61-3.31,1.75-4.62.44l-24.04-24.22s-.04-.02-.06,0l-24.04,24.22c-.59.59-1.36.89-2.13.89Z'
            />
            <rect
              fill='#fff'
              x='18.88'
              y='31.89'
              width='13.68'
              height='13.79'
              rx='2.46'
              ry='2.46'
            />
            <rect
              fill='#fff'
              x='33.93'
              y='31.89'
              width='13.68'
              height='13.79'
              rx='2.39'
              ry='2.39'
            />
            <rect fill='#fff' x='33.93' y='47.06' width='13.68' height='13.79' rx='2.5' ry='2.5' />
          </g>
        </svg>
        Auxx.ai
      </>
    ),
  },
  // see https://fumadocs.dev/docs/ui/navigation/links
  links: [
    // {
    //   type: 'menu',
    //   text: 'Guide',
    //   items: [
    //     {
    //       text: 'Getting Started',
    //       description: 'Learn to use Fumadocs',
    //       url: '/docs',
    //     },
    //   ],
    // },
  ],
}
