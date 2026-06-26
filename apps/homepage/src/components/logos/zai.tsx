// apps/homepage/src/components/logos/zai.tsx
import type { SVGProps } from 'react'

type IconProps = { dark?: boolean } & SVGProps<SVGSVGElement>

const Zai = ({ dark: _, ...props }: IconProps) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    viewBox='0 0 512 512'
    fillRule='evenodd'
    clipRule='evenodd'
    strokeLinejoin='round'
    strokeMiterlimit={2}
    {...props}>
    <path
      fill='#3859FF'
      d='M503 114.333v280c0 60.711-49.29 110-110 110H113c-60.711 0-110-49.289-110-110v-280c0-60.71 49.289-110 110-110h280c60.71 0 110 49.29 110 110z'
    />
    <path
      fill='#fff'
      d='M140 150 L372 150 L372 206 L236 306 L372 306 L372 362 L140 362 L140 306 L276 206 L140 206 Z'
    />
  </svg>
)

export const ZaiFull = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 48' {...props}>
    <g transform='translate(0 4)'>
      <rect width='40' height='40' rx='9' fill='#3859FF' />
      <path
        fill='#fff'
        d='M11 11 L29 11 L29 15.4 L18.3 23.4 L29 23.4 L29 27.8 L11 27.8 L11 23.4 L21.7 15.4 L11 15.4 Z'
      />
    </g>
    <text
      x='52'
      y='32'
      fontFamily='ui-sans-serif, system-ui, sans-serif'
      fontSize='28'
      fontWeight='700'
      fill='currentColor'>
      Z.AI
    </text>
  </svg>
)

export default Zai
