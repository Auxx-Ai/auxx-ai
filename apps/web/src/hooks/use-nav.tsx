import { usePathname } from 'next/navigation'

export const usePaths = () => {
  const pathname = usePathname() as string
  const path = pathname.split('/')
  const page = path[path.length - 1] as string
  return { page, pathname }
}
