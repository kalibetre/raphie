const trimTrailingSeparators = (filePath: string) => {
  if (filePath.length <= 1 || /^[\\/]+$/.test(filePath)) return filePath
  return filePath.replace(/[\\/]+$/, '')
}

/** Git omits the trailing separator that folder pickers may preserve. */
export const isMainWorktreePath = (worktreePath: string, projectFolderPath: string) =>
  trimTrailingSeparators(worktreePath) === trimTrailingSeparators(projectFolderPath)
