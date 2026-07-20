// The project-wide image picker lives in the core (@kubuno/sdk). The published
// types this module compiles against do not expose it yet, while the HOST does
// provide it at runtime through the import map — so we reach it with a narrow
// cast. Replace with a direct import once @kubuno/sdk is published & bumped.
import * as sdk from '@kubuno/sdk'

type PickResult = { kind: 'url'; url: string } | { kind: 'file'; file: File }

const openImagePicker = (sdk as unknown as {
  openImagePicker?: (o?: { title?: string; exclude?: string[] }) => Promise<PickResult | null>
}).openImagePicker

/**
 * Opens the picker and always resolves to a File.
 *
 * A picked URL is fetched here on purpose: forms are filled by ANONYMOUS
 * respondents, so an authenticated Drive/Photos URL would answer them 401. The
 * bytes must land in the form's own public storage.
 */
export async function pickImageFile(title: string): Promise<File | null> {
  if (!openImagePicker) return null
  const picked = await openImagePicker({ title })
  if (!picked) return null
  if (picked.kind === 'file') return picked.file

  const res = await fetch(picked.url)
  if (!res.ok) throw new Error(`Image inaccessible (${res.status})`)
  const blob = await res.blob()
  const name = picked.url.split('/').pop()?.split('?')[0] || 'image'
  return new File([blob], name, { type: blob.type || 'image/*' })
}
