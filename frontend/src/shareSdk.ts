// The core's share dialog ships in @kubuno/sdk. The published types this module
// compiles against do not expose it yet, while the HOST provides it at runtime
// through the import map — so we reach it with a narrow cast.
// Replace this file with a direct import once @kubuno/sdk is published & bumped.
import * as sdk from '@kubuno/sdk'
import type { ComponentType, ReactNode } from 'react'

export interface ShareTarget { moduleId: string; id: string; kind?: string }

export interface ShareApi {
  list:   (id: string) => Promise<{ owner: unknown; collaborators: unknown[] }>
  add:    (id: string, userId: string, permission: string) => Promise<unknown>
  update: (id: string, userId: string, permission: string) => Promise<unknown>
  remove: (id: string, userId: string) => Promise<unknown>
  searchRecipients: (q: string) => Promise<unknown[]>
}

export interface ShareSection {
  id: string
  moduleId: string
  kind?: string
  order?: number
  slot?: 'general' | 'notice' | 'settings'
  label?: ReactNode
  Component: ComponentType<{ target: ShareTarget }>
}

const S = sdk as unknown as {
  openShare?: (o: { target: ShareTarget; api: ShareApi; title?: string; permissions?: string[]; permissionLabel?: (p: string) => string; link?: string; linkAccess?: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string; hint?: string }>; label?: string } }) => Promise<void>
  ShareRegistry?: { add: (s: ShareSection) => void; remove: (id: string) => void }
}

export const openShare = S.openShare
export const ShareRegistry = S.ShareRegistry
