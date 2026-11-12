import type { BuildTarget, BuilderSettings } from './types'

export interface BuildTargetDef {
  id: BuildTarget
  label: string
  hint: string
  /** What the finished deliverable must contain. */
  deliverable: string
}

export interface BuildStackDef {
  id: string
  label: string
  hint: string
  targets: BuildTarget[]
  /** Exact toolchain the agent must scaffold so the result builds without guesswork. */
  toolchain: string
}

export const BUILD_TARGETS: BuildTargetDef[] = [
  {
    id: 'web-app',
    label: 'Web app',
    hint: 'Multi-screen product with routing, state and a data layer',
    deliverable: 'a working multi-screen web application with routing, state, forms and error handling',
  },
  {
    id: 'website',
    label: 'Website',
    hint: 'Marketing or landing site with real copy and sections',
    deliverable: 'a polished marketing/landing website with real copy, sections, responsive layout and SEO metadata',
  },
  {
    id: 'desktop-app',
    label: 'Desktop app',
    hint: 'Installable Windows desktop application',
    deliverable: 'an installable desktop application with a native window, menus and packaged build script',
  },
  {
    id: 'api',
    label: 'Backend API',
    hint: 'REST API with validation, persistence and tests',
    deliverable: 'a documented REST API with validated endpoints, persistence, error contracts and tests',
  },
  {
    id: 'mobile-app',
    label: 'Mobile app',
    hint: 'Cross-platform phone app with navigation',
    deliverable: 'a cross-platform mobile app with navigation, screens and offline-friendly state',
  },
  {
    id: 'automation',
    label: 'Automation tool',
    hint: 'Script, CLI or bot that automates real work',
    deliverable: 'a runnable automation tool or CLI with configuration, logging and clear usage docs',
  },
]

export const BUILD_STACKS: BuildStackDef[] = [
  {
    id: 'react-vite',
    label: 'React + Vite + TypeScript',
    hint: 'Fast SPA, Vite dev server, Tailwind optional',
    targets: ['web-app', 'website'],
    toolchain: 'Vite + React 18 + TypeScript, ESM, `npm run dev` / `npm run build`',
  },
  {
    id: 'nextjs',
    label: 'Next.js (App Router) + TypeScript',
    hint: 'SSR/SEO friendly product or site',
    targets: ['web-app', 'website', 'api'],
    toolchain: 'Next.js App Router + TypeScript with route handlers for the API, `npm run dev` / `npm run build`',
  },
  {
    id: 'static',
    label: 'Static HTML + CSS + JS',
    hint: 'Zero dependencies, opens in any browser',
    targets: ['website', 'web-app', 'automation'],
    toolchain: 'plain HTML5, modern CSS and vanilla ES modules — no build step required',
  },
  {
    id: 'vue-vite',
    label: 'Vue 3 + Vite + TypeScript',
    hint: 'Single-file components',
    targets: ['web-app', 'website'],
    toolchain: 'Vite + Vue 3 + TypeScript with single-file components, `npm run dev` / `npm run build`',
  },
  {
    id: 'react-shadcn',
    label: 'React + Tailwind + shadcn/ui (full UI kit)',
    hint: 'Big prebuilt component kit: Radix + shadcn/ui + lucide icons',
    targets: ['web-app', 'website'],
    toolchain: 'Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui (Radix primitives, lucide-react icons, class-variance-authority), `npm run dev` / `npm run build`',
  },
  {
    id: 'next-shadcn',
    label: 'Next.js + Tailwind + shadcn/ui (full UI kit)',
    hint: 'App Router with the same big component kit',
    targets: ['web-app', 'website', 'api'],
    toolchain: 'Next.js App Router + TypeScript + Tailwind CSS + shadcn/ui + lucide-react, `npm run dev` / `npm run build`',
  },
  {
    id: 'react-magicui',
    label: 'React + Tailwind + shadcn/ui + Magic UI',
    hint: 'Animated marketing pages and polished product UI',
    targets: ['web-app', 'website'],
    toolchain: 'Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui + Magic UI + motion (framer-motion), lucide-react, `npm run dev` / `npm run build`',
  },
  {
    id: 'next-magicui',
    label: 'Next.js + Tailwind + shadcn/ui + Magic UI',
    hint: 'App Router with animated Magic UI blocks',
    targets: ['web-app', 'website', 'api'],
    toolchain: 'Next.js App Router + TypeScript + Tailwind CSS + shadcn/ui + Magic UI + motion (framer-motion), `npm run dev` / `npm run build`',
  },
  {
    id: 'react-aceternity',
    label: 'React + Tailwind + Aceternity UI',
    hint: 'Bold animated sections and effects',
    targets: ['web-app', 'website'],
    toolchain: 'Vite + React 18 + TypeScript + Tailwind CSS + Aceternity UI + motion (framer-motion), `npm run dev` / `npm run build`',
  },
  {
    id: 'react-mantine',
    label: 'React + TypeScript + Mantine',
    hint: 'Complete component library with dark mode and forms',
    targets: ['web-app', 'website'],
    toolchain: 'Vite + React 18 + TypeScript + Mantine (@mantine/core, @mantine/hooks, @mantine/form, @mantine/notifications) + Tabler icons, `npm run dev` / `npm run build`',
  },
  {
    id: 'react-mui',
    label: 'React + TypeScript + Material UI',
    hint: 'MUI components, theme and icons',
    targets: ['web-app', 'website'],
    toolchain: 'Vite + React 18 + TypeScript + MUI (@mui/material, @emotion/react, @emotion/styled, @mui/icons-material), `npm run dev` / `npm run build`',
  },
  {
    id: 'react-chakra',
    label: 'React + TypeScript + Chakra UI',
    hint: 'Accessible component system with theme tokens',
    targets: ['web-app', 'website'],
    toolchain: 'Vite + React 18 + TypeScript + Chakra UI + @emotion/react + @emotion/styled + framer-motion, `npm run dev` / `npm run build`',
  },
  {
    id: 'react-heroui',
    label: 'React + Tailwind + HeroUI',
    hint: 'Modern accessible components with motion',
    targets: ['web-app', 'website'],
    toolchain: 'Vite + React 18 + TypeScript + Tailwind CSS + HeroUI + framer-motion, `npm run dev` / `npm run build`',
  },
  {
    id: 'react-daisyui',
    label: 'React + Tailwind + daisyUI',
    hint: 'Fast themed components with CSS variables',
    targets: ['web-app', 'website'],
    toolchain: 'Vite + React 18 + TypeScript + Tailwind CSS + daisyUI, `npm run dev` / `npm run build`',
  },
  {
    id: 'next-flowbite',
    label: 'Next.js + Tailwind + Flowbite React',
    hint: 'App Router with Flowbite components',
    targets: ['web-app', 'website'],
    toolchain: 'Next.js App Router + TypeScript + Tailwind CSS + Flowbite React, `npm run dev` / `npm run build`',
  },
  {
    id: 'vue-nuxt',
    label: 'Nuxt 3 + TypeScript + Nuxt UI',
    hint: 'Vue full-stack with Nuxt UI and Tailwind',
    targets: ['web-app', 'website', 'api'],
    toolchain: 'Nuxt 3 + TypeScript + Tailwind CSS + Nuxt UI, `npm run dev` / `npm run build`',
  },
  {
    id: 'svelte-skeleton',
    label: 'SvelteKit + TypeScript + Skeleton',
    hint: 'Svelte app with Skeleton UI and Tailwind',
    targets: ['web-app', 'website'],
    toolchain: 'SvelteKit + TypeScript + Tailwind CSS + Skeleton UI, `npm run dev` / `npm run build`',
  },
  {
    id: 'node-api',
    label: 'Node.js + Express + TypeScript',
    hint: 'REST API with JSON persistence',
    targets: ['api', 'automation'],
    toolchain: 'Node.js + Express + TypeScript, `npm run dev` / `npm run build` / `npm test`',
  },
  {
    id: 'electron',
    label: 'Electron + React + TypeScript',
    hint: 'Windows desktop shell with a renderer',
    targets: ['desktop-app'],
    toolchain: 'Electron main/preload + React renderer + TypeScript build scripts',
  },
  {
    id: 'expo',
    label: 'React Native (Expo) + TypeScript',
    hint: 'Android/iOS from one codebase',
    targets: ['mobile-app'],
    toolchain: 'Expo + React Native + TypeScript with `npx expo start`',
  },
  {
    id: 'python',
    label: 'Python 3 + Typer CLI',
    hint: 'Automation, scripts and data work',
    targets: ['automation', 'api'],
    toolchain: 'Python 3 with a `requirements.txt`, a CLI entry point and pytest tests',
  },
]

export const DEFAULT_BUILDER: BuilderSettings = {
  target: 'web-app',
  stack: 'react-vite',
  installDeps: true,
  host: 'local',
}

export function stacksForTarget(target: BuildTarget): BuildStackDef[] {
  const matches = BUILD_STACKS.filter((stack) => stack.targets.includes(target))
  return matches.length ? matches : BUILD_STACKS
}

export function stackById(id: string): BuildStackDef {
  return BUILD_STACKS.find((stack) => stack.id === id) || BUILD_STACKS[0]
}

export function targetById(id: BuildTarget): BuildTargetDef {
  return BUILD_TARGETS.find((target) => target.id === id) || BUILD_TARGETS[0]
}

export interface BuildBrief {
  name: string
  target: BuildTarget
  stack: string
  /** Free-form description of what the user wants. */
  brief: string
  installDeps: boolean
  /** Local = runs on this PC at localhost. Online = deploy-ready build. */
  host?: 'local' | 'online'
}

/**
 * The instruction sent to the agent in BUILD mode. It carries the chosen
 * deliverable, the toolchain and the quality bar, so the agent scaffolds the
 * whole project instead of answering with a plan.
 */
export function buildPrompt(input: BuildBrief): string {
  const target = targetById(input.target)
  const stack = stackById(input.stack)
  const host = input.host || 'local'
  const brief = input.brief.trim() || `a ${target.label.toLowerCase()} called ${input.name}`
  return [
    `Build a complete, production-quality ${target.deliverable} in this folder.`,
    '',
    `Project name: ${input.name}`,
    `Deliverable: ${target.deliverable}`,
    `Stack: ${stack.label} — ${stack.toolchain}`,
    '',
    '## Brief',
    brief,
    '',
    '## What to produce',
    `- Every file the app needs, written in full: entry point, routes/screens, components, styles, types, state, assets and config.`,
    '- A `package.json` (or `requirements.txt`) with real scripts — `dev`, `build`, `test` when the stack supports them — and pinned, currently maintained dependencies.',
    '- A `README.md` with what it is, how to install, how to run, and the folder map.',
    '- A `.gitignore` and a minimal `.env.example` if any configuration is needed. Never write real secrets.',
    `- ${input.installDeps ? 'Install the dependencies with run_command and make the build pass.' : 'Do not install dependencies; the user will run the install command.'}`,
    '',
    '## Quality bar',
    '- Real, specific content — no lorem ipsum, no placeholder "TODO" screens and no empty components.',
    '- Responsive layout that works at 360px and 1440px, keyboard accessible controls, visible focus states and sensible contrast.',
    '- A cohesive design system: CSS variables for colour, an 8px spacing scale, a typography scale, radii and shadows, reused everywhere. Polished buttons/cards/inputs with hover and focus states, subtle 150–250ms transitions and a sticky header.',
    '- Loading, empty and error states for anything that fetches or computes data.',
    '- Input validation at the trust boundary and no secret, path or query built from unvalidated user input.',
    '- Clean separation: UI, domain logic and data access in different modules.',
    '',
    '## Where it runs',
    host === 'online'
      ? '- Deploy-ready: the production build must produce a clean static/serverless output with no local-only paths or secrets, plus exact deploy steps for Vercel, Netlify or Cloudflare Pages in the README.'
      : '- Local first: it must run on this machine with `npm run dev` on a fixed port (5173, 3000 or 8080) and open at http://localhost:<port>. Add a `start` script and a quick-start section with the exact URL.',
    host === 'online'
      ? '- Do not depend on a running local server, a hard-coded localhost API or files outside the project.'
      : '- After writing the files, start the dev server once with run_command, check that http://localhost:<port> answers, then stop it and report the URL to the user.',
    '',
    '## Working method',
    '- The project folder already exists and is open. Do NOT create or cd into a nested folder with the project name; write every file at the project root.',
    '1. Create the folder structure first, then write files with `write_file` (never print code for the user to paste).',
    input.installDeps
      ? '2. Run the install command, then the build/test command. Read the real output and fix every failure until it passes.'
      : '2. Verify the files are consistent by reading them back; skip installs.',
    '3. Finish with: the folder map, the exact commands to run it, what you verified, and what is intentionally out of scope.',
  ].join('\n')
}
