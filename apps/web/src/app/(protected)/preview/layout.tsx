// import { SessionProvider } from 'next-auth/react'
// import { auth } from '~/server/auth'

type Props = { children: React.ReactNode }

const layout = async ({ children }: Props) => {
  // const session = await auth()

  return <div>{children}</div>
  // const slug = params.slug;
}

export default layout
