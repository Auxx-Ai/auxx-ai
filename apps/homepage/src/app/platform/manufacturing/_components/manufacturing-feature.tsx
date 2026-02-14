import { BarChart3, Clock, Package, Users } from 'lucide-react'
import { PartIllustration } from './part-illustration'
import { VendorIllustration } from './vendor-illustration'

export default function ManufacturingFeature() {
  return (
    <section className='relative border-foreground/10 border-b'>
      <div className='relative z-10 mx-auto max-w-6xl border-x px-3'>
        <div className='border-x'>
          <div className='bg-muted/50 py-24'>
            <div className='mx-auto w-full max-w-5xl px-6'>
              <div className='grid max-md:divide-y md:grid-cols-2 md:divide-x'>
                <div className='row-span-2 grid grid-rows-subgrid gap-8 pb-12 md:pr-12'>
                  <div>
                    <h3 className='text-foreground text-xl font-semibold'>
                      Parts Tracking Made Simple
                    </h3>
                    <p className='text-muted-foreground mt-4 text-lg'>
                      Track every component from procurement to production with real-time inventory
                      visibility and automated alerts for low stock levels.
                    </p>
                  </div>
                  <PartIllustration />
                </div>
                <div className='row-span-2 grid grid-rows-subgrid gap-8 pb-12 max-md:pt-12 md:pl-12'>
                  <div>
                    <h3 className='text-foreground text-xl font-semibold'>
                      Vendor Management Dashboard
                    </h3>
                    <p className='text-muted-foreground mt-4 text-lg'>
                      Manage supplier relationships, track performance metrics, and automate
                      purchase orders with comprehensive vendor analytics.
                    </p>
                  </div>
                  <VendorIllustration />
                </div>
              </div>
              <div className='relative grid grid-cols-2 gap-x-3 gap-y-6 border-t pt-12 sm:gap-6 lg:grid-cols-4'>
                <div className='space-y-3'>
                  <div className='flex items-center gap-2'>
                    <Package className='text-foreground size-4' />
                    <h3 className='text-sm font-medium'>Real-Time Inventory</h3>
                  </div>
                  <p className='text-muted-foreground text-sm'>
                    Monitor stock levels, track part locations, and receive automated alerts when
                    inventory runs low.
                  </p>
                </div>
                <div className='space-y-2'>
                  <div className='flex items-center gap-2'>
                    <Users className='text-foreground size-4' />
                    <h3 className='text-sm font-medium'>Vendor Performance</h3>
                  </div>
                  <p className='text-muted-foreground text-sm'>
                    Track supplier delivery times, quality metrics, and cost analysis to optimize
                    vendor relationships.
                  </p>
                </div>
                <div className='space-y-2'>
                  <div className='flex items-center gap-2'>
                    <BarChart3 className='text-foreground size-4' />
                    <h3 className='text-sm font-medium'>Supply Chain Analytics</h3>
                  </div>
                  <p className='text-muted-foreground text-sm'>
                    Get insights into procurement patterns, demand forecasting, and supply chain
                    bottlenecks.
                  </p>
                </div>
                <div className='space-y-2'>
                  <div className='flex items-center gap-2'>
                    <Clock className='text-foreground size-4' />
                    <h3 className='text-sm font-medium'>Automated Ordering</h3>
                  </div>
                  <p className='text-muted-foreground text-sm'>
                    Set up automatic reorder points and streamline purchase order creation based on
                    inventory thresholds.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
