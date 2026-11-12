import { load, type CheerioAPI } from 'cheerio'
import { getSettings, getSearchKey } from '../settings'
import { validateUrl } from '../security/urlGuard'
import { log, truncate } from '../util'
import { detectLanguage } from '../ai/language'
import { LANGUAGE_BY_ID } from '../../src/shared/languages'

export interface FetchResult {
  url: string
  status: number
  headers: Record<string, string>
  body: Buffer
  contentType: string
}

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  source: string
}

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) PikoAI/1.0 Chrome/124.0 Safari/537.36'

export async function safeFetch(
  input: string,
  options: {
    maxBytes?: number
    timeoutMs?: number
    allowPrivateNetwork?: boolean
    sameOrigin?: boolean
    headers?: Record<string, string>
    method?: string
    body?: string
  } = {},
): Promise<FetchResult> {
  const maxBytes = options.maxBytes ?? 5_000_000
  const timeoutMs = options.timeoutMs ?? 25_000
  let current = input
  for (let redirect = 0; redirect <= 5; redirect++) {
    const url = await validateUrl(current, {
      allowPrivateNetwork: options.allowPrivateNetwork ?? getSettings().allowPrivateNetwork,
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: options.method || 'GET',
        redirect: 'manual',
        headers: {
          'user-agent': DEFAULT_UA,
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
          'accept-language': 'en-US,en;q=0.9',
          ...options.headers,
        },
        body: options.body,
        signal: controller.signal,
      })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) throw new Error(`Redirect ${res.status} without Location header`)
        const next = new URL(location, url)
        await res.body?.cancel()
        if (options.sameOrigin && next.origin !== url.origin) throw new Error('Cross-origin redirect blocked')
        current = next.toString()
        continue
      }
      const contentType = res.headers.get('content-type') || ''
      const declared = Number(res.headers.get('content-length') || 0)
      if (declared > maxBytes) throw new Error(`Response too large (${declared} bytes; limit ${maxBytes})`)
      if (!res.body) {
        return { url: url.toString(), status: res.status, headers: Object.fromEntries(res.headers.entries()), body: Buffer.alloc(0), contentType }
      }
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          total += value.byteLength
          if (total > maxBytes) {
            await reader.cancel()
            throw new Error(`Response exceeded size limit (${maxBytes} bytes)`)
          }
          chunks.push(value)
        }
      }
      if (res.status >= 400) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url.toString()}`)
      }
      return {
        url: url.toString(),
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: Buffer.concat(chunks.map((c) => Buffer.from(c))),
        contentType,
      }
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('Too many redirects (limit 5)')
}

const robotsCache = new Map<string, { expires: number; rules: { allow: string[]; disallow: string[] } }>()

export async function robotsAllows(target: string): Promise<{ allowed: boolean; reason?: string }> {
  if (!getSettings().respectRobots) return { allowed: true }
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return { allowed: false, reason: 'Invalid URL' }
  }
  const origin = url.origin
  const cached = robotsCache.get(origin)
  if (cached && cached.expires > Date.now()) {
    return evaluateRobots(cached.rules, url.pathname)
  }
  try {
    const res = await safeFetch(new URL('/robots.txt', origin).toString(), { maxBytes: 500_000, timeoutMs: 8000 })
    const text = res.body.toString('utf8')
    const rules = parseRobots(text)
    robotsCache.set(origin, { expires: Date.now() + 600_000, rules })
    return evaluateRobots(rules, url.pathname)
  } catch {
    // Unreachable robots.txt is treated as no restrictions, matching browser behavior.
    return { allowed: true, reason: 'robots.txt unreachable' }
  }
}

function parseRobots(text: string): { allow: string[]; disallow: string[] } {
  const allow: string[] = []
  const disallow: string[] = []
  let applies = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (key === 'user-agent') {
      const ua = value.toLowerCase()
      applies = ua === '*' || ua.includes('piko') || ua.includes('opencode')
    } else if (applies && key === 'allow') {
      if (value) allow.push(value)
    } else if (applies && key === 'disallow') {
      if (value) disallow.push(value)
    }
  }
  return { allow, disallow }
}

function evaluateRobots(rules: { allow: string[]; disallow: string[] }, path: string): { allowed: boolean; reason?: string } {
  const matchLen = (pattern: string): number => {
    if (pattern === '/') return path === '/' ? 1 : 0
    const clean = pattern.replace(/\*.*$/, '')
    return path.startsWith(clean) ? clean.length : 0
  }
  const allowLen = Math.max(0, ...rules.allow.map(matchLen))
  const disallowLen = Math.max(0, ...rules.disallow.map(matchLen))
  if (disallowLen > allowLen) {
    return { allowed: false, reason: 'Blocked by the site robots.txt' }
  }
  return { allowed: true }
}

export interface PageLink {
  text: string
  href: string
  internal: boolean
}

export interface DesignTokens {
  colors: { value: string; count: number }[]
  fonts: string[]
  fontSizes: string[]
  radii: string[]
  shadows: string[]
  spacing: string[]
  breakpoints: string[]
  layout: string[]
  animations: string[]
}

export interface PageContent {
  url: string
  finalUrl: string
  title: string
  description: string
  language: string
  status: number
  headings: { level: number; text: string }[]
  text: string
  links: PageLink[]
  images: { src: string; alt: string | null }[]
  forms: { action: string; method: string; fields: string[] }[]
  buttons: string[]
  scripts: string[]
  stylesheets: string[]
  meta: Record<string, string>
  technologies: string[]
  design: DesignTokens
  accessibility: { issue: string; detail: string }[]
  interactions: string[]
  cssSample: string
  contentLength: number
  fetchedAt: string
}

export async function fetchPage(input: string, options: { fetchCss?: boolean; maxCssFiles?: number } = {}): Promise<PageContent> {
  const robots = await robotsAllows(input)
  if (!robots.allowed) throw new Error(robots.reason || 'Blocked by robots.txt')
  const res = await safeFetch(input, { maxBytes: 6_000_000 })
  const contentType = res.contentType.toLowerCase()
  const finalUrl = res.url
  if (!contentType.includes('html') && !contentType.includes('xhtml')) {
    const text = res.body.toString('utf8')
    return {
      url: input,
      finalUrl,
      title: new URL(finalUrl).pathname,
      description: '',
      language: 'unknown',
      status: res.status,
      headings: [],
      text: truncate(text, 200_000),
      links: [],
      images: [],
      forms: [],
      buttons: [],
      scripts: [],
      stylesheets: [],
      meta: {},
      technologies: [],
      design: emptyDesign(),
      accessibility: [],
      interactions: [],
      cssSample: '',
      contentLength: res.body.length,
      fetchedAt: new Date().toISOString(),
    }
  }
  const html = res.body.toString('utf8')
  const $ = load(html)
  const baseHref = $('base[href]').attr('href')
  const base = baseHref ? new URL(baseHref, finalUrl).toString() : finalUrl
  const absolute = (href: string | undefined): string => {
    if (!href) return ''
    try {
      return new URL(href, base).toString()
    } catch {
      return href
    }
  }

  const meta: Record<string, string> = {}
  $('meta').each((_, el) => {
    const name = $(el).attr('name') || $(el).attr('property') || $(el).attr('http-equiv')
    const content = $(el).attr('content')
    if (name && content) meta[name.toLowerCase()] = content
  })

  const headings: { level: number; text: string }[] = []
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const tag = (el as unknown as { tagName?: string }).tagName || 'h2'
    const level = Number(tag.replace('h', '')) || 2
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    if (text) headings.push({ level, text })
  })

  const links: PageLink[] = []
  const seenLinks = new Set<string>()
  $('a[href]').each((_, el) => {
    const href = absolute($(el).attr('href'))
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return
    if (seenLinks.has(href)) return
    seenLinks.add(href)
    let internal = false
    try { internal = new URL(href).origin === new URL(finalUrl).origin } catch { /* ignore */ }
    links.push({ text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 180), href, internal })
  })

  const images: { src: string; alt: string | null }[] = []
  $('img').each((_, el) => {
    const src = absolute($(el).attr('src') || $(el).attr('data-src'))
    if (src) images.push({ src, alt: $(el).attr('alt') ?? null })
  })

  const forms: { action: string; method: string; fields: string[] }[] = []
  $('form').each((_, el) => {
    const fields: string[] = []
    $(el).find('input,select,textarea').each((__, f) => {
      const name = $(f).attr('name') || $(f).attr('id') || $(f).attr('type') || 'field'
      fields.push(name)
    })
    forms.push({
      action: absolute($(el).attr('action')),
      method: ($(el).attr('method') || 'get').toUpperCase(),
      fields,
    })
  })

  const buttons: string[] = []
  $('button, [role="button"], input[type="submit"], input[type="button"]').each((_, el) => {
    const text = ($(el).text() || $(el).attr('value') || $(el).attr('aria-label') || '').replace(/\s+/g, ' ').trim()
    if (text && buttons.length < 80) buttons.push(text)
  })

  const scripts: string[] = []
  $('script[src]').each((_, el) => {
    const src = absolute($(el).attr('src'))
    if (src) scripts.push(src)
  })

  const stylesheets: string[] = []
  $('link[rel~="stylesheet"]').each((_, el) => {
    const href = absolute($(el).attr('href'))
    if (href) stylesheets.push(href)
  })

  const inlineStyles = $('style').map((_, el) => $(el).text()).get().join('\n')
  const bodyClass = $('body').attr('class') || ''
  const inlineStyleAttrs = $('[style]').map((_, el) => $(el).attr('style') || '').get().join(';')

  let cssText = inlineStyles + '\n' + inlineStyleAttrs
  if (options.fetchCss !== false) {
    const maxCss = options.maxCssFiles ?? 6
    const sameOrigin = stylesheets.filter((href) => {
      try { return new URL(href).origin === new URL(finalUrl).origin } catch { return false }
    }).slice(0, maxCss)
    for (const href of sameOrigin) {
      try {
        const cssRes = await safeFetch(href, { maxBytes: 900_000, timeoutMs: 12000 })
        cssText += '\n/* ' + href + ' */\n' + cssRes.body.toString('utf8')
      } catch (err) {
        log('web', `stylesheet fetch failed ${href}`, String(err))
      }
    }
  }

  const design = analyzeDesign(cssText, $, bodyClass)
  const text = extractReadableText($)
  const technologies = detectTechnologies(html, res.headers, scripts, stylesheets, meta)
  const accessibility = analyzeAccessibility($, meta)
  const interactions = detectInteractions($, scripts)

  return {
    url: input,
    finalUrl,
    title: $('title').text().trim() || meta['og:title'] || finalUrl,
    description: meta['description'] || meta['og:description'] || '',
    language: $('html').attr('lang') || meta['language'] || 'unknown',
    status: res.status,
    headings: headings.slice(0, 160),
    text: truncate(text, 180_000),
    links: links.slice(0, 300),
    images: images.slice(0, 120),
    forms,
    buttons,
    scripts,
    stylesheets,
    meta,
    technologies,
    design,
    accessibility,
    interactions,
    cssSample: truncate(cssText, 120_000),
    contentLength: res.body.length,
    fetchedAt: new Date().toISOString(),
  }
}

function emptyDesign(): DesignTokens {
  return { colors: [], fonts: [], fontSizes: [], radii: [], shadows: [], spacing: [], breakpoints: [], layout: [], animations: [] }
}

export function extractReadableText($: CheerioAPI): string {
  const clone = load($.html())
  clone('script,style,noscript,svg,template,iframe').remove()
  const candidates = [clone('main').first(), clone('article').first(), clone('[role="main"]').first(), clone('body').first()]
  let best = ''
  for (const candidate of candidates) {
    if (!candidate.length) continue
    const text = candidate.text().replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    if (text.length > best.length) best = text
  }
  return best
}

export function analyzeDesign(css: string, $: CheerioAPI, bodyClass: string): DesignTokens {
  const colorCounts = new Map<string, number>()
  const colorRegex = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g
  for (const match of css.match(colorRegex) || []) {
    const key = match.toLowerCase()
    colorCounts.set(key, (colorCounts.get(key) || 0) + 1)
  }
  const colors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([value, count]) => ({ value, count }))

  const fonts = unique(css.match(/font-family\s*:\s*([^;{}]+)/gi)?.map((m) => m.split(':').slice(1).join(':').trim()) || []).slice(0, 12)
  const fontSizes = unique(css.match(/font-size\s*:\s*([^;{}]+)/gi)?.map((m) => m.split(':')[1]?.trim() || '') || []).filter(Boolean).slice(0, 20)
  const radii = unique(css.match(/border-radius\s*:\s*([^;{}]+)/gi)?.map((m) => m.split(':')[1]?.trim() || '') || []).filter(Boolean).slice(0, 15)
  const shadows = unique(css.match(/box-shadow\s*:\s*([^;{}]+)/gi)?.map((m) => m.split(':')[1]?.trim() || '') || []).filter(Boolean).slice(0, 12)
  const spacing = unique(css.match(/(?:margin|padding|gap)\s*:\s*([^;{}]+)/gi)?.map((m) => m.split(':')[1]?.trim() || '') || []).filter(Boolean).slice(0, 20)
  const breakpoints = unique(css.match(/@media[^{]+/gi)?.map((m) => m.trim()) || []).slice(0, 15)
  const layout: string[] = []
  if (/display\s*:\s*grid/i.test(css)) layout.push('CSS Grid')
  if (/display\s*:\s*flex/i.test(css)) layout.push('Flexbox')
  if (/position\s*:\s*sticky/i.test(css)) layout.push('Sticky positioning')
  if (/position\s*:\s*fixed/i.test(css)) layout.push('Fixed positioning')
  if (/container-type\s*:/i.test(css)) layout.push('Container queries')
  if (/clamp\(/i.test(css)) layout.push('Fluid clamp() sizing')
  if (/backdrop-filter/i.test(css)) layout.push('Backdrop blur / glassmorphism')
  if (/(dark|night)/i.test(bodyClass) || /prefers-color-scheme\s*:\s*dark/i.test(css)) layout.push('Dark mode support')
  const animations = unique(css.match(/@keyframes\s+([a-zA-Z0-9_-]+)/g)?.map((m) => m.replace('@keyframes', '').trim()) || []).slice(0, 20)
  if (/transition\s*:/i.test(css)) animations.push('CSS transitions')
  if (/animation\s*:/i.test(css)) animations.push('CSS keyframe animations')
  if (/scroll-behavior\s*:\s*smooth/i.test(css)) animations.push('Smooth scrolling')
  const hasHero = $('header').length > 0 || /hero/i.test($.html())
  if (hasHero) layout.push('Hero / header composition')
  if ($('nav').length || $('[role="navigation"]').length) layout.push('Navigation bar')
  if ($('footer').length) layout.push('Footer')
  return { colors, fonts, fontSizes, radii, shadows, spacing, breakpoints, layout, animations }
}

export function detectTechnologies(html: string, headers: Record<string, string>, scripts: string[], stylesheets: string[], meta: Record<string, string>): string[] {
  const tech = new Set<string>()
  const haystack = (html + '\n' + scripts.join('\n') + '\n' + stylesheets.join('\n')).toLowerCase()
  const generator = (meta['generator'] || '').toLowerCase()
  if (generator) tech.add(meta['generator'])
  if (haystack.includes('/_next/') || generator.includes('next.js')) tech.add('Next.js')
  if (haystack.includes('__nuxt') || haystack.includes('/_nuxt/')) tech.add('Nuxt')
  if (haystack.includes('data-reactroot') || haystack.includes('react-dom') || /react(?:\.production|@18|@19)/.test(haystack)) tech.add('React')
  if (haystack.includes('vue.js') || haystack.includes('data-v-') || haystack.includes('__vue__')) tech.add('Vue')
  if (haystack.includes('ng-version') || haystack.includes('angular')) tech.add('Angular')
  if (haystack.includes('svelte')) tech.add('Svelte')
  if (haystack.includes('tailwind')) tech.add('Tailwind CSS')
  if (haystack.includes('bootstrap')) tech.add('Bootstrap')
  if (haystack.includes('jquery')) tech.add('jQuery')
  if (haystack.includes('gsap')) tech.add('GSAP')
  if (haystack.includes('three.js') || haystack.includes('three.module')) tech.add('Three.js')
  if (haystack.includes('framer-motion') || haystack.includes('framer')) tech.add('Framer Motion')
  if (haystack.includes('wordpress') || haystack.includes('wp-content')) tech.add('WordPress')
  if (haystack.includes('shopify')) tech.add('Shopify')
  if (haystack.includes('webflow')) tech.add('Webflow')
  if (haystack.includes('wix.com')) tech.add('Wix')
  if (haystack.includes('squarespace')) tech.add('Squarespace')
  if (haystack.includes('cloudflare')) tech.add('Cloudflare')
  if (haystack.includes('google-analytics') || haystack.includes('googletagmanager')) tech.add('Google Analytics / Tag Manager')
  if (haystack.includes('vercel')) tech.add('Vercel')
  if (haystack.includes('aws') || haystack.includes('amazonaws')) tech.add('AWS')
  if (haystack.includes('stripe')) tech.add('Stripe')
  if (haystack.includes('docusaurus')) tech.add('Docusaurus')
  if (haystack.includes('vitepress')) tech.add('VitePress')
  if (haystack.includes('mkdocs')) tech.add('MkDocs')
  if (haystack.includes('algolia')) tech.add('Algolia')
  if (headers['server']) tech.add(`Server: ${headers['server']}`)
  if (headers['x-powered-by']) tech.add(`X-Powered-By: ${headers['x-powered-by']}`)
  return [...tech]
}

function analyzeAccessibility($: CheerioAPI, meta: Record<string, string>): { issue: string; detail: string }[] {
  const issues: { issue: string; detail: string }[] = []
  if (!$('html').attr('lang')) issues.push({ issue: 'Missing document language', detail: '<html> has no lang attribute.' })
  const imgs = $('img')
  const noAlt = imgs.filter((_, el) => !$(el).attr('alt')).length
  if (noAlt > 0) issues.push({ issue: 'Images without alt text', detail: `${noAlt} of ${imgs.length} images have no alt attribute.` })
  const h1 = $('h1').length
  if (h1 === 0) issues.push({ issue: 'No H1 heading', detail: 'Page has no primary heading.' })
  if (h1 > 1) issues.push({ issue: 'Multiple H1 headings', detail: `Page has ${h1} H1 elements.` })
  const inputs = $('input:not([type="hidden"])')
  const unlabeled = inputs.filter((_, el) => {
    const id = $(el).attr('id')
    return !$(el).attr('aria-label') && !$(el).attr('placeholder') && !(id && $(`label[for="${id}"]`).length)
  }).length
  if (unlabeled > 0) issues.push({ issue: 'Form inputs without labels', detail: `${unlabeled} inputs lack a label, aria-label or placeholder.` })
  if (!meta['viewport']) issues.push({ issue: 'Missing viewport meta tag', detail: 'Page may not be responsive on mobile.' })
  const buttonsNoLabel = $('button').filter((_, el) => !$(el).text().trim() && !$(el).attr('aria-label')).length
  if (buttonsNoLabel > 0) issues.push({ issue: 'Buttons without accessible names', detail: `${buttonsNoLabel} buttons have no text or aria-label.` })
  return issues.slice(0, 20)
}

function detectInteractions($: CheerioAPI, scripts: string[]): string[] {
  const interactions = new Set<string>()
  if ($('nav a').length > 1) interactions.add('Navigation links')
  if ($('a[href^="#"]').length > 0) interactions.add('In-page anchor navigation')
  if ($('form').length > 0) interactions.add('Forms')
  if ($('button').length > 0) interactions.add('Buttons / click actions')
  if ($('[class*="modal"],[role="dialog"],[aria-modal]').length) interactions.add('Modal dialogs')
  if ($('[class*="accordion"],[data-accordion]').length) interactions.add('Accordions')
  if ($('[class*="slider"],[class*="carousel"],[class*="swiper"]').length) interactions.add('Carousels / sliders')
  if ($('[class*="tabs"],[role="tab"]').length) interactions.add('Tabs')
  if ($('[class*="dropdown"]').length) interactions.add('Dropdown menus')
  if ($('input[type="search"],[role="search"]').length) interactions.add('Search')
  if (scripts.some((s) => /framer|gsap|three/i.test(s))) interactions.add('Rich scripted animation')
  if ($('[class*="hamburger"],[class*="menu-toggle"]').length) interactions.add('Mobile menu toggle')
  return [...interactions]
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values.map((v) => typeof v === 'string' ? v.trim() : v).filter((v) => v !== '' && v !== undefined) as T[])]
}

export async function searchWeb(query: string, limit = 8): Promise<{ results: WebSearchResult[]; provider: string; errors: string[] }> {
  if (typeof query !== 'string' || !query.trim() || query.length > 4000) throw new Error('Search query must contain 1–4000 characters')
  limit = Number.isFinite(limit) ? Math.max(1, Math.min(15, Math.floor(limit))) : 8
  const settings = getSettings()
  const errors: string[] = []
  const provider = settings.searchProvider
  const detected = detectLanguage(query)?.code
  const language = detected || (settings.replyLanguage === 'auto' ? 'en' : settings.replyLanguage)
  const searchLanguage = language === 'ary' ? 'ar' : language
  if (provider === 'searxng') {
    try {
      if (!settings.searxngUrl) throw new Error('Configure the SearXNG base URL in Settings → Web intelligence')
      const endpoint = await validateUrl(settings.searxngUrl.replace(/\/$/, '') + '/search', { allowPrivateNetwork: settings.allowPrivateNetwork })
      endpoint.searchParams.set('q', query)
      endpoint.searchParams.set('format', 'json')
      endpoint.searchParams.set('language', searchLanguage)
      const res = await safeFetch(endpoint.toString(), { maxBytes: 2_000_000, timeoutMs: 20000, sameOrigin: true, headers: { accept: 'application/json' } })
      const json: unknown = JSON.parse(res.body.toString('utf8'))
      if (!json || typeof json !== 'object' || !('results' in json) || !Array.isArray(json.results)) throw new Error('Invalid SearXNG response; enable JSON output in the server search formats')
      const results: WebSearchResult[] = []
      for (const row of json.results) {
        if (!row || typeof row !== 'object' || typeof row.url !== 'string' || typeof row.title !== 'string') continue
        try {
          const url = new URL(row.url)
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue
          results.push({ title: row.title.slice(0, 1000), url: url.toString(), snippet: typeof row.content === 'string' ? row.content.slice(0, 4000) : '', source: 'SearXNG' })
        } catch { continue }
        if (results.length >= limit) break
      }
      return { results, provider: 'SearXNG', errors: results.length ? [] : ['SearXNG returned no results'] }
    } catch (err) {
      return { results: [], provider: 'SearXNG', errors: [`SearXNG search failed: ${(err as Error).message}. No query was sent to another provider.`] }
    }
  }
  if (provider === 'brave') {
    const key = getSearchKey()
    if (key) {
      try {
        const res = await safeFetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
          headers: { 'x-subscription-token': key, accept: 'application/json' },
        })
        const json = JSON.parse(res.body.toString('utf8'))
        const results = (json.web?.results || []).slice(0, limit).map((r: any) => ({
          title: String(r.title || ''),
          url: String(r.url || ''),
          snippet: String(r.description || '').replace(/<[^>]+>/g, ''),
          source: 'Brave Search',
        }))
        if (results.length) return { results, provider: 'Brave Search', errors }
        errors.push('Brave returned no results')
      } catch (err) {
        errors.push(`Brave search failed: ${(err as Error).message}`)
      }
    } else {
      errors.push('Brave search selected but no API key configured; falling back to DuckDuckGo.')
    }
  }
  if (provider === 'tavily') {
    const key = getSearchKey()
    if (key) {
      try {
        const res = await safeFetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ api_key: key, query, max_results: limit, search_depth: 'advanced' }),
        })
        const json = JSON.parse(res.body.toString('utf8'))
        const results = (json.results || []).slice(0, limit).map((r: any) => ({
          title: String(r.title || ''),
          url: String(r.url || ''),
          snippet: String(r.content || ''),
          source: 'Tavily',
        }))
        if (results.length) return { results, provider: 'Tavily', errors }
        errors.push('Tavily returned no results')
      } catch (err) {
        errors.push(`Tavily search failed: ${(err as Error).message}`)
      }
    } else {
      errors.push('Tavily selected but no API key configured; falling back to DuckDuckGo.')
    }
  }

  // DuckDuckGo HTML (no API key required)
  try {
    const res = await safeFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      timeoutMs: 20000,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    const $ = load(res.body.toString('utf8'))
    const results: WebSearchResult[] = []
    $('.result').each((_, el) => {
      if (results.length >= limit) return
      const a = $(el).find('.result__a').first()
      let href = a.attr('href') || ''
      if (href.startsWith('//')) href = 'https:' + href
      if (href.includes('duckduckgo.com/l/')) {
        try {
          const u = new URL(href)
          href = u.searchParams.get('uddg') || href
        } catch { /* ignore */ }
      }
      const title = a.text().replace(/\s+/g, ' ').trim()
      const snippet = $(el).find('.result__snippet').text().replace(/\s+/g, ' ').trim()
      if (href && title) results.push({ title, url: href, snippet, source: 'DuckDuckGo' })
    })
    if (results.length) return { results, provider: 'DuckDuckGo', errors }
    errors.push('DuckDuckGo returned no parseable results')
  } catch (err) {
    errors.push(`DuckDuckGo search failed: ${(err as Error).message}`)
  }

  // Wikipedia API fallback for encyclopedic/technical topics
  try {
    const wikiLanguage = Object.hasOwn(LANGUAGE_BY_ID, searchLanguage) && /^[a-z]{2}$/.test(searchLanguage) ? searchLanguage : 'en'
    const res = await safeFetch(`https://${wikiLanguage}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${Math.min(limit, 8)}`, {
      headers: { accept: 'application/json' },
    })
    const json = JSON.parse(res.body.toString('utf8'))
    const results = (json.query?.search || []).map((r: any) => ({
      title: String(r.title || ''),
      url: `https://${wikiLanguage}.wikipedia.org/wiki/${encodeURIComponent(String(r.title || '').replace(/ /g, '_'))}`,
      snippet: String(r.snippet || '').replace(/<[^>]+>/g, ''),
      source: 'Wikipedia',
    }))
    if (results.length) return { results, provider: 'Wikipedia (fallback)', errors }
    errors.push('Wikipedia returned no results')
  } catch (err) {
    errors.push(`Wikipedia search failed: ${(err as Error).message}`)
  }

  return { results: [], provider: 'unavailable', errors }
}

export async function searchMultilingual(query: string, variants: string[] = [], limit = 8): Promise<{ results: (WebSearchResult & { query: string })[]; provider: string; errors: string[] }> {
  if (!Array.isArray(variants) || variants.length > 2 || variants.some((value) => typeof value !== 'string' || !value.trim() || value.length > 4000)) {
    throw new Error('Supply at most two nonempty translated search queries')
  }
  const queries = [...new Set([query, ...variants])]
  const searches = await Promise.all(queries.map((value) => searchWeb(value, limit)))
  const results = new Map<string, WebSearchResult & { query: string }>()
  searches.forEach((search, index) => search.results.forEach((row) => {
    if (!results.has(row.url)) results.set(row.url, { ...row, query: queries[index] })
  }))
  return { results: [...results.values()], provider: [...new Set(searches.map((row) => row.provider))].join(', '), errors: searches.flatMap((row) => row.errors) }
}

export interface GitHubRepoInfo {
  owner: string
  repo: string
  htmlUrl: string
  description: string
  stars: number
  language: string
  topics: string[]
  defaultBranch: string
  readme: string
  tree: string[]
  packageJson: string | null
  license: string
  archived: boolean
  cloneUrl: string
}

export function parseGitHubUrl(input: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(input)
    if (!/(^|\.)github\.com$/i.test(url.hostname)) return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') }
  } catch {
    const m = input.trim().match(/^([\w.-]+)\/([\w.-]+)$/)
    if (m) return { owner: m[1], repo: m[2] }
    return null
  }
}

export async function fetchGitHubRepo(input: string, deep = false): Promise<GitHubRepoInfo> {
  const parsed = parseGitHubUrl(input)
  if (!parsed) throw new Error('Not a valid GitHub repository URL')
  const { owner, repo } = parsed
  const apiBase = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
  const res = await safeFetch(apiBase, { headers, timeoutMs: 20000 })
  const info = JSON.parse(res.body.toString('utf8'))
  let readme = ''
  try {
    const readmeRes = await safeFetch(`${apiBase}/readme`, { headers, timeoutMs: 20000 })
    const readmeJson = JSON.parse(readmeRes.body.toString('utf8'))
    if (readmeJson.content) readme = Buffer.from(readmeJson.content, readmeJson.encoding || 'base64').toString('utf8')
  } catch (err) {
    log('web', 'github readme fetch failed', String(err))
  }
  let tree: string[] = []
  const branch = info.default_branch || 'main'
  try {
    const treeRes = await safeFetch(`${apiBase}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers, timeoutMs: 25000 })
    const treeJson = JSON.parse(treeRes.body.toString('utf8'))
    tree = (treeJson.tree || []).filter((n: any) => n.type === 'blob').map((n: any) => String(n.path)).slice(0, 4000)
  } catch (err) {
    log('web', 'github tree fetch failed', String(err))
  }
  let packageJson: string | null = null
  if (tree.includes('package.json')) {
    try {
      const pkgRes = await safeFetch(`${apiBase}/contents/package.json`, { headers, timeoutMs: 15000 })
      const pkgJson = JSON.parse(pkgRes.body.toString('utf8'))
      packageJson = Buffer.from(pkgJson.content || '', 'base64').toString('utf8')
    } catch (err) {
      log('web', 'github package.json fetch failed', String(err))
    }
  }
  log('web', `github repo ${owner}/${repo} deep=${deep}`)
  return {
    owner,
    repo,
    htmlUrl: info.html_url,
    description: info.description || '',
    stars: info.stargazers_count || 0,
    language: info.language || '',
    topics: info.topics || [],
    defaultBranch: branch,
    readme,
    tree,
    packageJson,
    license: info.license?.spdx_id || '',
    archived: !!info.archived,
    cloneUrl: info.clone_url || `https://github.com/${owner}/${repo}.git`,
  }
}

export function htmlToText(html: string): string {
  const $ = load(html)
  return extractReadableText($)
}

export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[a-zA-Z]*\n?/g, ''))
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
}
