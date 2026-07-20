// A `video` question carries its source in the question's `options` JSON. Three
// origins are supported, and a form can mix them freely:
//   • drive  — a file picked from the Drive module (id + name)
//   • media  — an item from the Media module, when that module is installed
//   • url    — an external link (YouTube, Dailymotion, Vimeo, PeerTube, or a
//              direct .mp4/.webm file)
//
// Nothing here imports another module: Drive is reached through the core's
// ModuleServiceRegistry, Media through its HTTP API behind the core proxy.

export type VideoKind = 'drive' | 'media' | 'url'

export interface VideoSource {
  kind:  VideoKind
  /** Drive file id / Media item id — unused for `url`. */
  id?:   string
  /** External link, for `url`. */
  url?:  string
  /** Human label kept for display when the source cannot be resolved. */
  title?: string
}

export function readSource(options: Record<string, unknown> | null | undefined): VideoSource | null {
  const v = (options ?? {}).video as VideoSource | undefined
  if (!v || !v.kind) return null
  return v
}

/** Providers we can embed. Order matters: the first match wins. */
const PROVIDERS: Array<{ name: string; re: RegExp; embed: (m: RegExpMatchArray) => string }> = [
  {
    name:  'YouTube',
    re:    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
    embed: m => `https://www.youtube-nocookie.com/embed/${m[1]}`,
  },
  {
    name:  'Dailymotion',
    re:    /dailymotion\.com\/(?:video\/|embed\/video\/)([A-Za-z0-9]+)/,
    embed: m => `https://www.dailymotion.com/embed/video/${m[1]}`,
  },
  {
    name:  'Vimeo',
    re:    /vimeo\.com\/(?:video\/)?(\d+)/,
    embed: m => `https://player.vimeo.com/video/${m[1]}`,
  },
  {
    // PeerTube instances share the same /w/<uuid> shape.
    name:  'PeerTube',
    re:    /^(https?:\/\/[^/]+)\/w\/([A-Za-z0-9-]+)/,
    embed: m => `${m[1]}/videos/embed/${m[2]}`,
  },
]

export interface Playable {
  /** `iframe` for a provider embed, `file` for something <video> can play. */
  mode:     'iframe' | 'file'
  src:      string
  provider?: string
}

/**
 * Resolve a source to something renderable.
 * `driveUrl` is injected by the caller so this module stays free of any
 * dependency on the Drive service.
 */
export function resolvePlayable(
  src: VideoSource,
  driveUrl?: (id: string) => string,
): Playable | null {
  if (src.kind === 'url') {
    const url = (src.url ?? '').trim()
    if (!url) return null
    for (const p of PROVIDERS) {
      const m = url.match(p.re)
      if (m) return { mode: 'iframe', src: p.embed(m), provider: p.name }
    }
    return { mode: 'file', src: url }
  }
  if (src.kind === 'drive') {
    if (!src.id || !driveUrl) return null
    return { mode: 'file', src: driveUrl(src.id) }
  }
  if (src.kind === 'media') {
    if (!src.id) return null
    // Media streams the original file; the core proxies /api/v1/media/*.
    return { mode: 'file', src: `/api/v1/media/stream/${src.id}/direct` }
  }
  return null
}

/** Name of the recognised provider, for display in the editor. */
export function providerName(url: string): string | null {
  for (const p of PROVIDERS) if (url.match(p.re)) return p.name
  return null
}
