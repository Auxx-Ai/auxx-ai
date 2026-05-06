// apps/homepage/src/app/platform/data-model/page.tsx
import type { Metadata } from 'next'
import { config } from '~/lib/config'
import FooterSection from '../../_components/main/footer-section'
import Header from '../../_components/main/header'
import { BreadcrumbJsonLd } from '../../_components/seo/breadcrumb-json-ld'
import { FinalCtaSection } from '../_components/final-cta-section'
import DataModelWallHero from './_components/data-model-wall-hero'
import DatasetsSection from './_components/datasets-section'
import HowAiUsesBothSection from './_components/how-ai-uses-both-section'
import KnowledgeBaseSection from './_components/knowledge-base-section'

export const metadata: Metadata = {
  title: `Data Model — Knowledge Base & Datasets | ${config.shortName}`,
  description: `Author articles in the ${config.shortName} knowledge base or upload your own PDFs and docs as datasets. Both feed Kopilot and AI replies with grounded, cited answers.`,
}

export default function DataModelPage() {
  return (
    <div id='root' className='relative h-screen overflow-y-auto bg-background'>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: 'https://auxx.ai' },
          { name: 'Platform', href: 'https://auxx.ai/platform' },
          { name: 'Data Model' },
        ]}
      />
      <Header />
      <main>
        <DataModelWallHero />
        <KnowledgeBaseSection />
        <DatasetsSection />
        <HowAiUsesBothSection />
        <FinalCtaSection />
      </main>
      <FooterSection />
    </div>
  )
}
