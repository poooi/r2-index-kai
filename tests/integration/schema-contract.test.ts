import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { INDEX_SCHEMA_SQL } from '../../shared/db/schema-sql'

describe('schema contract', () => {
  it('keeps the local test schema aligned with the committed D1 migration', () => {
    const migration = readFileSync('migrations/0000_fluffy_stature.sql', 'utf8')

    for (const token of [
      'CREATE TABLE `index_buckets`',
      'CREATE TABLE `objects`',
      'CREATE TABLE `folders`',
      'explicit_marker',
      'marker_seen_generation',
      'CREATE TABLE `index_runs`',
      'index_runs_by_bucket_generation_kind',
    ]) {
      expect(migration).toContain(token)
      expect(INDEX_SCHEMA_SQL.replaceAll('`', '')).toContain(
        token.replaceAll('`', '').replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '),
      )
    }
  })
})
