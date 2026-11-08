import { redirect } from 'next/navigation'

/** The old address of Front Desk (it was Spa & Salon): bookmarks keep working. */
export default function OldSalonPage() {
  redirect('/dashboard/front-desk')
}
