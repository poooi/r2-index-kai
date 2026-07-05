import { randomUUID } from 'node:crypto'
import { writeFile, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { execa } from 'execa'

const requiredEnv = (name: string) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

const optionalNumberEnv = (name: string, fallback: number) => {
  const value = process.env[name]
  return value === undefined ? fallback : Number(value)
}

const d1Database = process.env.E2E_D1_DATABASE ?? 'r2-index-kai-index'
const bucket = requiredEnv('E2E_BUCKET_NAME')
const baseUrl = requiredEnv('E2E_PUBLIC_BASE_URL')
const runId = process.env.E2E_RUN_ID ?? randomUUID()
const prefix = process.env.E2E_TEST_PREFIX ?? `__r2-index-test/${runId}/`
const key = `${prefix}fixture.txt`
const timeoutMs = optionalNumberEnv('E2E_TIMEOUT_MS', 180_000)
const pollMs = optionalNumberEnv('E2E_POLL_MS', 5_000)

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`

const run = async (command: string, args: string[]) => {
  const result = await execa(command, args, {
    stdio: 'pipe',
    env: process.env,
  })
  return result.stdout
}

const wrangler = (args: string[]) => run('wrangler', args)

const queryD1 = async <T>(sql: string): Promise<T[]> => {
  const stdout = await wrangler([
    'd1',
    'execute',
    d1Database,
    '--remote',
    '--json',
    '--command',
    sql,
  ])
  const parsed = JSON.parse(stdout) as Array<{ results?: T[] }>
  return parsed.flatMap((entry) => entry.results ?? [])
}

const executeD1 = (sql: string) =>
  wrangler([
    'd1',
    'execute',
    d1Database,
    '--remote',
    '--command',
    sql,
  ])

const waitFor = async (label: string, predicate: () => Promise<boolean>) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

const getObjectCount = async () => {
  const rows = await queryD1<{ count: number }>(
    `SELECT COUNT(*) AS count FROM objects WHERE bucket = ${sqlString(
      bucket,
    )} AND key = ${sqlString(key)}`,
  )
  return rows[0]?.count ?? 0
}

const cleanup = async () => {
  await wrangler([
    'r2',
    'object',
    'delete',
    `${bucket}/${key}`,
    '--remote',
    '--force',
  ]).catch(() => undefined)

  await executeD1(
    [
      `DELETE FROM objects WHERE bucket = ${sqlString(
        bucket,
      )} AND key = ${sqlString(key)}`,
      `DELETE FROM folders WHERE bucket = ${sqlString(
        bucket,
      )} AND prefix = ${sqlString(prefix)}`,
    ].join(';'),
  ).catch(() => undefined)
}

const main = async () => {
  const file = path.join(os.tmpdir(), `r2-index-e2e-${runId}.txt`)
  await writeFile(file, `r2-index-e2e ${runId}\n`)

  try {
    await cleanup()
    await wrangler([
      'r2',
      'object',
      'put',
      `${bucket}/${key}`,
      '--file',
      file,
      '--remote',
      '--force',
      '--content-type',
      'text/plain',
    ])

    await waitFor('create event to index object', async () => {
      return (await getObjectCount()) === 1
    })

    const listingUrl = new URL(prefix, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
    const listingResponse = await fetch(listingUrl)
    if (!listingResponse.ok) {
      throw new Error(
        `Expected indexed listing ${listingUrl.toString()} to return 2xx, got ${listingResponse.status}`,
      )
    }
    const html = await listingResponse.text()
    if (!html.includes('fixture.txt')) {
      throw new Error('Indexed listing did not include fixture.txt')
    }

    await wrangler([
      'r2',
      'object',
      'delete',
      `${bucket}/${key}`,
      '--remote',
      '--force',
    ])

    await waitFor('delete event to remove object', async () => {
      return (await getObjectCount()) === 0
    })
  } finally {
    await cleanup()
    await unlink(file).catch(() => undefined)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
