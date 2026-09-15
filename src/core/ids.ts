/** Short UUID, stable across a Project's renames/moves. Pure — no I/O, no Effect. */
export const generateProjectId = (): string => crypto.randomUUID().slice(0, 8)
