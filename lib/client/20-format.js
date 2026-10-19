/**
 * Transport and pure value formatting.
 *
 * Nothing here touches React or the DOM. Keeping it separate is what lets the
 * presenters below stay trivially testable and hook-free.
 */

/** Fetch one panel snapshot for one workspace. Never rejects: the UI renders the failure. */
async function fetchPanel(cwd) {
  try {
    // The host has no way to know which conversation this panel is rendered in,
    // so the workspace travels with the request. Omitted when unknown, which
    // leaves the host's own session hint in charge.
    const url =
      typeof cwd === 'string' && cwd.length > 0 ? `${PANEL_ENDPOINT}?cwd=${encodeURIComponent(cwd)}` : PANEL_ENDPOINT
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, status: response.status }
    }
    const payload = await response.json()
    if (!payload || typeof payload !== 'object') {
      return { ok: false, error: 'malformed panel response' }
    }
    return payload
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Percentage of a 0..1 strength, clamped so a bad value cannot overflow. */
function strengthPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(100, Math.round(number * 100)))
}

/** A whole number, or 0 for anything that is not one. */
function countOf(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0
}

/**
 * Localize an enum value such as `technology` or `harder`.
 *
 * A key the dictionary does not define comes back as itself, so an unmapped enum
 * renders the raw value instead of `domain.technology`.
 */
function enumLabel(t, prefix, value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const key = `${prefix}.${String(value)}`
  const label = t(key)
  return label === key ? String(value) : label
}

/** How many whole days past its due date one review is, or null. */
function overdueDays(dueAt) {
  if (typeof dueAt !== 'string' || dueAt.length < 10) return null
  const due = new Date(`${dueAt.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(due.getTime())) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today.getTime() - due.getTime()) / 86400000)
  return days > 0 ? days : null
}

/**
 * `HH:MM` for a snapshot timestamp.
 *
 * The panel fetches once and then sits there, so the reader needs to know how old
 * what they are looking at is; `generated_at` was already in the payload and
 * previously unused.
 */
function clockOf(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Copy the due concepts and their questions, for pasting back into the chat. */
function copyReviewList(items) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  const text = items.map((item) => `${String(item.concept ?? '')}: ${String(item.prompt ?? '')}`).join('\n')
  const writing = navigator.clipboard.writeText(text)
  if (writing && typeof writing.catch === 'function') writing.catch(() => {})
}
