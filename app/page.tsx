import { redirect } from 'next/navigation'

export default function Home() {
  // Redirect to demo page if coming from root
  redirect('/demo')
}
