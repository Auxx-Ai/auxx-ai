// apps/build/src/app/apple-icon.tsx
import { ImageResponse } from 'next/og'

/** Apple touch icon dimensions */
export const size = {
  width: 180,
  height: 180,
}
export const contentType = 'image/png'

/**
 * Generates dynamic Apple touch icon with company logo
 */
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#00d492',
      }}>
      <svg width='140' height='140' viewBox='0 0 68 68' xmlns='http://www.w3.org/2000/svg'>
        <g>
          <path
            fill='#fff'
            d='M7.74,39.14c-.69,0-1.39-.24-1.95-.72-1.37-1.17-1.29-3.34-.02-4.62L31.78,7.59c1.19-1.2,3.13-1.2,4.32,0l26.06,26.25c1.05,1.05,1.31,2.73.47,3.96-1.11,1.61-3.31,1.75-4.62.44l-24.04-24.22s-.04-.02-.06,0l-24.04,24.22c-.59.59-1.36.89-2.13.89Z'></path>
          <rect
            fill='#fff'
            x='18.88'
            y='31.89'
            width='13.68'
            height='13.79'
            rx='2.46'
            ry='2.46'></rect>
          <rect
            fill='#fff'
            x='33.93'
            y='31.89'
            width='13.68'
            height='13.79'
            rx='2.39'
            ry='2.39'></rect>
          <rect
            fill='#fff'
            x='33.93'
            y='47.06'
            width='13.68'
            height='13.79'
            rx='2.5'
            ry='2.5'></rect>
        </g>
      </svg>
    </div>,
    {
      ...size,
    }
  )
}
