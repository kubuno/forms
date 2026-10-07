import { useModulesStore, ModuleServiceRegistry, useAuthStore, useSignedUrl } from '@kubuno/sdk'
import { readSource, resolvePlayable } from './videoSource'

/** Drive's published `downloadUrl`, or null when Drive is not installed. */
export function useDriveUrl(): ((id: string) => string) | undefined {
  return ModuleServiceRegistry.get<(id: string) => string>('drive', 'downloadUrl')
}

/** True when the Media module is installed AND enabled on this instance. */
export function useMediaAvailable(): boolean {
  const modules = useModulesStore(s => s.activeModules)
  return modules.some(m => m.module_id === 'media')
}

/**
 * Renders a `video` question's source: a provider embed (YouTube, Dailymotion,
 * Vimeo, PeerTube) or a plain <video> for a Drive file, a Media item or a direct
 * file link.
 */
export default function VideoBlock({ options, title }: {
  options: Record<string, unknown> | null | undefined
  title?: string
}) {
  const driveUrl = useDriveUrl()
  const src      = readSource(options)
  const playable = src ? resolvePlayable(src, driveUrl) : null

  if (!playable) {
    return (
      <div className="rounded-lg bg-surface-2 text-text-tertiary text-sm px-4 py-6 text-center">
        Aucune vidéo sélectionnée
      </div>
    )
  }

  if (playable.mode === 'iframe') {
    return (
      <div className="relative w-full rounded-lg overflow-hidden bg-black" style={{ aspectRatio: '16 / 9' }}>
        <iframe
          src={playable.src}
          title={title || 'Vidéo'}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }

  return <SignedVideo src={playable.src} />
}

/** Plain <video>: signed with a stream ticket when a session exists; anonymous
 *  (public form) pages keep the bare URL. */
function SignedVideo({ src }: { src: string }) {
  const hasSession = useAuthStore(s => !!s.accessToken)
  const signed = useSignedUrl(hasSession ? src : undefined, { purpose: 'stream' })
  const finalSrc = hasSession ? signed : src
  if (!finalSrc) return null
  return (
    <video
      src={finalSrc}
      controls
      preload="metadata"
      className="w-full rounded-lg bg-black"
      style={{ aspectRatio: '16 / 9' }}
    />
  )
}
