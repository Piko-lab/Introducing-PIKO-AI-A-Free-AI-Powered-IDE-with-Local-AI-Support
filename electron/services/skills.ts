import fs from 'node:fs'
import path from 'node:path'
import type { Skill } from '../../src/shared/types'
import { userData } from '../constants'
import { ensureDir, uuid } from '../util'

export type { Skill }

const skillsDir = (): string => path.join(userData(), 'skills')

const BUILTINS: Skill[] = [
  {
    id: 'pro-ui',
    name: 'Professional UI',
    description: 'Design-system discipline for polished, responsive interfaces.',
    prompt: 'Apply a cohesive design system: CSS variables for colour, an 8px spacing scale, a typography scale, radii and shadows. Centred max-width container, sticky header, breakpoints at 768/480px. Buttons/cards/inputs with hover and visible focus states, 150-250ms transitions, real copy (no lorem ipsum), WCAG AA contrast and semantic landmarks.',
    enabled: true,
    builtin: true,
  },
  {
    id: 'api-design',
    name: 'API design',
    description: 'Consistent REST contracts, validation and error shapes.',
    prompt: 'Design REST endpoints with plural nouns, correct status codes and a single error contract {error:{code,message}}. Validate every input at the boundary, paginate list endpoints, and document each route with method, path, params and example response.',
    enabled: false,
    builtin: true,
  },
  {
    id: 'test-writer',
    name: 'Test writer',
    description: 'Adds real, runnable tests for what was built.',
    prompt: 'After implementing, write runnable tests for the core behaviour (happy path + one edge case + one failure case) using the project\'s existing test runner. Run them and fix failures before reporting done.',
    enabled: false,
    builtin: true,
  },
]

function readSkill(file: string): Skill | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Skill>
    if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
    return {
      id: raw.id,
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description : '',
      prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
      enabled: raw.enabled === true,
      builtin: raw.builtin === true,
    }
  } catch {
    return null
  }
}

export function listSkills(): Skill[] {
  const dir = skillsDir()
  ensureDir(dir)
  let files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  if (!files.length) {
    for (const skill of BUILTINS) fs.writeFileSync(path.join(dir, `${skill.id}.json`), JSON.stringify(skill, null, 2))
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  }
  const skills = files.map((f) => readSkill(path.join(dir, f))).filter((s): s is Skill => !!s)
  return skills.sort((a, b) => Number(b.builtin === true) - Number(a.builtin === true) || a.name.localeCompare(b.name))
}

export function saveSkill(input: Partial<Skill> & { name: string; prompt: string }): Skill {
  const dir = skillsDir()
  ensureDir(dir)
  const existing = input.id ? listSkills().find((s) => s.id === input.id) : undefined
  const skill: Skill = {
    id: existing?.id || input.id || uuid(),
    name: input.name.trim() || 'Untitled skill',
    description: (input.description || existing?.description || '').trim(),
    prompt: input.prompt,
    enabled: input.enabled ?? existing?.enabled ?? true,
    builtin: existing?.builtin === true,
  }
  fs.writeFileSync(path.join(dir, `${skill.id}.json`), JSON.stringify(skill, null, 2))
  return skill
}

export function deleteSkill(id: string): void {
  const skill = listSkills().find((s) => s.id === id)
  if (!skill || skill.builtin) return
  try { fs.rmSync(path.join(skillsDir(), `${id}.json`), { force: true }) } catch { /* ignore */ }
}

export function enabledSkills(): Skill[] {
  return listSkills().filter((s) => s.enabled && s.prompt.trim())
}

/** Render a specific set of skills into the system-prompt block. */
export function formatSkills(skills: Skill[]): string {
  const active = skills.filter((s) => s.prompt.trim())
  if (!active.length) return ''
  return `\n## Active skills\n${active.map((s) => `### ${s.name}\n${s.prompt}`).join('\n')}`
}

/** Injected into the agent system prompt so selected skills shape every task. */
export function skillsPrompt(): string {
  return formatSkills(enabledSkills())
}