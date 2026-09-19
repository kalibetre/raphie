import { Path } from '@effect/platform'
import { Data, Effect } from 'effect'
import { parseArgs } from 'node:util'
import {
  createVaultProfile,
  deleteVaultEnvVar,
  listVaultEnvVars,
  listVaultProfiles,
  listVaultProjects,
  registerVaultProject,
  resolveVaultProject,
  setVaultDefaultProfile,
  setVaultEnvVar,
  VaultEnvVarError,
  VaultProfileNameError,
  VaultProfileNotFoundError,
  VaultProjectHandleError,
  VaultProjectLocationError,
  VaultProjectNotFoundError,
  VaultProjectResolutionError,
  validateVaultEnvVarKey,
} from '../core/vaultProjects.ts'
import { renderVaultError, type CliIo } from './vault.ts'

class CliUsageError extends Data.TaggedError('CliUsageError')<{ readonly message: string }> {}

const usage = [
  'Usage: raphie project add PATH [--handle HANDLE]',
  '       raphie project list',
  '       raphie profile <create NAME|list|default NAME> [--project HANDLE]',
  '       raphie env <list|add KEY|set KEY|delete KEY --yes> [--project HANDLE] [--profile NAME] [--from-stdin]',
].join('\n')

const mask = '********'

const renderError = (error: unknown) => {
  if (error instanceof CliUsageError || error instanceof VaultEnvVarError) return error.message
  if (error instanceof VaultProjectHandleError) {
    return error.reason === 'invalid'
      ? 'A Project handle must start with a lowercase letter or digit and use only lowercase letters, digits, "-" and "_".'
      : 'A Project with that handle already exists. Choose another --handle.'
  }
  if (error instanceof VaultProjectLocationError) {
    return error.reason === 'duplicate'
      ? 'That location is already registered as a Project. Run `raphie project list`.'
      : 'Project location is not an existing directory.'
  }
  if (error instanceof VaultProjectResolutionError) {
    if (error.reason === 'not-found') return 'No Project has that handle. Run `raphie project list`.'
    return error.reason === 'no-match'
      ? 'The current directory is not inside a registered Project. Pass --project HANDLE.'
      : 'Multiple Projects match this directory. Pass --project HANDLE.'
  }
  if (error instanceof VaultProfileNameError) {
    return error.reason === 'invalid'
      ? 'A Profile name must start with a lowercase letter or digit and use only lowercase letters, digits, "-" and "_".'
      : 'A Profile with that name already exists. Run `raphie profile list`.'
  }
  if (error instanceof VaultProjectNotFoundError) return 'That Project no longer exists. Run `raphie project list`.'
  if (error instanceof VaultProfileNotFoundError) return `Profile "${error.profileName}" was not found. Run \`raphie profile list\`.`
  return renderVaultError(error)
}

const plural = (count: number) => `${count} EnvVar${count === 1 ? '' : 's'}`

export const runProjectCli = (args: readonly string[], io: CliIo) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const usageError = () => new CliUsageError({ message: usage })
    const { values, positionals } = yield* Effect.try({
      try: () =>
        parseArgs({
          args: [...args],
          allowPositionals: true,
          options: {
            handle: { type: 'string' },
            project: { type: 'string' },
            profile: { type: 'string' },
            'from-stdin': { type: 'boolean' },
            yes: { type: 'boolean' },
          },
        }),
      catch: usageError,
    })
    const [resource, command, ...operands] = positionals
    const operand = (count: number) =>
      operands.length === count ? Effect.succeed(operands as string[]) : Effect.fail(usageError())
    const project = resolveVaultProject({ handle: values.project, cwd: io.cwd })

    const readValue = (key: string) =>
      Effect.tryPromise({
        try: () =>
          values['from-stdin']
            ? io.readStdin().then((value) => value.replace(/\r?\n$/, ''))
            : io.readSecret(`Value for ${key}: `),
        catch: () => new CliUsageError({ message: 'Could not read the EnvVar value.' }),
      }).pipe(
        Effect.filterOrFail(
          (value) => value !== '',
          () => new CliUsageError({ message: 'EnvVar value cannot be empty.' }),
        ),
      )

    switch (`${resource} ${command}`) {
      case 'project add': {
        const [folder] = yield* operand(1)
        const registered = yield* registerVaultProject({
          folderPath: path.resolve(io.cwd, folder!),
          handle: values.handle,
        })
        io.write(`Registered Project "${registered.project.handle}" at ${registered.project.folderPath}.`)
        if (registered.envFileFound) io.write('Found a .env file there; Raphie left it untouched.')
        return
      }
      case 'project list': {
        yield* operand(0)
        const projects = yield* listVaultProjects
        if (projects.length === 0) io.write('No Projects registered. Run `raphie project add PATH`.')
        for (const item of projects) io.write(`${item.handle}\t${item.folderPath}\t${item.defaultProfile}`)
        return
      }
      case 'profile create': {
        const [name] = yield* operand(1)
        yield* createVaultProfile((yield* project).id, name!)
        io.write(`Created empty Profile "${name}".`)
        return
      }
      case 'profile list': {
        yield* operand(0)
        for (const profile of yield* listVaultProfiles((yield* project).id)) {
          io.write(`${profile.isDefault ? '*' : ' '} ${profile.name} (${plural(profile.envVarCount)})`)
        }
        return
      }
      case 'profile default': {
        const [name] = yield* operand(1)
        yield* setVaultDefaultProfile((yield* project).id, name!)
        io.write(`Default Profile is now "${name}".`)
        return
      }
      case 'env list': {
        yield* operand(0)
        const resolved = yield* project
        const envVars = yield* listVaultEnvVars(resolved.id, values.profile)
        if (envVars.length === 0) io.write(`No EnvVars in Profile "${values.profile ?? resolved.defaultProfile}".`)
        for (const envVar of envVars) io.write(`${envVar.key}=${mask}`)
        return
      }
      case 'env add':
      case 'env set': {
        const [rawKey] = yield* operand(1)
        const key = yield* validateVaultEnvVarKey(rawKey!)
        const resolved = yield* project
        const exists = (yield* listVaultEnvVars(resolved.id, values.profile)).some((envVar) => envVar.key === key)
        if (command === 'add' && exists) {
          return yield* Effect.fail(
            new VaultEnvVarError({ message: `EnvVar key "${key}" already exists. Use \`raphie env set\` to change it.` }),
          )
        }
        const value = yield* readValue(key)
        yield* setVaultEnvVar(
          resolved.id,
          { key, value },
          { profileName: values.profile, previousKey: exists ? key : undefined },
        )
        io.write(`${exists ? 'Updated' : 'Added'} ${key} in Profile "${values.profile ?? resolved.defaultProfile}".`)
        return
      }
      case 'env delete': {
        const [key] = yield* operand(1)
        if (!values.yes) {
          return yield* Effect.fail(new CliUsageError({ message: 'Deleting an EnvVar needs confirmation. Re-run with --yes.' }))
        }
        const resolved = yield* project
        const deleted = yield* deleteVaultEnvVar(resolved.id, key!, values.profile)
        if (!deleted) {
          return yield* Effect.fail(new VaultEnvVarError({ message: `EnvVar "${key}" was not found. Run \`raphie env list\`.` }))
        }
        io.write(`Deleted ${key} from Profile "${values.profile ?? resolved.defaultProfile}".`)
        return
      }
      default:
        return yield* Effect.fail(usageError())
    }
  }).pipe(
    Effect.as(0),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        io.error(renderError(error))
        return error instanceof CliUsageError ? 2 : 1
      }),
    ),
  )
