import { redirect } from 'next/navigation'

const Home = () => {
  redirect('/app/mail/inbox/open')
}

export default Home
