// The project-wide tooltip lives in the core's `@ui`. The published
// @kubuno/ui types this module compiles against do not expose it yet, while the
// HOST does provide it at runtime through the import map — so we reach it with
// a narrow cast. Replace this file with a direct `import { Tooltip } from '@ui'`
// once @kubuno/ui is published and bumped here.
import * as ui from '@ui'
import type { ReactElement, ReactNode } from 'react'

export interface TooltipProps {
  label:    ReactNode
  children: ReactElement
  side?:    'top' | 'right' | 'bottom' | 'left'
  offset?:  number
  delay?:   number
  arrow?:   boolean
  disabled?: boolean
}

export const Tooltip = (ui as unknown as {
  Tooltip: (p: TooltipProps) => ReactElement
}).Tooltip
