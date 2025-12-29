// apps/web/src/app/(website)/solutions/customer-support-teams/_components/business-hero-illustration.tsx
import Image from 'next/image'
import { Building2 } from 'lucide-react'

export const BusinessHeroIllustration = () => {
  return (
    <div className="relative max-md:-mx-6">
      <div className="z-1 absolute inset-y-0 my-auto h-fit w-full max-w-72 origin-left scale-75 max-lg:left-6">
        <div className="bg-linear-to-r absolute -inset-6 from-blue-400 via-purple-400 to-pink-400 opacity-40 blur-3xl"></div>

        <div className="bg-card ring-border-illustration relative rounded-2xl p-6 shadow-xl ring-1">
          <div className="mb-6 flex items-start justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Building2 className="h-6 w-6 text-blue-600" />
                <span className="font-semibold">Small Business</span>
              </div>
              <div className="mt-4 font-mono text-xs text-muted-foreground">TICKET #5678</div>
              <div className="mt-1 -translate-x-1 font-mono text-2xl font-semibold text-blue-600">
                24/7
              </div>
              <div className="text-xs font-medium text-muted-foreground">Always available</div>
            </div>
          </div>

          <div className="bg-blue-50 border-blue-200 mt-6 flex h-20 items-center justify-center rounded-md border">
            <div className="text-blue-600 text-center">
              <div className="font-semibold">AI Assistant Ready</div>
              <div className="text-xs">Serving customers instantly</div>
            </div>
          </div>
        </div>
      </div>
      <div className="mask-radial-from-75% ml-auto w-4/5 px-4 py-8">
        <div className="before:border-foreground/5 before:bg-primary/5 aspect-2/3 relative mt-auto h-fit overflow-hidden rounded-xl shadow-xl before:absolute before:inset-0 before:rounded-xl before:border">
          <Image
            src="/images/solutions/small-business/small-business-photo.jpg"
            alt="Small business customer support dashboard"
            className="size-full object-cover"
            width={987}
            height={1481}
          />
        </div>
      </div>
    </div>
  )
}
