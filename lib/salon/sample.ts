/** "Add sample salon": a ready-to-use menu of services and a small team, with typical Indian prices. */

export const SAMPLE_SERVICES: { category: string; name: string; price: number; duration_minutes: number }[] = [
  { category: 'Hair', name: 'Haircut (Men)', price: 300, duration_minutes: 30 },
  { category: 'Hair', name: 'Haircut (Women)', price: 600, duration_minutes: 45 },
  { category: 'Hair', name: 'Beard trim', price: 150, duration_minutes: 15 },
  { category: 'Hair', name: 'Hair colour', price: 1500, duration_minutes: 90 },
  { category: 'Hair', name: 'Hair spa', price: 1200, duration_minutes: 60 },
  { category: 'Hair', name: 'Head massage', price: 400, duration_minutes: 30 },
  { category: 'Skin', name: 'Clean-up', price: 600, duration_minutes: 30 },
  { category: 'Skin', name: 'Facial', price: 1200, duration_minutes: 60 },
  { category: 'Skin', name: 'Threading (eyebrows)', price: 60, duration_minutes: 10 },
  { category: 'Skin', name: 'Waxing (full arms)', price: 400, duration_minutes: 30 },
  { category: 'Nails', name: 'Manicure', price: 500, duration_minutes: 40 },
  { category: 'Nails', name: 'Pedicure', price: 700, duration_minutes: 45 },
  { category: 'Spa', name: 'Body massage (60 min)', price: 2000, duration_minutes: 60 },
  { category: 'Bridal', name: 'Bridal makeup', price: 15000, duration_minutes: 180 },
]

/** Sample team: each one does the services in these categories. */
export const SAMPLE_STAFF: { name: string; categories: string[] }[] = [
  { name: 'Anitha', categories: ['Hair', 'Skin', 'Bridal'] },
  { name: 'Ravi', categories: ['Hair'] },
  { name: 'Lakshmi', categories: ['Nails', 'Spa', 'Skin'] },
]
