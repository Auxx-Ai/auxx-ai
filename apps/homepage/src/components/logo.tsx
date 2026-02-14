import { cn } from '@/lib/utils'

export const Logo = ({ className, uniColor }: { className?: string; uniColor?: boolean }) => {
  return (
    <svg
      width='32'
      height='32'
      data-name='Layer 1'
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 68 68'
      className={className}>
      <circle strokeWidth='0' fill='#69b3fe' cx='34' cy='33.5' r='34'></circle>
      <g>
        <path
          strokeWidth='0'
          fill='#fff'
          d='M7.74,39.14c-.69,0-1.39-.24-1.95-.72-1.37-1.17-1.29-3.34-.02-4.62L31.78,7.59c1.19-1.2,3.13-1.2,4.32,0l26.06,26.25c1.05,1.05,1.31,2.73.47,3.96-1.11,1.61-3.31,1.75-4.62.44l-24.04-24.22s-.04-.02-.06,0l-24.04,24.22c-.59.59-1.36.89-2.13.89Z'></path>
        <rect
          strokeWidth='0'
          fill='#fff'
          x='18.88'
          y='31.89'
          width='13.68'
          height='13.79'
          rx='2.46'
          ry='2.46'></rect>
        <rect
          strokeWidth='0'
          fill='#fff'
          x='33.93'
          y='31.89'
          width='13.68'
          height='13.79'
          rx='2.39'
          ry='2.39'></rect>
        <rect
          strokeWidth='0'
          fill='#fff'
          x='33.93'
          y='47.06'
          width='13.68'
          height='13.79'
          rx='2.5'
          ry='2.5'></rect>
      </g>
    </svg>
  )
}

export const LogoIcon = ({ className, uniColor }: { className?: string; uniColor?: boolean }) => {
  return (
    <svg
      width='18'
      height='18'
      viewBox='0 0 18 18'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn('size-5', className)}>
      <path
        d='M3 0H5V18H3V0ZM13 0H15V18H13V0ZM18 3V5H0V3H18ZM0 15V13H18V15H0Z'
        fill={uniColor ? 'currentColor' : 'url(#logo-gradient)'}
      />
      <defs>
        <linearGradient
          id='logo-gradient'
          x1='10'
          y1='0'
          x2='10'
          y2='20'
          gradientUnits='userSpaceOnUse'>
          <stop stopColor='#9B99FE' />
          <stop offset='1' stopColor='#2BC8B7' />
        </linearGradient>
      </defs>
    </svg>
  )
}

export const LogoStroke = ({ className }: { className?: string }) => {
  return (
    <svg
      className={cn('size-7 w-7', className)}
      viewBox='0 0 71 25'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'>
      <path
        d='M61.25 1.625L70.75 1.5625C70.75 4.77083 70.25 7.79167 69.25 10.625C68.2917 13.4583 66.8958 15.9583 65.0625 18.125C63.2708 20.25 61.125 21.9375 58.625 23.1875C56.1667 24.3958 53.4583 25 50.5 25C46.875 25 43.6667 24.2708 40.875 22.8125C38.125 21.3542 35.125 19.2083 31.875 16.375C29.75 14.4167 27.7917 12.8958 26 11.8125C24.2083 10.7292 22.2708 10.1875 20.1875 10.1875C18.0625 10.1875 16.25 10.7083 14.75 11.75C13.25 12.75 12.0833 14.1875 11.25 16.0625C10.4583 17.9375 10.0625 20.1875 10.0625 22.8125L0 22.9375C0 19.6875 0.479167 16.6667 1.4375 13.875C2.4375 11.0833 3.83333 8.64583 5.625 6.5625C7.41667 4.47917 9.54167 2.875 12 1.75C14.5 0.583333 17.2292 0 20.1875 0C23.8542 0 27.1042 0.770833 29.9375 2.3125C32.8125 3.85417 35.7708 5.97917 38.8125 8.6875C41.1042 10.7708 43.1042 12.3333 44.8125 13.375C46.5625 14.375 48.4583 14.875 50.5 14.875C52.6667 14.875 54.5417 14.3125 56.125 13.1875C57.75 12.0625 59 10.5 59.875 8.5C60.7917 6.5 61.25 4.20833 61.25 1.625Z'
        fill='none'
        strokeWidth={0.5}
        stroke='currentColor'
      />
    </svg>
  )
}
