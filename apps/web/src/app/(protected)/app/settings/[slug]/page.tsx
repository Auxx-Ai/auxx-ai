import React from 'react'

type Props = { params: Promise<{ slug: string }> }

const Page = async ({ params }: Props) => {
  const { slug } = await params

  console.log(slug)

  return <div>Page: {slug}</div>
}

export default Page
