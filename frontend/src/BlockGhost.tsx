/**
 * Landing-zone ghost for a dragged block.
 *
 * A block is not a rectangle: when it is active it grows a coloured band on its
 * left, itself made of a wide tool head narrowing into a thin spine along an
 * S-curve. Outlining that with CSS boxes is impossible, so the silhouette is
 * traced as a single SVG path computed from the block's own measurements —
 * whatever the theme radius or the number of tools in the head.
 */

export interface GhostShape {
  /** Viewport position of the WHOLE silhouette, band included. */
  left:   number
  top:    number
  /** Card width + band width. */
  width:  number
  height: number
  /** 0 when the block has no band (inactive, or folded on a narrow screen). */
  bandW:  number
  /** Height of the wide tool head; the S-curve starts right under it. */
  headH:  number
  /** Width kept by the thin spine below the curve. */
  spineW: number
  /** Outer corner radius, read from the live element. */
  radius: number
  /** Section tab sitting on top-left, if any: it is part of the silhouette. */
  tab?: { width: number; height: number; radius: number }
  /**
   * How far the silhouette rises ABOVE the card it belongs to (a section's band
   * and tab). The ghost is placed from the card's top, so this has to be
   * subtracted or the shape sits that much too low.
   */
  overhang: number
  /** True while sitting on a real slot; false while floating between them. */
  snapped?: boolean
}

/** Radius of each of the two tangent quarter-circles forming the S-curve. */
const S = 16

/** Outline thickness. */
const STROKE = 2

/** Measures a block (and its band, if any) into a drawable silhouette. */
export function measureBlock(card: HTMLElement): GhostShape {
  const r    = card.getBoundingClientRect()
  const rail = card.querySelector<HTMLElement>('[data-block-rail]')
  const head = rail?.querySelector<HTMLElement>('[data-rail-head]')
  const spine = rail?.lastElementChild as HTMLElement | null

  const radius = parseFloat(getComputedStyle(card).borderTopRightRadius) || 8
  if (!rail) {
    return { left: r.left, top: r.top, width: r.width, height: r.height,
             bandW: 0, headH: 0, spineW: 0, radius, overhang: 0 }
  }

  const rr = rail.getBoundingClientRect()
  // The tab belongs to the outline only for the block that actually carries it:
  // the section header, whose BAND rises above its own card to meet it. Every
  // other block of that section shares the group, so looking the tab up by
  // group would wrongly give them all a tab-shaped silhouette.
  const rises  = rr.top < r.top
  const tabEl  = rises
    ? card.closest('[data-section-block]')?.querySelector<HTMLElement>('[data-section-tab]')
    : undefined
  const tr = tabEl?.getBoundingClientRect()
  const tab = tr
    ? { width: tr.right - rr.left, height: tr.height,
        radius: parseFloat(getComputedStyle(tabEl!).borderTopRightRadius) || 6 }
    : undefined

  return {
    // The band hangs to the LEFT of the card and may rise above it (section tab).
    left:   rr.left,
    top:    Math.min(r.top, rr.top),
    width:  r.width + rr.width,
    height: Math.max(r.bottom, rr.bottom) - Math.min(r.top, rr.top),
    bandW:  rr.width,
    headH:  (head?.getBoundingClientRect().height ?? 0),
    spineW: (spine?.getBoundingClientRect().width ?? 12),
    radius,
    tab,
    overhang: r.top - Math.min(r.top, rr.top),
  }
}

/** Builds the closed outline, clockwise from the band's top-left corner. */
export function ghostPath(g: GhostShape): string {
  const { width: W, height: H, radius: R } = g

  // No band: a plain rounded rectangle.
  if (!g.bandW) {
    return `M ${R} 0 H ${W - R} A ${R} ${R} 0 0 1 ${W} ${R} V ${H - R}` +
           ` A ${R} ${R} 0 0 1 ${W - R} ${H} H ${R}` +
           ` A ${R} ${R} 0 0 1 0 ${H - R} V ${R} A ${R} ${R} 0 0 1 ${R} 0 Z`
  }

  const xSpine = g.bandW - g.spineW   // left edge of the thin spine
  const yHead  = g.headH              // where the S-curve begins
  const yMid   = yHead + S            // between the two quarter-circles
  const yEnd   = yHead + 2 * S        // where the spine starts

  // With a tab, the top edge steps: it runs along the tab, drops to the card's
  // top at the tab's right edge (a re-entrant corner, left sharp as in the DOM),
  // then continues to the card's own top-right corner.
  const top = g.tab
    ? [
        `M ${R} 0`,
        `H ${g.tab.width - g.tab.radius}`,
        `A ${g.tab.radius} ${g.tab.radius} 0 0 1 ${g.tab.width} ${g.tab.radius}`,
        `V ${g.tab.height}`,
        `H ${W - R}`,
        `A ${R} ${R} 0 0 1 ${W} ${g.tab.height + R}`,
      ]
    : [
        `M ${R} 0`,
        `H ${W - R}`,
        `A ${R} ${R} 0 0 1 ${W} ${R}`,
      ]

  return [
    ...top,
    `V ${H - R}`,                                 // right edge
    `A ${R} ${R} 0 0 1 ${W - R} ${H}`,            // bottom-right corner
    `H ${xSpine + R}`,                            // bottom edge, back to the spine
    `A ${R} ${R} 0 0 1 ${xSpine} ${H - R}`,       // spine's bottom-left corner
    `V ${yEnd}`,                                  // up the spine
    // Going UP the left side. The concave quarter turns anticlockwise on screen
    // (sweep 0) and the convex one clockwise (sweep 1) — swapping them mirrors
    // the S and the curve reads backwards against the real band.
    `A ${S} ${S} 0 0 0 ${xSpine - S} ${yMid}`,    // concave quarter (spine → mid)
    `A ${S} ${S} 0 0 1 0 ${yHead}`,               // convex quarter (mid → head edge)
    `V ${R}`,                                     // up the head's left edge
    `A ${R} ${R} 0 0 1 ${R} 0`,                   // band top-left corner
    'Z',
  ].join(' ')
}

export default function BlockGhost({ shape, color }: { shape: GhostShape; color: string }) {
  // A stroke straddles its path, so half of it falls OUTSIDE the outline. Drawn
  // in a viewport the exact size of the shape, that outer half is clipped on
  // every border — the frame would read 1px thick while the inner S-curve stays
  // 2px. Padding by half the stroke, and shifting the path to match, keeps the
  // thickness identical the whole way round.
  const pad = STROKE / 2
  return (
    <svg
      className="absolute pointer-events-none"
      style={{ left: shape.left - pad, top: shape.top - pad }}
      width={shape.width + STROKE}
      height={shape.height + STROKE}
      viewBox={`0 0 ${shape.width + STROKE} ${shape.height + STROKE}`}
      aria-hidden
    >
      <g transform={`translate(${pad} ${pad})`}>
        {/* Floating between slots reads lighter and dashed: nothing would
            happen on release there, and the outline says so. */}
        <path
          d={ghostPath(shape)}
          fill={`color-mix(in srgb, ${color} ${shape.snapped === false ? 10 : 22}%, transparent)`}
          stroke={color}
          strokeWidth={STROKE}
          strokeLinejoin="round"
          strokeDasharray={shape.snapped === false ? '6 5' : undefined}
          opacity={shape.snapped === false ? 0.75 : 1}
        />
      </g>
    </svg>
  )
}
