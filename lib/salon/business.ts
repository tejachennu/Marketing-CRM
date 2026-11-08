/**
 * Front Desk works for any business that takes appointments. The business type sets the starter
 * kit (services and team to begin with), category suggestions and how the WhatsApp assistant
 * describes the business. Pure and browser-safe.
 */

export type BusinessType = 'salon' | 'clinic' | 'fitness' | 'repair' | 'other'

export interface StarterService { category: string; name: string; price: number; duration_minutes: number }
export interface StarterKit { services: StarterService[]; staff: { name: string; categories: string[] }[]; taxRate: number }

export interface BusinessTypeInfo {
  label: string
  hint: string
  /** "a salon and spa", for the WhatsApp assistant */
  describe: string
  categories: string[]
  kit: StarterKit | null
}

export const BUSINESS_TYPES: Record<BusinessType, BusinessTypeInfo> = {
  salon: {
    label: 'Salon & spa', hint: 'Hair, skin, nails, spa', describe: 'a salon and spa', categories: ['Hair', 'Skin', 'Nails', 'Spa', 'Makeup', 'Bridal'],
    kit: {
      taxRate: 18,
      services: [
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
      ],
      staff: [
        { name: 'Anitha', categories: ['Hair', 'Skin', 'Bridal'] },
        { name: 'Ravi', categories: ['Hair'] },
        { name: 'Lakshmi', categories: ['Nails', 'Spa', 'Skin'] },
      ],
    },
  },
  clinic: {
    label: 'Clinic', hint: 'Doctors, dental, physio, lab', describe: 'a clinic', categories: ['Consultation', 'Dental', 'Physio', 'Lab', 'Procedure'],
    kit: {
      // Healthcare services are exempt from GST
      taxRate: 0,
      services: [
        { category: 'Consultation', name: 'Doctor consultation', price: 500, duration_minutes: 15 },
        { category: 'Consultation', name: 'Follow-up visit', price: 300, duration_minutes: 10 },
        { category: 'Dental', name: 'Dental check-up', price: 400, duration_minutes: 20 },
        { category: 'Dental', name: 'Teeth cleaning', price: 1200, duration_minutes: 30 },
        { category: 'Dental', name: 'Tooth filling', price: 1500, duration_minutes: 45 },
        { category: 'Physio', name: 'Physiotherapy session', price: 800, duration_minutes: 45 },
        { category: 'Lab', name: 'Blood test (CBC)', price: 350, duration_minutes: 10 },
        { category: 'Procedure', name: 'Dressing', price: 200, duration_minutes: 15 },
      ],
      staff: [
        { name: 'Dr. Rao', categories: ['Consultation', 'Procedure'] },
        { name: 'Dr. Meena', categories: ['Dental'] },
        { name: 'Kavya', categories: ['Physio', 'Lab'] },
      ],
    },
  },
  fitness: {
    label: 'Fitness & yoga', hint: 'Gym, yoga, dance, diet', describe: 'a fitness and yoga studio', categories: ['Training', 'Classes', 'Membership', 'Nutrition'],
    kit: {
      taxRate: 18,
      services: [
        { category: 'Training', name: 'Personal training session', price: 800, duration_minutes: 60 },
        { category: 'Training', name: 'Fitness assessment', price: 500, duration_minutes: 30 },
        { category: 'Classes', name: 'Yoga class', price: 300, duration_minutes: 60 },
        { category: 'Classes', name: 'Zumba class', price: 300, duration_minutes: 45 },
        { category: 'Membership', name: 'Monthly membership', price: 2500, duration_minutes: 30 },
        { category: 'Nutrition', name: 'Diet consultation', price: 1000, duration_minutes: 30 },
      ],
      staff: [
        { name: 'Arjun', categories: ['Training', 'Membership'] },
        { name: 'Priya', categories: ['Classes'] },
        { name: 'Sana', categories: ['Nutrition'] },
      ],
    },
  },
  repair: {
    label: 'Repair & service', hint: 'Mobiles, laptops, home, vehicles', describe: 'a repair and service centre', categories: ['Mobile', 'Laptop', 'Home appliances', 'Vehicle'],
    kit: {
      taxRate: 18,
      services: [
        { category: 'Mobile', name: 'Screen replacement', price: 2500, duration_minutes: 60 },
        { category: 'Mobile', name: 'Battery replacement', price: 1200, duration_minutes: 30 },
        { category: 'Laptop', name: 'Laptop service', price: 1500, duration_minutes: 90 },
        { category: 'Home appliances', name: 'AC service', price: 600, duration_minutes: 60 },
        { category: 'Home appliances', name: 'Washing machine repair', price: 500, duration_minutes: 60 },
        { category: 'Vehicle', name: 'Bike general service', price: 900, duration_minutes: 120 },
      ],
      staff: [
        { name: 'Imran', categories: ['Mobile', 'Laptop'] },
        { name: 'Suresh', categories: ['Home appliances'] },
        { name: 'Venkat', categories: ['Vehicle'] },
      ],
    },
  },
  other: { label: 'Something else', hint: 'Any business that takes appointments', describe: 'a business that takes appointments', categories: ['General', 'Consultation', 'Package'], kit: null },
}

export const BUSINESS_TYPE_IDS = Object.keys(BUSINESS_TYPES) as BusinessType[]

export function businessType(value: unknown): BusinessType {
  return BUSINESS_TYPE_IDS.includes(value as BusinessType) ? (value as BusinessType) : 'salon'
}
