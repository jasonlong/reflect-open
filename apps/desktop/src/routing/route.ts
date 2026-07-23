/**
 * Typed product routes (Plan 06). These are app states, not page names — the
 * integration point for navigation, back/forward history, and later deep links
 * and CLI `open` (Plan 14).
 *
 * Note identity is the graph-relative path in the first wave (Plan 03), so the
 * note route carries `path` — the reserved frontmatter `id` can join it later
 * without breaking the shape.
 */
import { dailyPath, dateFromDailyPath, isBlockId, isDaily } from '@reflect/core'
import { isIsoDate } from '@/lib/dates'

export type NoteFragment =
  | { readonly kind: 'heading'; readonly value: string }
  | { readonly kind: 'block'; readonly id: string }
  | {
      readonly kind: 'blockPosition'
      readonly ordinal: number
      readonly expectedText: string
    }

export type Route =
  | { kind: 'today' }
  | { kind: 'daily'; date: string; fragment?: NoteFragment | null }
  | { kind: 'note'; path: string; fragment?: NoteFragment | null }
  | { kind: 'allNotes'; tag: string | null }
  | { kind: 'search'; query: string }
  | { kind: 'tasks' }
  | { kind: 'chat' }
  | { kind: 'settings' }
  // The graph-switcher screen — a mobile settings sub-screen; desktop renders
  // it as the settings screen (its switcher lives in the sidebar footer).
  | { kind: 'graphs' }

/** A route that addresses one concrete note, including a dated daily note. */
export type NoteRoute = Extract<Route, { kind: 'daily' | 'note' }>

/** Structural route equality (used to avoid pushing no-op history entries). */
export function routesEqual(a: Route, b: Route): boolean {
  if (a.kind !== b.kind) {
    return false
  }
  switch (a.kind) {
    case 'today':
    case 'tasks':
    case 'chat':
    case 'settings':
    case 'graphs':
      return true
    case 'daily': {
      const other = b as Extract<Route, { kind: 'daily' }>
      return a.date === other.date && fragmentsEqual(a.fragment, other.fragment)
    }
    case 'note': {
      const other = b as Extract<Route, { kind: 'note' }>
      return a.path === other.path && fragmentsEqual(a.fragment, other.fragment)
    }
    case 'allNotes':
      return a.tag === (b as Extract<Route, { kind: 'allNotes' }>).tag
    case 'search':
      return a.query === (b as Extract<Route, { kind: 'search' }>).query
  }
}

/**
 * The route a resolved note path navigates to: a real-calendar daily date opens
 * the daily view; anything else — including a `daily/…` file whose name is a
 * well-formed but impossible date (e.g. `2026-02-31`), which `dailyPath` would
 * reject — opens as a plain note so navigation can never crash the workspace.
 */
export function routeForPath(path: string, fragment?: NoteFragment | null): NoteRoute {
  const date = isDaily(path) ? dateFromDailyPath(path) : null
  const route: NoteRoute =
    date !== null && isIsoDate(date) ? { kind: 'daily', date } : { kind: 'note', path }
  return fragment == null ? route : { ...route, fragment }
}

/**
 * The daily date a route is anchored on: today's date for the `today` route
 * (hence the `today` parameter), the route's own date for `daily/:date`, and
 * null for any route that isn't a daily view (notes, search, chat, settings).
 */
function dailyDateForRoute(route: Route, today: string): string | null {
  switch (route.kind) {
    case 'today':
      return today
    case 'daily':
      return route.date
    default:
      return null
  }
}

/**
 * The daily date the user is *effectively* working on: the day focused in the
 * daily stream when there is one, otherwise the route's own daily date. Null
 * when the route isn't a daily view, where the focused day is irrelevant.
 *
 * The stream keeps a single `daily/:date` route as focus moves between days, so
 * the focused day — not the routed one — is what both the context sidebar and
 * note-scoped commands must point at. This is the one place that precedence
 * lives, so those two surfaces can never disagree about which day they target.
 */
export function effectiveDailyDate(
  route: Route,
  today: string,
  focusedDailyDate: string | null,
): string | null {
  const routed = dailyDateForRoute(route, today)
  return routed === null ? null : focusedDailyDate ?? routed
}

/**
 * The note file a route is editing — what note-scoped commands (pin, …) act
 * on: a note route's path, a daily route's file (today's for the `today`
 * route), and null for screens that edit no note (search, chat, settings).
 */
export function notePathForRoute(route: Route, today: string): string | null {
  if (route.kind === 'note') {
    return route.path
  }
  const daily = dailyDateForRoute(route, today)
  return daily === null ? null : dailyPath(daily)
}

/**
 * The invariant the router maintains on every entry: a `daily` route never
 * carries an impossible calendar date past the boundary (`dailyPath` would
 * throw on one downstream). A malformed date collapses to the `today` route —
 * the same anchoring the stream would choose — so views consuming
 * {@link useRouter} can trust `route.date` without re-validating it.
 */
export function normalizeRoute(route: Route): Route {
  if (route.kind === 'daily' && !isIsoDate(route.date)) {
    return { kind: 'today' }
  }
  if (route.kind !== 'daily' && route.kind !== 'note') {
    return route
  }
  const fragment = normalizeNoteFragment(route.fragment)
  if (fragment === null) {
    const { fragment: _fragment, ...withoutFragment } = route
    return withoutFragment
  }
  return { ...route, fragment }
}

function normalizeNoteFragment(fragment: NoteFragment | null | undefined): NoteFragment | null {
  if (fragment == null) {
    return null
  }
  switch (fragment.kind) {
    case 'heading': {
      const value = fragment.value.trim()
      return value === '' ? null : { kind: 'heading', value }
    }
    case 'block':
      return isBlockId(fragment.id) ? fragment : null
    case 'blockPosition': {
      const expectedText = fragment.expectedText.trim()
      return Number.isSafeInteger(fragment.ordinal) && fragment.ordinal >= 0 && expectedText !== ''
        ? { ...fragment, expectedText }
        : null
    }
  }
}

function fragmentsEqual(
  left: NoteFragment | null | undefined,
  right: NoteFragment | null | undefined,
): boolean {
  if (left == null || right == null) {
    return left == null && right == null
  }
  if (left.kind !== right.kind) {
    return false
  }
  switch (left.kind) {
    case 'heading':
      return left.value === (right as Extract<NoteFragment, { kind: 'heading' }>).value
    case 'block':
      return left.id === (right as Extract<NoteFragment, { kind: 'block' }>).id
    case 'blockPosition': {
      const other = right as Extract<NoteFragment, { kind: 'blockPosition' }>
      return left.ordinal === other.ordinal && left.expectedText === other.expectedText
    }
  }
}
