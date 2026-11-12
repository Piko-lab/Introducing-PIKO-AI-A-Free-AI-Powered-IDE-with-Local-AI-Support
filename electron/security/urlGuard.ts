import dns from 'node:dns/promises'
import net from 'node:net'

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata.google.internal', 'metadata', 'instance-data',
])

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask)
}

export function isPrivateIPv4(ip: string): boolean {
  if (!net.isIPv4(ip)) return false
  const ranges: [string, number][] = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
    ['255.255.255.255', 32],
  ]
  return ranges.some(([base, bits]) => inCidr(ip, base, bits))
}

export function isPrivateIPv6(ip: string): boolean {
  if (!net.isIPv6(ip)) return false
  const normalized = ip.toLowerCase().split('%')[0]
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true
  if (normalized.startsWith('ff')) return true
  // IPv4-mapped ::ffff:x.x.x.x
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  const mappedHex = normalized.match(/^(?:0*:)*ffff:([\da-f]{1,4}):([\da-f]{1,4})$/)
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16)
    const low = parseInt(mappedHex[2], 16)
    return isPrivateIPv4(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`)
  }
  return false
}

export function normalizeUrl(input: string): URL {
  let value = input.trim()
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) value = 'https://' + value
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${input}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError(`Only http:// and https:// URLs are allowed (received ${url.protocol})`)
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs containing credentials are not allowed')
  }
  return url
}

export interface UrlValidationOptions {
  allowPrivateNetwork?: boolean
}

export async function validateUrl(input: string, options: UrlValidationOptions = {}): Promise<URL> {
  const url = normalizeUrl(input)
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!hostname) throw new UnsafeUrlError('URL has no hostname')
  if (!options.allowPrivateNetwork) {
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.home.arpa')) {
      throw new UnsafeUrlError(`Blocked hostname "${hostname}" (private/loopback network protection). Enable "Allow private network" in Settings if this is intentional.`)
    }
    if (net.isIP(hostname)) {
      if (isPrivateIPv4(hostname) || isPrivateIPv6(hostname)) {
        throw new UnsafeUrlError(`Blocked private IP address ${hostname}. Enable "Allow private network" in Settings if this is intentional.`)
      }
    } else {
      let addresses: { address: string; family: number }[]
      try {
        addresses = await dns.lookup(hostname, { all: true, verbatim: true })
      } catch (err) {
        throw new UnsafeUrlError(`DNS lookup failed for ${hostname}: ${(err as Error).message}`)
      }
      if (!addresses.length) throw new UnsafeUrlError(`No DNS records found for ${hostname}`)
      for (const record of addresses) {
        if (record.family === 4 && isPrivateIPv4(record.address)) {
          throw new UnsafeUrlError(`Hostname ${hostname} resolves to a private address (${record.address}); blocked by SSRF protection.`)
        }
        if (record.family === 6 && isPrivateIPv6(record.address)) {
          throw new UnsafeUrlError(`Hostname ${hostname} resolves to a private address (${record.address}); blocked by SSRF protection.`)
        }
      }
    }
  }
  return url
}

export function isProbablyUrl(text: string): boolean {
  try {
    const t = text.trim()
    if (!t || /\s/.test(t)) return false
    if (/^(https?:\/\/)/i.test(t)) return true
    return /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(t) && !/\.(ts|tsx|js|jsx|py|json|md|css|html)$/i.test(t)
  } catch {
    return false
  }
}
