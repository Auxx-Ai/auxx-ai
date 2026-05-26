// apps/homepage/src/components/logos/quickbooks.tsx
import type { SVGProps } from 'react'

type IconProps = { dark?: boolean } & SVGProps<SVGSVGElement>

const Quickbooks = ({ dark, ...props }: IconProps) => (
  <svg
    role='img'
    fill='currentColor'
    viewBox='0 0 24 24'
    xmlns='http://www.w3.org/2000/svg'
    {...props}>
    <title>QuickBooks</title>
    <path d='M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zM6.5 6.594h4.39c1.78 0 3.224 1.444 3.224 3.225v6.182h-1.39v-6.182c0-1.013-.821-1.834-1.834-1.834H6.5c-1.014 0-1.835.821-1.835 1.834s.821 1.834 1.835 1.834v1.391c-1.781 0-3.225-1.444-3.225-3.225 0-1.781 1.444-3.225 3.225-3.225zm10.945 10.812h-4.389c-1.78 0-3.224-1.444-3.224-3.225V8h1.39v6.181c0 1.013.821 1.834 1.834 1.834h4.389c1.014 0 1.835-.821 1.835-1.834s-.821-1.834-1.835-1.834v-1.391c1.781 0 3.225 1.444 3.225 3.225 0 1.781-1.444 3.225-3.225 3.225z' />
  </svg>
)

export default Quickbooks
