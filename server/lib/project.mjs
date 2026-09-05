/**
 * Normalize an absolute workspace path into colony project fields.
 *
 * Shared by harness adapters so worktrees and multi-root workspace slugs collapse onto
 * the parent repo name the map keys on.
 */
import fs from 'node:fs'
import path from 'node:path'

const CLAUDE_WORKTREE = /[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/
const CURSOR_WORKTREE = /[\\/]\.cursor[\\/]worktrees[\\/][^\\/]+[\\/]([^\\/]+)/
const EXTERNAL_CLAUDE = /[\\/]claude-worktrees[\\/]([^\\/]+)$/i
const EXTERNAL_CURSOR = /[\\/]cursor-worktrees[\\/]([^\\/]+)$/i
const PREFIXED_CLAUDE = /^claude-worktrees-(.+)$/i
const PREFIXED_CURSOR = /^cursor-worktrees-(.+)$/i
const CODE_WORKSPACE = /-code-workspace$/i

function pathExists(candidate) {
  try {
    return fs.existsSync(candidate)
  } catch {
    return false
  }
}

/**
 * `Proaktiv-Dokument-Hub-hub-mal-s1-gate` → project `Proaktiv-Dokument-Hub`,
 * worktree `hub-mal-s1-gate`, when a matching repo folder exists nearby.
 */
function splitRepoFromCombined(rest, searchParent) {
  const parts = rest.split('-')
  for (let i = parts.length - 1; i >= 1; i--) {
    const project = parts.slice(0, i).join('-')
    const worktree = parts.slice(i).join('-')
    if (!project || !worktree) continue
    const parent = searchParent || ''
    const candidates = [
      path.join(parent, project),
      path.join(parent, 'Documents', project),
      path.join(parent, '..', 'Documents', project),
      path.join(parent, '..', project),
    ]
    for (const candidate of candidates) {
      if (pathExists(candidate)) {
        return { project, worktree, projectPath: path.resolve(candidate) }
      }
    }
  }
  return null
}

function externalWorktree(root, folder) {
  const parsed = splitRepoFromCombined(folder, root)
  if (parsed) return { root: parsed.projectPath, worktree: parsed.worktree, project: parsed.project }
  const dash = folder.lastIndexOf('-')
  if (dash > 0) {
    const project = folder.slice(0, dash)
    const worktree = folder.slice(dash + 1)
    if (project && worktree) return { root, worktree, project }
  }
  return { root, worktree: folder, project: folder }
}

function splitEmbeddedWorktree(cwd) {
  const normalized = String(cwd || '').replace(/\//g, path.sep)
  let m = CLAUDE_WORKTREE.exec(normalized)
  if (m) return { root: normalized.slice(0, m.index), worktree: m[1] }
  m = CURSOR_WORKTREE.exec(normalized)
  if (m) return { root: normalized.slice(0, m.index), worktree: m[1] }
  m = EXTERNAL_CLAUDE.exec(normalized)
  if (m) return externalWorktree(normalized, m[1])
  m = EXTERNAL_CURSOR.exec(normalized)
  if (m) return externalWorktree(normalized, m[1])

  const base = path.basename(normalized)
  m = PREFIXED_CURSOR.exec(base) || PREFIXED_CLAUDE.exec(base)
  if (m) {
    const parent = path.dirname(normalized)
    const parsed = splitRepoFromCombined(m[1], parent)
    if (parsed) {
      return { root: parsed.projectPath, worktree: parsed.worktree, project: parsed.project }
    }
    return externalWorktree(parent, m[1])
  }

  return { root: normalized, worktree: '' }
}

function stripCodeWorkspace(name) {
  if (!name) return name
  return name.replace(CODE_WORKSPACE, '')
}

/**
 * @param {string} cwd Absolute path to the workspace folder (decoded from a Cursor slug, etc.)
 * @param {string} [originCwd] Optional canonical repo root from harness metadata
 * @returns {{ projectPath: string, project: string, worktree: string }}
 */
export function projectOf(cwd, originCwd = '') {
  const split = splitEmbeddedWorktree(cwd || '')
  const projectPath = originCwd || split.root || cwd || ''
  let project = split.project || path.basename(projectPath) || projectPath || 'unknown'
  project = stripCodeWorkspace(project)
  return { projectPath, project, worktree: split.worktree || '' }
}
