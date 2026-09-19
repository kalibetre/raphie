import { FileSystem } from '@effect/platform'
import { Data, Effect } from 'effect'
import type { EnvVar } from './Domain.ts'

export class DuplicateEnvVarKeyError extends Data.TaggedError('DuplicateEnvVarKeyError')<{
  readonly key: string
}> {}

export class InvalidEnvVarKeyError extends Data.TaggedError('InvalidEnvVarKeyError')<{
  readonly key: string
}> {}

export class MissingEnvVarError extends Data.TaggedError('MissingEnvVarError')<{
  readonly key: string
}> {}

interface EnvVarLine {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly hasLineEnding: boolean
  readonly lineEnding: string
}

export interface ParsedEnvVar {
  readonly envVar: EnvVar
  readonly start: number
  readonly end: number
  readonly hasLineEnding: boolean
  readonly lineEnding: string
}

export interface SetEnvVarOptions {
  /** The key to replace. Omit this option to append a new EnvVar. */
  readonly previousKey?: string
  /** Zero-based occurrence among EnvVars with `previousKey`, for duplicate files. */
  readonly occurrence?: number
}

export interface DeleteEnvVarTarget {
  readonly key: string
  /** Zero-based occurrence among EnvVars with `key`, for duplicate files. */
  readonly occurrence?: number
}

const splitLines = (content: string): EnvVarLine[] => {
  const lines: EnvVarLine[] = []
  let start = 0

  while (start < content.length) {
    const lineFeed = content.indexOf('\n', start)
    const carriageReturn = content.indexOf('\r', start)
    const newline =
      lineFeed === -1
        ? carriageReturn
        : carriageReturn === -1
          ? lineFeed
          : Math.min(lineFeed, carriageReturn)
    if (newline === -1) {
      lines.push({
        text: content.slice(start),
        start,
        end: content.length,
        hasLineEnding: false,
        lineEnding: '',
      })
      break
    }

    const isCrLf = content[newline] === '\r' && content[newline + 1] === '\n'
    const end = newline + (isCrLf ? 2 : 1)
    lines.push({
      text: content.slice(start, newline),
      start,
      end,
      hasLineEnding: true,
      lineEnding: isCrLf ? '\r\n' : content[newline]!,
    })
    start = end
  }

  return lines
}

const endsWithUnescaped = (value: string, character: string) => {
  if (!value.endsWith(character)) return false
  let backslashes = 0
  for (let index = value.length - 2; index >= 0 && value[index] === '\\'; index -= 1) backslashes += 1
  return backslashes % 2 === 0
}

const unescapeQuoted = (value: string, quote: string) => value.replace(new RegExp(`\\\\([\\\\${quote}])`, 'g'), '$1')

const parseValue = (lines: readonly EnvVarLine[], lineIndex: number, equalsIndex: number) => {
  const rawValue = lines[lineIndex]!.text.slice(equalsIndex + 1).trim()
  const quote = rawValue[0]
  if (quote !== '"' && quote !== "'") return { value: rawValue, lastLineIndex: lineIndex }

  if (rawValue.length >= 2 && endsWithUnescaped(rawValue, quote)) {
    return { value: unescapeQuoted(rawValue.slice(1, -1), quote), lastLineIndex: lineIndex }
  }

  const valueLines = [rawValue.slice(1)]
  for (let nextLineIndex = lineIndex + 1; nextLineIndex < lines.length; nextLineIndex += 1) {
    const nextLine = lines[nextLineIndex]!.text
    if (endsWithUnescaped(nextLine, quote)) {
      valueLines.push(nextLine.slice(0, -1))
      return {
        value: unescapeQuoted(valueLines.join('\n'), quote),
        lastLineIndex: nextLineIndex,
      }
    }
    valueLines.push(nextLine)
  }

  // Preserve the existing parser's behavior for an unterminated quoted value.
  return { value: rawValue, lastLineIndex: lineIndex }
}

export const parseEnvVarEntries = (content: string): ParsedEnvVar[] => {
  const lines = splitLines(content)
  const entries: ParsedEnvVar[] = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!
    const trimmed = line.text.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const equalsIndex = line.text.indexOf('=')
    if (equalsIndex === -1) continue

    const key = line.text.slice(0, equalsIndex).trim()
    if (!key) continue

    const parsed = parseValue(lines, lineIndex, equalsIndex)
    const lastLine = lines[parsed.lastLineIndex]!
    entries.push({
      envVar: { key, value: parsed.value },
      start: line.start,
      end: lastLine.end,
      hasLineEnding: lastLine.hasLineEnding,
      lineEnding: lastLine.lineEnding,
    })
    lineIndex = parsed.lastLineIndex
  }

  return entries
}

export const parseEnvVars = (content: string): EnvVar[] => parseEnvVarEntries(content).map(({ envVar }) => envVar)

const readEnvFile = (fs: FileSystem.FileSystem, centralEnvFile: string) =>
  fs.exists(centralEnvFile).pipe(Effect.flatMap((exists) => (exists ? fs.readFileString(centralEnvFile) : Effect.succeed(''))))

const validateKey = (key: string) => {
  const normalized = key.trim()
  if (!normalized || normalized.startsWith('#') || /[\r\n=]/.test(normalized)) {
    return Effect.fail(new InvalidEnvVarKeyError({ key }))
  }
  return Effect.succeed(normalized)
}

const newlineFor = (content: string) => (content.includes('\r\n') ? '\r\n' : content.includes('\r') ? '\r' : '\n')

const serialize = (envVar: EnvVar) => {
  const normalizedValue = envVar.value.replace(/\r\n?/g, '\n')
  const needsQuotes = normalizedValue.includes('\n') || normalizedValue !== normalizedValue.trim()
  if (!needsQuotes) return `${envVar.key}=${normalizedValue}`

  const escaped = normalizedValue.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return `${envVar.key}="${escaped}"`
}

export const serializeEnvVars = (envVars: readonly EnvVar[]) =>
  envVars.length === 0 ? '' : envVars.map(serialize).join('\n') + '\n'

const findOccurrenceIndex = (entries: readonly ParsedEnvVar[], key: string, occurrence: number) => {
  let seen = 0
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index]!.envVar.key !== key) continue
    if (seen === occurrence) return index
    seen += 1
  }
  return -1
}

export const setEnvVar = (centralEnvFile: string, envVar: EnvVar, options: SetEnvVarOptions = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const key = yield* validateKey(envVar.key)
    const normalizedEnvVar = { key, value: envVar.value }
    const content = yield* readEnvFile(fs, centralEnvFile)
    const entries = parseEnvVarEntries(content)

    let targetIndex = -1
    if (options.previousKey !== undefined) {
      const previousKey = options.previousKey.trim()
      const occurrence = options.occurrence ?? 0
      targetIndex = findOccurrenceIndex(entries, previousKey, occurrence)
      if (targetIndex === -1) return yield* Effect.fail(new MissingEnvVarError({ key: previousKey }))
    }

    const duplicate = entries.some(
      (entry, index) => index !== targetIndex && entry.envVar.key === normalizedEnvVar.key,
    )
    if (duplicate) return yield* Effect.fail(new DuplicateEnvVarKeyError({ key: normalizedEnvVar.key }))

    const nextContent =
      targetIndex === -1
        ? `${content}${content.length > 0 && !content.endsWith('\n') && !content.endsWith('\r') ? newlineFor(content) : ''}${serialize(normalizedEnvVar)}${newlineFor(content)}`
        : `${content.slice(0, entries[targetIndex]!.start)}${serialize(normalizedEnvVar)}${entries[targetIndex]!.hasLineEnding ? entries[targetIndex]!.lineEnding : ''}${content.slice(entries[targetIndex]!.end)}`

    yield* fs.writeFileString(centralEnvFile, nextContent, { mode: 0o600 })
    return normalizedEnvVar
  })

const targetParts = (target: string | DeleteEnvVarTarget) =>
  typeof target === 'string'
    ? { key: target.trim(), occurrence: 0 }
    : { key: target.key.trim(), occurrence: target.occurrence ?? 0 }

export const deleteEnvVar = (centralEnvFile: string, target: string | DeleteEnvVarTarget) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { key, occurrence } = targetParts(target)
    const content = yield* readEnvFile(fs, centralEnvFile)
    const entries = parseEnvVarEntries(content)
    const targetIndex = findOccurrenceIndex(entries, key, occurrence)
    if (targetIndex === -1) return false

    const entry = entries[targetIndex]!
    yield* fs.writeFileString(centralEnvFile, content.slice(0, entry.start) + content.slice(entry.end))
    return true
  })
