import { env } from 'cloudflare:workers'
import { reset } from 'cloudflare:test'
import { afterEach, beforeEach } from 'vitest'

import type { IndexerEnv, IngressEnv } from '~/env'
import { INDEX_SCHEMA_SQL } from '../../shared/db/schema-sql'

declare module 'cloudflare:workers' {
  interface ProvidedEnv extends IndexerEnv, IngressEnv {}
}

beforeEach(async () => {
  for (const statement of INDEX_SCHEMA_SQL.split(';')) {
    const sql = statement.trim()
    if (sql) {
      await env.R2_INDEX_DB.prepare(sql).run()
    }
  }
})

afterEach(async () => {
  await reset()
})
