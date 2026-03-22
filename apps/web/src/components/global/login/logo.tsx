import Image from 'next/image'
import Link from 'next/link'
import LogoImg from '~/../public/logo_color.png' // Adjust path if needed

function Logo() {
  return (
    <Link href='/' className='flex items-center gap-2 self-center text-white'>
      <Image src={LogoImg} alt='AuxxLift Logo' className='size-10' />
      <h1 className='text-2xl font-bold'>
        auxx.<span className=''>Ai</span>
      </h1>
    </Link>
  )
}

export { Logo }
