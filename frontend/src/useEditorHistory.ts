import { useCallback, useRef, useState } from 'react'

/**
 * Undo/redo for the form editor.
 *
 * The stack holds INVERSIBLE ACTIONS, not snapshots of the form: every edit is
 * recorded with the call that undoes it and the call that replays it. That way
 * an undo goes through the same API as a normal edit, and two people editing the
 * same form never overwrite each other with a stale whole-form snapshot.
 *
 * Recreating a deleted question yields a NEW id, which would break every later
 * entry pointing at the old one. Entries therefore carry a mutable `ref` box:
 * whoever recreates the row writes the fresh id into it, and the other entries
 * read through the box instead of capturing an id.
 */
export interface HistoryEntry {
  label: string
  undo:  () => Promise<void>
  redo:  () => Promise<void>
}

/** Mutable id box shared by the entries that refer to the same question. */
export interface IdRef { current: string }

const LIMIT = 100

export function useEditorHistory(onChanged: () => void) {
  const undoStack = useRef<HistoryEntry[]>([])
  const redoStack = useRef<HistoryEntry[]>([])
  // Only used to re-render the toolbar buttons' enabled state.
  const [, bump] = useState(0)
  const busy = useRef(false)

  const push = useCallback((entry: HistoryEntry) => {
    undoStack.current.push(entry)
    if (undoStack.current.length > LIMIT) undoStack.current.shift()
    redoStack.current = []          // a fresh edit invalidates the redo branch
    bump(n => n + 1)
  }, [])

  const run = useCallback(async (from: 'undo' | 'redo') => {
    if (busy.current) return
    const src = from === 'undo' ? undoStack : redoStack
    const dst = from === 'undo' ? redoStack : undoStack
    const entry = src.current.pop()
    if (!entry) return
    busy.current = true
    try {
      await (from === 'undo' ? entry.undo() : entry.redo())
      dst.current.push(entry)
      onChanged()
    } catch {
      // The server refused (row already gone, permissions…): drop the entry
      // rather than leaving the stacks describing a state that never happened.
    } finally {
      busy.current = false
      bump(n => n + 1)
    }
  }, [onChanged])

  const undo = useCallback(() => run('undo'), [run])
  const redo = useCallback(() => run('redo'), [run])

  const clear = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    bump(n => n + 1)
  }, [])

  return {
    push, undo, redo, clear,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  }
}

/** True when the event targets a field where the browser's own undo applies. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}
