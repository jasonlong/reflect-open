import { parseWikiAddressCandidates } from './block-address'
import { parseNote } from './extract'
import { foldKey } from './keys'

interface Splice {
  readonly from: number
  readonly to: number
  readonly text: string
}

/** One exact or fragment-base spelling approved for a title rewrite. */
export interface WikiLinkRenameCandidate {
  readonly target: string
  readonly mode: 'exact' | 'fragment-base'
}

function renamedWikiTarget(
  target: string,
  fromKey: string,
  to: string,
  candidates: readonly WikiLinkRenameCandidate[],
): string | null {
  const targetKey = foldKey(target)
  const candidate = candidates.find((item) => foldKey(item.target) === targetKey)
  if (candidate === undefined) {
    return null
  }
  if (candidate.mode === 'exact') {
    return targetKey === fromKey ? to : null
  }

  const address = parseWikiAddressCandidates(target)
  if (address.fragmented === null || foldKey(address.fragmented.noteTarget) !== fromKey) {
    return null
  }
  const separator =
    address.fragmented.fragment.kind === 'block'
      ? address.exactTarget.lastIndexOf('#^')
      : address.exactTarget.lastIndexOf('#')
  return separator === -1 ? null : `${to}${address.exactTarget.slice(separator)}`
}

function applySplices(source: string, splices: readonly Splice[]): string {
  let result = source
  for (const splice of [...splices].sort((left, right) => right.from - left.from)) {
    result = result.slice(0, splice.from) + splice.text + result.slice(splice.to)
  }
  return result
}

/**
 * Rewrite approved exact targets or fragment bases from `from` to `to`, while
 * preserving fragments, aliases, embed markers, and all surrounding bytes.
 * When `candidates` is omitted, only the legacy exact target is rewritten.
 */
export function renameWikiLink(
  source: string,
  from: string,
  to: string,
  candidates: readonly WikiLinkRenameCandidate[] = [{ target: from, mode: 'exact' }],
): string {
  if (/[[\]|\r\n]/.test(to)) {
    throw new Error(`invalid wiki-link target (cannot contain [ ] | or a newline): ${to}`)
  }
  const fromKey = foldKey(from)
  const { wikiLinks } = parseNote({ path: '', source })
  const splices = wikiLinks.flatMap<Splice>((link) => {
    const target = renamedWikiTarget(link.target, fromKey, to, candidates)
    return target === null
      ? []
      : [
          {
            from: link.from,
            to: link.to,
            text: link.alias ? `[[${target}|${link.alias}]]` : `[[${target}]]`,
          },
        ]
  })
  return applySplices(source, splices)
}
