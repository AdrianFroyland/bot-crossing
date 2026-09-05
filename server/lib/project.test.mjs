import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { projectOf } from './project.mjs'

test('cursor embedded worktree collapses to parent repo', () => {
  const cwd = path.join('C:', 'repo', '.cursor', 'worktrees', 'abc123', 'feature-x')
  const { projectPath, project, worktree } = projectOf(cwd)
  assert.equal(projectPath, path.join('C:', 'repo'))
  assert.equal(project, 'repo')
  assert.equal(worktree, 'feature-x')
})

test('claude embedded worktree collapses to parent repo', () => {
  const cwd = path.join('C:', 'repo', '.claude', 'worktrees', 'feature-y')
  const { projectPath, project, worktree } = projectOf(cwd)
  assert.equal(projectPath, path.join('C:', 'repo'))
  assert.equal(project, 'repo')
  assert.equal(worktree, 'feature-y')
})

test('external claude-worktrees folder splits repo and worktree name', () => {
  const cwd = path.join('C:', 'Users', 'me', 'claude-worktrees', 'Proaktiv-Dokument-Hub-estates')
  const { project, worktree } = projectOf(cwd)
  assert.equal(project, 'Proaktiv-Dokument-Hub')
  assert.equal(worktree, 'estates')
})

test('code-workspace suffix is stripped from project name', () => {
  const cwd = path.join('C:', 'Users', 'me', 'Proaktiv-Dokument-Hub-code-workspace')
  const { project } = projectOf(cwd)
  assert.equal(project, 'Proaktiv-Dokument-Hub')
})

test('hyphenated cursor-worktrees folder collapses when repo exists in Documents', () => {
  const cwd = path.join('C:', 'Users', 'Adrian', 'cursor-worktrees-Proaktiv-Dokument-Hub-hub-mal-s1-gate')
  const { project, worktree } = projectOf(cwd)
  assert.equal(project, 'Proaktiv-Dokument-Hub')
  assert.equal(worktree, 'hub-mal-s1-gate')
})
