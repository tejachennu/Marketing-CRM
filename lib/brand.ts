/**
 * The product's name and public contact details in one place, so a rename is one change here.
 * (The owner is choosing a new brand name; older pages still spell "WAMA CRM" themselves.)
 */
export const BRAND = {
  name: 'WAMA CRM',
  company: 'Magnetora AI',
  /** WhatsApp and phone for sales and set-up help */
  whatsapp: '918367629608',
  phoneShown: '+91 83676 29608',
} as const

/** A wa.me link that opens WhatsApp with a message already typed */
export function whatsappUs(text: string) {
  return `https://wa.me/${BRAND.whatsapp}?text=${encodeURIComponent(text)}`
}
