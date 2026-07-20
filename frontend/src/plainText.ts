/**
 * Titles and descriptions are stored as HTML (rich fields). Anywhere they are
 * shown as plain text — the editor's top bar, list rows, stats — the markup
 * must be stripped, or the user reads `<b>ok</b>`.
 */
export function plainText(html: string | null | undefined): string {
  if (!html) return ''
  if (!/[<&]/.test(html)) return html
  const el = document.createElement('div')
  el.innerHTML = html
  return (el.textContent ?? '').trim()
}
