// apps/homepage/src/app/blog/layout.tsx

import FooterSection from '../_components/main/footer-section'
import Header from '../_components/main/header'

export default function BlogLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div id='root' className='relative h-screen overflow-y-auto'>
      <Header />
      <section>
        <div className='pt-22 pb-16 md:pb-24 md:pt-32'>{children}</div>
      </section>
      <FooterSection />
    </div>
  )
}
