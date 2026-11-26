/**
 * A page broke because a new version of the app went live while it was open (its old files are gone). Reloading the
 * page once fixes it. Pure, browser-safe.
 */
export function isNewVersionError(error: unknown): boolean {
  const text = `${(error as any)?.name || ''} ${(error as any)?.message || ''}`
  return /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(text)
}
