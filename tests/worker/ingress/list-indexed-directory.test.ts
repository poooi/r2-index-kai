import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { DataType } from '../../../app/components/file-listing/model'
import {
  indexedDirectoryExists,
  listIndexedDirectory,
} from '../../../app/lib/index-db'

describe('listIndexedDirectory', () => {
  it('reads directory entries from D1', async () => {
    const now = Date.now()
    await env.R2_INDEX_DB.batch([
      env.R2_INDEX_DB.prepare(
        `
INSERT INTO folders (
  bucket, prefix, parent_prefix, name, explicit_marker, marker_seen_generation, size, total_file_count, created_at, modified_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
      ).bind('poi-db', 'a/', '', 'a', 0, 0, 5, 1, now, now, now),
      env.R2_INDEX_DB.prepare(
        `
INSERT INTO objects (
  bucket, key, parent_prefix, name, size, uploaded_at, etag, seen_generation, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
      ).bind('poi-db', 'root.txt', '', 'root.txt', 4, now, 'etag', now, now),
    ])

    const rows = await listIndexedDirectory(env.R2_INDEX_DB, 'poi-db', '')

    expect(rows).toEqual([
      {
        key: 'a/',
        href: '/a/',
        type: DataType.Folder,
        size: 5,
        created: now,
        modified: now,
      },
      {
        key: 'root.txt',
        href: '/root.txt',
        type: DataType.File,
        size: 4,
        created: now,
        modified: now,
      },
    ])
  })

  it('detects empty indexed directories', async () => {
    const now = Date.now()
    await env.R2_INDEX_DB.prepare(
      `
INSERT INTO folders (
  bucket, prefix, parent_prefix, name, explicit_marker, marker_seen_generation, size, total_file_count, created_at, modified_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`,
    )
      .bind('poi-db', 'empty/', '', 'empty', 1, now, 0, 0, null, null, now)
      .run()

    await expect(
      indexedDirectoryExists(env.R2_INDEX_DB, 'poi-db', 'empty/'),
    ).resolves.toBe(true)
    await expect(
      listIndexedDirectory(env.R2_INDEX_DB, 'poi-db', 'empty/'),
    ).resolves.toEqual([])
  })
})
