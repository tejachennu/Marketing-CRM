/** Phone numbers shown to people (pure; safe in the browser). */

/** +919876543210 → +91 98765 43210 (Indian numbers); other numbers as they are. */
export function showPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`
  return phone
}
