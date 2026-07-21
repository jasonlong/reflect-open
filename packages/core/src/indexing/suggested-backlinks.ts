import { sql } from 'kysely'
import { readNote } from '../graph/commands'
import {
  findSuggestedBacklinkMention,
  foldKey,
  parseNote,
  wikiLinkTargetForTitle,
  type SuggestedBacklinkMention,
} from '../markdown'
import { db } from './db'
import { blockContextAt } from './block-context'
import { serializeWikiSuggestionAddress } from './suggest'

/** One unlinked mention of the current note in another note. */
export interface SuggestedBacklink extends SuggestedBacklinkMention {
  readonly sourcePath: string
  readonly sourceTitle: string
  /** Reader-visible block context around the mention. */
  readonly snippet: string
}

interface SuggestedBacklinkTarget {
  readonly target: string
  readonly spellings: readonly string[]
}

const MINIMUM_SPELLING_LENGTH = 2
const MINIMUM_CANDIDATE_LIMIT = 48
const MAXIMUM_CANDIDATE_LIMIT = 200

function ftsPhrase(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

async function suggestedBacklinkTarget(path: string): Promise<SuggestedBacklinkTarget | null> {
  const [note, aliases, ownedKeys] = await Promise.all([
    db
      .selectFrom('notes')
      .where('path', '=', path)
      .where('kind', '!=', 'template')
      .select(['title', 'dailyDate'])
      .executeTakeFirst(),
    db.selectFrom('aliases').where('notePath', '=', path).select('alias').execute(),
    db.selectFrom('noteKeys').where('notePath', '=', path).select('key').execute(),
  ])
  if (note === undefined) {
    return null
  }

  const target = note.dailyDate ?? wikiLinkTargetForTitle(note.title)
  if (serializeWikiSuggestionAddress(target, null) === null) {
    return null
  }
  const keys = new Set(ownedKeys.map((row) => row.key))
  const candidates = [target, ...aliases.map((row) => row.alias)]
  const seen = new Set<string>()
  const spellings: string[] = []
  for (const candidate of candidates) {
    const spelling = candidate.trim()
    const key = foldKey(spelling)
    if (
      spelling.length < MINIMUM_SPELLING_LENGTH ||
      seen.has(key) ||
      !keys.has(key) ||
      serializeWikiSuggestionAddress(target, spelling === target ? null : spelling) === null
    ) {
      continue
    }
    seen.add(key)
    spellings.push(spelling)
  }
  return spellings.length === 0 ? null : { target, spellings }
}

/**
 * Find recent notes that mention `path` by its title or any resolving alias but
 * do not already link to it. FTS narrows the candidate set; every result is
 * then confirmed against the live Markdown parser before it is returned, so
 * matches in code, URLs, existing links, or stale index text never surface.
 */
export async function getSuggestedBacklinks(
  path: string,
  limit: number = 6,
): Promise<SuggestedBacklink[]> {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError('suggested backlink limit must be a positive safe integer')
  }
  const target = await suggestedBacklinkTarget(path)
  if (target === null) {
    return []
  }

  const match = `body : (${target.spellings.map(ftsPhrase).join(' OR ')})`
  const candidateLimit = Math.min(
    MAXIMUM_CANDIDATE_LIMIT,
    Math.max(MINIMUM_CANDIDATE_LIMIT, limit * 8),
  )
  const candidates = await db
    .selectFrom('searchFts')
    .innerJoin('notes', 'notes.path', 'searchFts.path')
    .where(sql<boolean>`search_fts MATCH ${match}`)
    .where('notes.path', '!=', path)
    .where('notes.kind', '!=', 'template')
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('backlinks')
            .select(sql<number>`1`.as('one'))
            .whereRef('backlinks.sourcePath', '=', 'notes.path')
            .where('backlinks.targetPath', '=', path),
        ),
      ),
    )
    .select(['notes.path', 'notes.title'])
    .orderBy('notes.mtime', 'desc')
    .orderBy('notes.path')
    .limit(candidateLimit)
    .execute()

  const inspected = await Promise.all(
    candidates.map(async (candidate): Promise<SuggestedBacklink | null> => {
      try {
        const source = await readNote(candidate.path)
        const mention = findSuggestedBacklinkMention(source, target.spellings, target.target)
        if (mention === null) {
          return null
        }
        const markdownContext = blockContextAt(source, mention.from)
        const snippet = parseNote({ path: candidate.path, source: markdownContext }).text
        return {
          ...mention,
          sourcePath: candidate.path,
          sourceTitle: candidate.title,
          snippet,
        }
      } catch {
        // Index rows can briefly outlive externally removed files. Suggested
        // backlinks are optional context, so one unreadable candidate is skipped.
        return null
      }
    }),
  )

  return inspected.flatMap((suggestion) => (suggestion === null ? [] : [suggestion])).slice(0, limit)
}
