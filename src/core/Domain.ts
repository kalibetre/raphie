export interface Project {
  readonly id: string
  readonly name: string
  readonly folderPath: string
  readonly centralEnvFile: string
}

export interface EnvVar {
  readonly key: string
  readonly value: string
}
