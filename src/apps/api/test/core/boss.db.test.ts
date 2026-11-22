import type { PgBoss } from "pg-boss"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { bossDb, createBoss } from "@/core/boss.ts"
import { db } from "@/db/index.ts"

// A queue of this file's own, so its jobs can't be mistaken for anyone else's
const queue = "boss-db-test"

let boss: PgBoss

beforeAll(async () => {
  boss = createBoss("api")
  await boss.start()
  await boss.createQueue(queue)
})

afterAll(async () => {
  await boss.stop({ graceful: false })
})

// Looked up on pg-boss's own connections, so this sees only committed jobs
async function committedJob(id: string) {
  const [job] = await boss.findJobs(queue, { id })
  return job
}

class Rollback extends Error {}

describe("bossDb", () => {
  test("sends the job when the transaction commits", async () => {
    const id = await db.transaction(tx => boss.send(queue, { case: "commit" }, { db: bossDb(tx) }))

    expect(id).not.toBeNull()
    expect(await committedJob(id!)).toMatchObject({ id, data: { case: "commit" } })
  })

  test("sends nothing when the transaction rolls back", async () => {
    let id: string | null = null

    await expect(db.transaction(async (tx) => {
      id = await boss.send(queue, { case: "rollback" }, { db: bossDb(tx) })
      throw new Rollback()
    })).rejects.toBeInstanceOf(Rollback)

    expect(id).not.toBeNull()
    expect(await committedJob(id!)).toBeUndefined()
  })

  test("runs on the transaction's own connection, so the job is only visible inside it until it commits", async () => {
    await db.transaction(async (tx) => {
      const id = await boss.send(queue, { case: "visibility" }, { db: bossDb(tx) })

      const [inside] = await boss.findJobs(queue, { id: id!, db: bossDb(tx) })
      expect(inside).toMatchObject({ id })
      expect(await committedJob(id!)).toBeUndefined()
    })
  })

  // Drizzle keeps the connection private, so this is what fails if an upgrade moves it
  test("finds the connection behind a Drizzle transaction", async () => {
    await db.transaction(async (tx) => {
      const { rows } = await bossDb(tx).executeSql("select $1::int + $2::int as total", [2, 3])

      expect(rows).toEqual([{ total: 5 }])
    })
  })
})
