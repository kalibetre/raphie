export function initials(name: string): string {
  const words = name.split(/[\s-_]+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0]![0], words[1]![0]] : [name[0], name[1]]
  return letters.filter(Boolean).join('').toUpperCase()
}
