// ZP-507: love counts in the database. Server only.
//
// Product.loveCount moves only together with a ProductLove row, in one
// transaction that first locks the product row (so loves, un-loves and the
// owner's reset of a piece are serialised): a love inserts the hash (ON CONFLICT DO NOTHING) and adds 1
// only if the row is new; an un-love deletes the hash and subtracts 1 only if
// a row was deleted, and only while the count is above 0 (plus a CHECK
// constraint). Concurrent duplicate taps therefore count once. The counter is
// changed with plain SQL so the product's updatedAt is not touched (a heart is
// not an edit of the piece).
// The storefront reads the count through the cached catalogue (60 s), so
// a tap never expires the cache. Tested in tests/loves-endpoint-db.test.ts.
import type { PrismaClient } from '@prisma/client'

type Db = Pick<PrismaClient, '$transaction'>

/** Love (on) or un-love a piece for one device hash. Returns whether it changed and the count now. */
export async function setLove(db: Db, productId: number, hash: string, on: boolean): Promise<{ changed: boolean; loves: number }> {
  return db.$transaction(async (tx) => {
    // Lock the product row first, like resetLoves: loves, un-loves and resets
    // of one piece take their locks in the same order (no deadlock) and run
    // one after the other.
    await tx.$queryRaw`SELECT 1 FROM "Product" WHERE "id" = ${productId} FOR UPDATE`
    let changed: boolean
    if (on) {
      const { count } = await tx.productLove.createMany({ data: [{ productId, hash }], skipDuplicates: true })
      changed = count === 1
      if (changed) await tx.$executeRaw`UPDATE "Product" SET "loveCount" = "loveCount" + 1 WHERE "id" = ${productId}`
    } else {
      const { count } = await tx.productLove.deleteMany({ where: { productId, hash } })
      changed = count > 0
      if (changed) {
        await tx.$executeRaw`UPDATE "Product" SET "loveCount" = "loveCount" - 1 WHERE "id" = ${productId} AND "loveCount" > 0`
      }
    }
    const row = await tx.product.findUnique({ where: { id: productId }, select: { loveCount: true } })
    return { changed, loves: row?.loveCount ?? 0 }
  })
}

/** Owner reset (e.g. after abuse): count 0 and every heart of the piece forgotten, so phones can love it again. */
export async function resetLoves(db: Db, productId: number): Promise<{ removed: number }> {
  return db.$transaction(async (tx) => {
    // The product row first: its lock makes a concurrent love / un-love (which
    // updates the same row) wait until the reset commits, or the reset wait
    // for it, so the count and the hashes never disagree afterwards.
    await tx.$executeRaw`UPDATE "Product" SET "loveCount" = 0 WHERE "id" = ${productId}`
    const { count } = await tx.productLove.deleteMany({ where: { productId } })
    return { removed: count }
  })
}
