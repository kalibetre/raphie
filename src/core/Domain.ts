export interface Project {
  readonly id: string
  readonly name: string
  readonly folderPath: string
  readonly centralEnvFile: string
}

export interface WorktreeCommit {
  readonly hash: string
  readonly subject: string
  readonly date: string
}

export interface Worktree {
  readonly path: string
  readonly linked: boolean
  readonly size: number
  readonly branch: string | null
  readonly lastCommit: WorktreeCommit | null
  readonly stagedChanges: number
  readonly unstagedChanges: number
}

export interface EnvVar {
  readonly key: string
  readonly value: string
}
