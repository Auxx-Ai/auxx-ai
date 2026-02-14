// apps/web/src/app/opengraph-image.tsx
import { ImageResponse } from 'next/og'

/** Image dimensions for OpenGraph */
export const alt = 'Auxx.ai - AI-powered email support for Shopify businesses'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

/**
 * Generates dynamic OpenGraph image with company logo and branding
 */
export default async function Image() {
  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        backgroundImage: 'linear-gradient(to bottom right, #f8fafc 0%, #e2e8f0 100%)',
      }}>
      {/* Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 40,
        }}>
        <svg width='120' height='120' viewBox='0 0 68 68' xmlns='http://www.w3.org/2000/svg'>
          <circle fill='#69b3fe' cx='34' cy='33.5' r='34'></circle>
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
      </div>

      {/* Company Name */}
      <div
        style={{
          display: 'flex',
          fontSize: 72,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: '#0f172a',
          marginBottom: 16,
        }}>
        Auxx.ai
      </div>

      {/* Description */}
      <div
        style={{
          display: 'flex',
          fontSize: 36,
          color: '#64748b',
          maxWidth: 800,
          textAlign: 'center',
        }}>
        AI-powered email support for Shopify businesses
      </div>

      {/* Bottom accent */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 8,
          background: 'linear-gradient(to right, #69b3fe 0%, #3b82f6 100%)',
        }}
      />
    </div>,
    {
      ...size,
    }
  )
}
