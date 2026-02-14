import { redirect } from 'next/navigation'

type Props = { params: Promise<{ slug: string }> }

async function AppInstalledPage({ params }: Props) {
  const { slug } = await params

  redirect(`/app/settings/apps/installed/${slug}/connections`)
}

export default AppInstalledPage
