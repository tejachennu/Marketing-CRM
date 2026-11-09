/**
 * Front Desk service categories (Hair, Skin, Consultation…). A service carries its category as
 * text; the business's own list (salon_settings.service_categories) keeps the order and the
 * categories that have no services yet. Pure helpers, shared by the API and the screens.
 */

export const MAX_CATEGORIES = 40
export const DEFAULT_CATEGORY = 'General'

/** A clean category name (one line, at most 40 characters), or '' when nothing usable was given. */
export function categoryName(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
}

const key = (name: string) => name.toLowerCase()

/** The business's list as saved: clean, without empties or repeats (the first spelling wins). */
export function cleanCategoryList(value: unknown): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of Array.isArray(value) ? value : []) {
    const name = categoryName(item)
    if (!name || seen.has(key(name))) continue
    seen.add(key(name))
    out.push(name)
  }
  return out.slice(0, MAX_CATEGORIES)
}

/**
 * Every category in order: the saved list first, then any category a service uses that the list
 * does not have yet (in the order the services come).
 */
export function orderedCategories(saved: unknown, services: { category?: string | null }[]): string[] {
  const list = cleanCategoryList(saved)
  const seen = new Set(list.map(key))
  for (const service of services) {
    const name = categoryName(service.category) || DEFAULT_CATEGORY
    if (seen.has(key(name))) continue
    seen.add(key(name))
    list.push(name)
  }
  return list
}

/** Services grouped by category, in the business's order (categories without services included). */
export function groupByCategory<T extends { category?: string | null }>(saved: unknown, services: T[]): [string, T[]][] {
  const order = orderedCategories(saved, services)
  const groups = new Map<string, T[]>(order.map((name) => [key(name), []]))
  for (const service of services) groups.get(key(categoryName(service.category) || DEFAULT_CATEGORY))!.push(service)
  return order.map((name) => [name, groups.get(key(name))!])
}

export function hasCategory(list: string[], name: string) {
  return list.some((item) => key(item) === key(name))
}
