interface FormsLogoProps {
  size?:      number
  className?: string
  title?:     string
}

/** Forms logo (designer artwork, raster). Served by the host from
 *  `/forms-logo.png`; rendered as a square image so it weighs the same as its
 *  neighbours in the waffle menu. */
export function FormsLogo({ size = 24, className, title = 'Forms' }: FormsLogoProps) {
  return (
    <img
      src="/forms-logo.png"
      width={size}
      height={size}
      alt={title}
      className={className}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )
}

export default FormsLogo
