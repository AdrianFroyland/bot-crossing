/**
 * Harness adapter: Cursor (Anysphere) — IDE / Agents Window transcripts.
 *
 * Cursor keeps two stores that do not share ids. This adapter reads only the IDE
 * JSONL under ~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl.
 * The cursor-agent CLI store (~/.cursor/chats) is a different id space: passing an
 * IDE transcript id to `agent --resume` does not open that chat and can clobber
 * the JSONL. Do not add that path here.
 *
 * There is no cursor:// deeplink that navigates to an existing agent thread, so
 * Open / New conversation hand the OS a cursor://file/… URL for the repo folder.
 * Archive is colony-only: Cursor has no isArchived flag on these files, and this
 * adapter never writes Cursor state.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { exists, jsonLines, listDirs, readHead } from '../lib/fsutil.mjs'

const execFileAsync = promisify(execFile)
const HOME = os.homedir()
const PROJECTS = path.join(HOME, '.cursor', 'projects')

const HEAD_BYTES = 192 * 1024
const ACTIVE_WINDOW_MS = 30 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WORKTREE = /[\\/]\.cursor[\\/]worktrees[\\/][^\\/]+[\\/]([^\\/]+)/

function skipSlug(name) {
  if (!name || name.startsWith('.')) return true
  if (/^\d+$/.test(name)) return true
  if (name === 'empty-window' || name === 'canvases' || name === 'mcps') return true
  if (/AppData-Local-Temp/i.test(name)) return true
  return false
}

/**
 * Cursor encodes a workspace path by replacing separators with `-`. Folder names
 * themselves also contain hyphens (Proaktiv-Dokument-Hub), so a global replace
 * is wrong. Walk from the drive / root and take the longest existing child at
 * each step.
 */
async function decodeSlug(slug) {
  const win = /^([a-zA-Z])-(.+)$/.exec(slug)
  let current
  let parts
  if (win) {
    current = `${win[1].toUpperCase()}:\\`
    parts = win[2].split('-')
  } else {
    current = path.sep
    parts = slug.replace(/^-/, '').split('-')
  }
  let i = 0
  while (i < parts.length) {
    let found = null
    for (let j = parts.length; j > i; j--) {
      const candidate = path.join(current, parts.slice(i, j).join('-'))
      if (await exists(candidate)) {
        found = { path: candidate, next: j }
        break
      }
    }
    if (!found) return path.join(current, parts.slice(i).join('-'))
    current = found.path
    i = found.next
  }
  return current
}

const pathCache = new Map()
async function projectPathFor(slug) {
  const cached = pathCache.get(slug)
  if (cached) return cached
  const projectPath = await decodeSlug(slug)
  pathCache.set(slug, projectPath)
  return projectPath
}

function splitWorktree(cwd) {
  const m = WORKTREE.exec(cwd || '')
  if (!m) return { root: cwd, worktree: '' }
  return { root: cwd.slice(0, m.index), worktree: m[1] }
}

function firstText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') return part
      if (part && part.type === 'text' && typeof part.text === 'string') return part.text
    }
  }
  return ''
}

function extractPrompt(text) {
  const raw = String(text)
  const query = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/.exec(raw)
  const body = query ? query[1] : raw.replace(/<timestamp>[\s\S]*?<\/timestamp>/g, ' ')
  return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function readTranscriptMeta(records) {
  const meta = { firstPrompt: '', startedAt: 0 }
  for (const r of records) {
    if (!meta.startedAt && r.timestamp) {
      const t = Date.parse(r.timestamp)
      if (!Number.isNaN(t)) meta.startedAt = t
    }
    if (meta.firstPrompt) continue
    if (r.role !== 'user' || !r.message) continue
    const text = extractPrompt(firstText(r.message.content))
    if (text) meta.firstPrompt = text
  }
  return meta
}

const metaCache = new Map()
async function transcriptMeta(file, id, mtime) {
  const cached = metaCache.get(id)
  if (cached && cached.mtime === mtime) return cached.meta
  let meta
  try {
    meta = readTranscriptMeta(jsonLines(await readHead(file, HEAD_BYTES)))
  } catch {
    meta = readTranscriptMeta([])
  }
  metaCache.set(id, { mtime, meta })
  return meta
}

/** cursor://file/… is what the OS opener can hand Cursor. No chat-id form exists. */
function cursorFileUrl(dir) {
  const slash = String(dir).replace(/\\/g, '/')
  return `cursor://file/${slash}`
}

let cursorRunningCache = { at: 0, running: false }
async function cursorAppRunning() {
  const now = Date.now()
  if (now - cursorRunningCache.at < 15000) return cursorRunningCache.running
  let running = false
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq Cursor.exe', '/NH'], {
        windowsHide: true,
      })
      running = /Cursor\.exe/i.test(stdout)
    } else if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('pgrep', ['-x', 'Cursor'])
      running = Boolean(stdout.trim())
    } else {
      const { stdout } = await execFileAsync('pgrep', ['-x', 'cursor'])
      running = Boolean(stdout.trim())
    }
  } catch {
    running = false
  }
  cursorRunningCache = { at: now, running }
  return running
}

async function scanThreads() {
  const appRunning = await cursorAppRunning()
  const now = Date.now()
  const threads = []

  for (const projectDir of await listDirs(PROJECTS)) {
    const slug = path.basename(projectDir)
    if (skipSlug(slug)) continue
    const transcriptsDir = path.join(projectDir, 'agent-transcripts')
    if (!(await exists(transcriptsDir))) continue

    const projectPath = await projectPathFor(slug)
    const pathExists = await exists(projectPath)
    const { worktree } = splitWorktree(projectPath)
    const project = path.basename(pathExists ? projectPath : projectPath.replace(/\\/g, '/')) || slug

    for (const sessionDir of await listDirs(transcriptsDir)) {
      const sessionId = path.basename(sessionDir)
      if (!UUID.test(sessionId)) continue
      const file = path.join(sessionDir, `${sessionId}.jsonl`)
      let stat
      try {
        stat = await fsp.stat(file)
      } catch {
        continue
      }

      const meta = await transcriptMeta(file, sessionId, stat.mtimeMs)
      const title = meta.firstPrompt
        ? meta.firstPrompt.slice(0, 80)
        : 'Untitled thread'
      threads.push({
        id: `cursor:${sessionId}`,
        title,
        preview: meta.firstPrompt ? meta.firstPrompt.slice(0, 240) : '',
        project,
        projectPath,
        worktree,
        cwd: projectPath,
        gitBranch: '',
        model: '',
        effort: '',
        createdAt: meta.startedAt || stat.birthtimeMs || stat.mtimeMs,
        lastActivityAt: stat.mtimeMs,
        lastFocusedAt: 0,
        running: appRunning && now - stat.mtimeMs < ACTIVE_WINDOW_MS,
        unread: false,
        hasError: false,
        archived: false,
        hasTranscript: true,
        sizeBytes: stat.size,
        source: 'ide',
        canOpen: pathExists,
        canArchive: false,
        ref: { sessionId, projectPath },
      })
    }
  }
  return threads
}

function openThread(ref) {
  const dir = ref?.projectPath
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
    return { ok: false, error: 'No folder on that thread — Cursor has no chat deeplink' }
  }
  return { ok: true, url: cursorFileUrl(dir) }
}

function newSession(dir) {
  return { ok: true, url: cursorFileUrl(dir) }
}

async function setArchived() {
  return {
    ok: false,
    error: 'Cursor agent-transcripts have no archive flag; colony archive still applies',
  }
}

/**
 * Cursor never rewrites an archive flag, so there is nothing to wait for. Returning
 * "now" makes archivePending false on the next scan — the astronaut boards instead of
 * walking to the ship forever.
 */
async function appStartedAt() {
  return Date.now()
}

export default {
  id: 'cursor',
  name: 'Cursor',
  detect: async () => exists(PROJECTS),
  scanThreads,
  openThread,
  newSession,
  setArchived,
  appStartedAt,
  paths: { PROJECTS },
}
