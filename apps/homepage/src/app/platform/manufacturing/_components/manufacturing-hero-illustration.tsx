// apps/homepage/src/app/platform/manufacturing/_components/manufacturing-hero-illustration.tsx

export const ManufacturingHeroIllustration = () => {
  return (
    <div className='relative z-10 mt-16 md:mt-24'>
      <div
        aria-hidden
        className='absolute inset-x-1 -top-6 bottom-12 mx-auto max-w-6xl md:inset-x-0'>
        <div
          aria-hidden
          className='bg-foreground/10 absolute right-3 top-3 size-1.5 rounded-full shadow shadow-black ring-2 ring-white max-lg:hidden'
        />
        <div
          aria-hidden
          className='bg-foreground/10 absolute left-11 top-3 size-1.5 rounded-full shadow shadow-black ring-2 ring-white max-lg:hidden'
        />
        <div
          aria-hidden
          className='bg-foreground/10 absolute left-4 top-10 size-1.5 rounded-full shadow shadow-black ring-2 ring-white max-lg:hidden'
        />

        <svg
          className='text-foreground/15 fill-card/50 max-md:scale-x-250 w-full origin-top-right max-md:translate-x-3 max-md:scale-y-125'
          viewBox='0 0 2402 1372'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'>
          <path
            d='M1.6015 1033.34L4.26185 1343.72C4.39367 1359.1 16.9052 1371.49 32.2849 1371.48L2310.36 1369.51C2317.81 1369.5 2324.95 1366.53 2330.2 1361.25L2393.36 1297.69C2398.57 1292.44 2401.5 1285.35 2401.5 1277.95V1042.9C2401.5 1036.19 2399.09 1029.7 2394.71 1024.62L2364.79 989.877C2360.41 984.795 2358 978.311 2358 971.603V377.809C2358 370.258 2361.05 363.028 2366.46 357.758L2389.04 335.742C2394.45 330.472 2397.5 323.242 2397.5 315.691V29C2397.5 13.536 2384.96 1 2369.5 1H2300.5H1544.71C1536.92 1 1529.49 4.24189 1524.19 9.94736L1501.81 34.0526C1496.51 39.7581 1489.08 43 1481.29 43H926.196C918.712 43 911.539 40.0038 906.279 34.6801L881.221 9.31992C875.961 3.99621 868.788 1 861.304 1H87.598C80.1719 1 73.05 3.95 67.799 9.20102L9.20101 67.799C3.94999 73.05 1 80.1719 1 87.598V315.075C1 322.101 3.64086 328.869 8.3986 334.038L34.1014 361.962C38.8591 367.131 41.5 373.899 41.5 380.925V970.299C41.5 977.786 38.5014 984.961 33.1741 990.222L9.9264 1013.18C4.53979 1018.5 1.53662 1025.77 1.6015 1033.34Z'
            stroke='currentColor'
          />
        </svg>
      </div>

      <div className='relative mx-auto max-w-6xl max-md:mx-1 md:px-6'>
        <div className='relative overflow-hidden'>
          <div className='mask-radial-from-60% mask-radial-at-top mask-radial-[95%_100%] px-6 pt-6 max-md:pt-2'>
            <div className='bg-background/60 ring-border-illustration mx-auto max-w-4xl rounded-2xl p-1 shadow-xl shadow-black/20 ring-1'>
              <div className='bg-background relative origin-top overflow-hidden rounded-xl border-4 border-l-8 border-transparent aspect-4/3'>
                <video
                  autoPlay
                  loop
                  muted
                  playsInline
                  className='size-full object-cover object-top-left'
                  src='/videos/new-part.mp4'
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
