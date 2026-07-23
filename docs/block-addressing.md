# Block addressing

Reflect keeps notes as Markdown files and makes list items addressable without turning SQLite into the source of truth. Block rows in `.reflect/index.sqlite` are rebuildable projections.

## Syntax

A durable block ID is a whitespace-delimited suffix on the lead physical line of a list item:

```markdown
- Keep Markdown as the source of truth ^k7m2q9ab
```

References and transclusions use Obsidian-compatible fragments:

```markdown
[[Architecture#^k7m2q9ab|Keep Markdown as the source of truth]]
![[Architecture#^k7m2q9ab]]
```

A **reference** navigates to a block. A **transclusion** renders the source block in another note. **Occlusion** hides material for recall and is unrelated.

The first implementation addresses list items only: ordinary, ordered, collapsed `+`, GFM checkbox, and Reflect round-task items. Paragraphs, headings, tables, and code blocks are not durable blocks.

## Identity rules

- User-authored IDs contain 1–64 ASCII letters, digits, or hyphens and at least one letter. Comparison is case-sensitive.
- Reflect-generated IDs are eight lowercase Crockford Base32 characters.
- IDs are minted only by an explicit action such as copying a block reference or selecting a block in the reference picker. Parsing, indexing, viewing, and tagging never write IDs.
- IDs are scoped to a note. Duplicate IDs remain readable but are ambiguous; navigation never chooses the first row.
- Markdown stores the ID. SQLite does not own hidden identity.

## Resolution

Reflect first resolves the complete authored wiki target as an existing note title, alias, or date. Only when that exact target is missing does it interpret the final fragment:

- `#^id` is a block fragment when `id` is valid.
- `#Heading` is a heading fragment.

This means a real note titled `Project#Plan` continues to win over treating `Plan` as a heading in `Project`.

Internal references use a readable note address and human alias. App-authored references snapshot sanitized block text into the alias so normal UI shows meaningful content rather than `Note#^id`. External `reflect://` links use a stable note ID/date plus the same fragment.

## Presentation

The suffix is storage syntax, not normal interface chrome. Meowdown removes it into editor node attributes and does not render it beside the bullet, including when the caret enters that block. References display their alias (or a note-name fallback); transclusions display native-looking source content. IDs remain visible in explicit raw-Markdown/source views and external text editors.

ID markers are excluded from block text/Markdown, note plain text, task labels, breadcrumbs, snippets, FTS, and embeddings.

## Editing semantics

- Moving or drag-reordering a list item carries its ID and addressed subtree.
- Splitting keeps the ID on the upper/original item; the new lower item has none.
- Copy/paste drops IDs so copied content becomes independent. Internal drag is a move and preserves them.
- Joining or deleting an addressed item removes its ID. Inbound references become unresolved; identity is never silently transferred.
- External edits or sync may create duplicates. Reflect reports ambiguity and never auto-repairs or first-match resolves it.
- Renaming a note rewrites only the note-address portion of references and preserves block fragments and aliases.

## Transclusion boundary

The first transclusion implementation is read-only. The source note remains the only editable content owner. Missing, ambiguous, stale, and cyclic targets render non-destructive placeholders. Expanded content is local UI only: search, embeddings, AI context, publishing, export, and clipboard serialization continue to use the authored `![[...]]` source unless a future feature explicitly defines otherwise.
