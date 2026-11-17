/**
 * The store's info and policy pages: About, Shipping, Returns, Terms, Privacy, Contact. Razorpay and Google
 * want these, and customers look for them before paying. Pure rules (safe in the browser): the page keys,
 * cleaning, and starting texts a business can edit (filled with its own name, phone and delivery rules).
 */

export const STORE_PAGES = ['about', 'shipping', 'returns', 'terms', 'privacy', 'contact'] as const
export type StorePageKey = (typeof STORE_PAGES)[number]

export const STORE_PAGE_TITLES: Record<StorePageKey, string> = {
  about: 'About us',
  shipping: 'Shipping and delivery',
  returns: 'Returns and refunds',
  terms: 'Terms and conditions',
  privacy: 'Privacy policy',
  contact: 'Contact us',
}

export const MAX_PAGE_TEXT = 6000

export function isPageKey(v: unknown): v is StorePageKey {
  return (STORE_PAGES as readonly string[]).includes(String(v))
}

/** Each page's text: plain text, paragraphs kept, at most 6,000 characters. */
export function cleanPages(raw: unknown): Partial<Record<StorePageKey, string>> {
  const out: Partial<Record<StorePageKey, string>> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const key of STORE_PAGES) {
    const v = String((raw as any)[key] ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_PAGE_TEXT)
    if (v) out[key] = v
  }
  return out
}

export interface PageFacts {
  name: string
  phone?: string
  whatsapp?: string
  address?: string
  pickup?: boolean
  delivery?: boolean
  deliveryFee?: number | null
  freeFrom?: number | null
  payOnline?: boolean
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/** A plain starting text for a page, with the business's own facts. The business should read and edit it. */
export function starterPage(key: StorePageKey, f: PageFacts): string {
  const contact = [f.phone && `Call ${f.phone}`, f.whatsapp && `WhatsApp ${f.whatsapp}`].filter(Boolean).join(' or ')
  switch (key) {
    case 'about':
      return `${f.name} is a local business${f.address ? ` at ${f.address}` : ''}. We sell what we would buy ourselves, and we are happy to help you choose.\n\n${contact ? `${contact} with any question.` : ''}`.trim()
    case 'shipping':
      return [
        f.delivery ? `We deliver your order to your door.${f.deliveryFee ? ` Delivery costs ${rupees(f.deliveryFee)}${f.freeFrom ? `, and is free on orders of ${rupees(f.freeFrom)} or more` : ''}.` : ' Delivery is free.'}` : '',
        f.delivery ? 'Most orders leave within 1–2 working days. You get the courier and tracking link on WhatsApp as soon as your order is on the way. Delivery usually takes 2–7 days, depending on your PIN code.' : '',
        f.pickup ? `You can also pick up your order from our shop${f.address ? ` (${f.address})` : ''}. We will message you when it is ready.` : '',
        contact ? `Questions about delivery? ${contact}.` : '',
      ].filter(Boolean).join('\n\n')
    case 'returns':
      return [
        'If something is damaged, wrong or not as shown, tell us within 7 days of getting it, with a photo. We will replace it or refund you.',
        'Items must be unused, with their tags and box. For hygiene, some items cannot be returned once opened (we say so on the product).',
        f.payOnline ? 'Refunds for online payments go back to the same card, UPI or bank account within 5–7 working days after we receive the item. Cash on delivery orders are refunded by UPI or bank transfer.' : 'Refunds are made by UPI or bank transfer within 5–7 working days after we receive the item.',
        contact ? `To start a return, ${contact.charAt(0).toLowerCase() + contact.slice(1)} with your order number.` : 'To start a return, message us with your order number.',
      ].join('\n\n')
    case 'terms':
      return [
        `These terms apply to orders placed on the ${f.name} website.`,
        'Prices are in Indian rupees and include taxes unless said otherwise. We may change prices and offers at any time; your order keeps the price shown when you placed it.',
        'An order is confirmed when we accept it and, for online payments, when the payment is received. We may cancel an order if an item is out of stock or an address cannot be served; any payment is refunded in full.',
        'Delivery times are estimates. Returns and refunds follow our Returns and refunds page.',
        'These terms follow Indian law.',
      ].join('\n\n')
    case 'privacy':
      return [
        `${f.name} keeps your name, phone number, address and order details only to deliver your orders and to help you with them.`,
        'We send you order updates on WhatsApp. We do not sell your details to anyone. Couriers get your name, address and phone number to deliver your order. Online payments are handled by Razorpay; we never see your card or UPI details.',
        contact ? `To see or delete your details, ${contact.charAt(0).toLowerCase() + contact.slice(1)}.` : 'To see or delete your details, message us.',
      ].join('\n\n')
    case 'contact':
      return [contact ? `${contact}.` : '', f.address ? `Visit us: ${f.address}` : ''].filter(Boolean).join('\n\n') || `Message ${f.name} on WhatsApp.`
  }
}

/** The text shown: the business's own, else for About / Contact what the store page already knows. */
export function pageText(key: StorePageKey, pages: Partial<Record<StorePageKey, string>>, f: PageFacts & { about?: string }): string {
  if (pages[key]) return pages[key]!
  if (key === 'about' && f.about) return f.about
  if (key === 'contact' && (f.phone || f.whatsapp || f.address)) return starterPage('contact', f)
  return ''
}
