import { describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { applyProjection, connectIndex, openMigratedIndex, project } from './flow-test-harness'
import { getBacklinks } from './queries-backlinks'
import { getBlockById, resolveWikiAddress } from './queries-blocks'
import { getRenameLinkSources } from './queries'

describe('block projection and wiki-address resolution', () => {
  it('resolves exact notes before fragments and refuses duplicate block IDs', async () => {
    const database = openMigratedIndex()
    applyProjection(
      database,
      project(
        'notes/architecture.md',
        '# Architecture\n\n- Addressable block ^alpha\n- Duplicate one ^dupe\n- Duplicate two ^dupe\n',
        10,
      ),
    )
    applyProjection(database, project('notes/exact.md', '# Architecture#^alpha\n', 11))
    applyProjection(database, project('notes/components.md', '# Components\n\n- Item ^alpha\n', 12))
    applyProjection(database, project('notes/source.md', '[[Architecture#^dupe]]\n', 13))
    connectIndex(database)

    try {
      await expect(resolveWikiAddress('Architecture#^alpha')).resolves.toEqual({
        kind: 'note',
        path: 'notes/exact.md',
      })
      await expect(resolveWikiAddress('Architecture#Overview')).resolves.toEqual({
        kind: 'heading',
        path: 'notes/architecture.md',
        heading: 'Overview',
      })
      await expect(resolveWikiAddress('Components#^alpha')).resolves.toEqual({
        kind: 'block',
        path: 'notes/components.md',
        blockId: 'alpha',
        ordinal: 0,
        text: 'Item',
      })
      await expect(resolveWikiAddress('Components#^Alpha')).resolves.toEqual({
        kind: 'missing',
        target: 'Components#^Alpha',
        path: 'notes/components.md',
        fragmentKind: 'block',
        fragmentValue: 'Alpha',
      })
      await expect(getBlockById('notes/architecture.md', 'dupe')).resolves.toEqual({
        kind: 'ambiguous',
        notePath: 'notes/architecture.md',
        blockId: 'dupe',
        count: 2,
      })
      await expect(resolveWikiAddress('Architecture#^dupe')).resolves.toEqual({
        kind: 'ambiguousBlock',
        path: 'notes/architecture.md',
        blockId: 'dupe',
        count: 2,
      })
      await expect(getBacklinks('notes/architecture.md')).resolves.toMatchObject([
        {
          fragmentKind: 'block',
          fragmentValue: 'dupe',
          blockAvailability: 'ambiguous',
          targetBlockId: null,
          targetBlockText: null,
        },
      ])
    } finally {
      setBridge(null)
      database.close()
    }
  })

  it('uses ordinary date/alias precedence, includes private local notes, and excludes templates', async () => {
    const database = openMigratedIndex()
    applyProjection(
      database,
      project(
        'notes/canonical.md',
        '---\naliases: [Alternate]\nprivate: true\n---\n# Canonical\n\n- Private block ^private\n',
        10,
      ),
    )
    applyProjection(database, project('daily/2026-07-22.md', '- Daily block ^daily\n', 11))
    applyProjection(
      database,
      project('templates/hidden.md', '# Hidden\n\n- Template block ^template\n', 12),
    )
    connectIndex(database)

    try {
      await expect(resolveWikiAddress('Alternate#^private')).resolves.toMatchObject({
        kind: 'block',
        path: 'notes/canonical.md',
        blockId: 'private',
      })
      await expect(resolveWikiAddress('2026-07-22#^daily')).resolves.toMatchObject({
        kind: 'block',
        path: 'daily/2026-07-22.md',
        blockId: 'daily',
      })
      await expect(resolveWikiAddress('Hidden#^template')).resolves.toEqual({
        kind: 'missing',
        target: 'Hidden#^template',
      })
    } finally {
      setBridge(null)
      database.close()
    }
  })

  it('projects searchable block text without indexing the technical marker', () => {
    const database = openMigratedIndex()
    const note = project(
      'notes/project.md',
      '# Project\n\n- Parent context\n  - Searchable child ^child-id\n',
      10,
    )
    applyProjection(database, note)

    try {
      const block = database
        .prepare(
          `SELECT block_id, text, markdown, breadcrumbs
           FROM blocks WHERE note_path = ? AND block_id = ?`,
        )
        .get('notes/project.md', 'child-id')
      expect(block).toEqual({
        block_id: 'child-id',
        text: 'Searchable child',
        markdown: '- Searchable child',
        breadcrumbs: '["Parent context"]',
      })
      expect(
        database
          .prepare('SELECT text, context FROM blocks_fts WHERE note_path = ? AND ordinal = ?')
          .get('notes/project.md', 1),
      ).toEqual({ text: 'Searchable child', context: 'Parent context' })
    } finally {
      database.close()
    }
  })

  it('selects only exact-first-owned targets for note-title rewrites', async () => {
    const database = openMigratedIndex()
    applyProjection(database, project('notes/old.md', '# Old\n', 10))
    applyProjection(database, project('notes/literal.md', '# Old#Literal\n', 11))
    applyProjection(
      database,
      project(
        'notes/source.md',
        '[[Old]] [[Old#Other]] [[Old#Literal]] ![[Old#^block]]\n',
        12,
      ),
    )
    connectIndex(database)

    try {
      await expect(getRenameLinkSources('old', 'notes/old.md')).resolves.toEqual([
        {
          sourcePath: 'notes/source.md',
          candidates: [
            { target: 'Old', mode: 'exact' },
            { target: 'Old#Other', mode: 'fragment-base' },
            { target: 'Old#^block', mode: 'fragment-base' },
          ],
        },
      ])
    } finally {
      setBridge(null)
      database.close()
    }
  })

  it('projects exact-first backlink fragments and valid embed places', async () => {
    const database = openMigratedIndex()
    applyProjection(database, project('notes/project.md', '# Project\n\n- Source ^block\n', 10))
    applyProjection(database, project('notes/project-fragment.md', '# Project#^block\n', 11))
    applyProjection(database, project('notes/document.md', '# Document\n\n- Embedded ^block\n', 12))
    applyProjection(
      database,
      project(
        'notes/source.md',
        '# Source\n\n[[Project#^block]]\n![[Project#^block]]\n[[Document#^block]]\n![[Document#^block]]\n[[Document#^absent]]\n![[Missing#^block]]\n',
        13,
      ),
    )

    connectIndex(database)
    try {
      const backlinks = database
        .prepare(
          `SELECT target_path, fragment_kind, fragment_value, wiki_syntax
           FROM backlinks WHERE source_path = ? ORDER BY pos_from`,
        )
        .all('notes/source.md')
      expect(backlinks).toEqual([
        {
          target_path: 'notes/project-fragment.md',
          fragment_kind: null,
          fragment_value: null,
          wiki_syntax: 'reference',
        },
        {
          target_path: 'notes/project-fragment.md',
          fragment_kind: null,
          fragment_value: null,
          wiki_syntax: 'embed',
        },
        {
          target_path: 'notes/document.md',
          fragment_kind: 'block',
          fragment_value: 'block',
          wiki_syntax: 'reference',
        },
        {
          target_path: 'notes/document.md',
          fragment_kind: 'block',
          fragment_value: 'block',
          wiki_syntax: 'embed',
        },
        {
          target_path: 'notes/document.md',
          fragment_kind: 'block',
          fragment_value: 'absent',
          wiki_syntax: 'reference',
        },
      ])
      await expect(getBacklinks('notes/document.md')).resolves.toMatchObject([
        {
          sourcePath: 'notes/source.md',
          fragmentKind: 'block',
          fragmentValue: 'block',
          blockAvailability: 'resolved',
          targetBlockOrdinal: 0,
        },
        {
          sourcePath: 'notes/source.md',
          fragmentKind: 'block',
          fragmentValue: 'block',
          blockAvailability: 'resolved',
          targetBlockOrdinal: 0,
          targetBlockId: 'block',
          targetBlockText: 'Embedded',
        },
        {
          sourcePath: 'notes/source.md',
          fragmentKind: 'block',
          fragmentValue: 'absent',
          blockAvailability: 'missing',
          targetBlockOrdinal: null,
          targetBlockId: null,
          targetBlockText: null,
        },
      ])
      expect(
        database
          .prepare(
            'SELECT target_path, source_path, block_id, embed_ordinal FROM block_embed_places',
          )
          .get(),
      ).toEqual({
        target_path: 'notes/document.md',
        source_path: 'notes/source.md',
        block_id: 'block',
        embed_ordinal: 1,
      })
    } finally {
      setBridge(null)
      database.close()
    }
  })
})
