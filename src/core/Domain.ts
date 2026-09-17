export interface Project {
  readonly id: string
  readonly name: string
  readonly folderPath: string
  readonly centralEnvFile: string
}

export interface Worktree {
  readonly path: string
  readonly linked: boolean
}

export interface EnvVar {
  readonly key: string
  readonly value: string
}
