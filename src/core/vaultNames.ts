/** Project handles and Profile names share one CLI-safe syntax: lowercase, digits, `-` and `_`. */
export const isValidVaultName = (value: string) => /^[a-z0-9][a-z0-9_-]*$/.test(value)

/** Derives a valid handle from a folder name ("My App" → "my-app"), suffixed `-2`, `-3`… until unused. */
export const deriveProjectHandle = (name: string, taken: ReadonlySet<string>) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
  let handle = base
  for (let suffix = 2; taken.has(handle); suffix += 1) handle = `${base}-${suffix}`
  return handle
}
