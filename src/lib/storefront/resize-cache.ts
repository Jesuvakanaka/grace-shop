// In-process LRU of resized public pictures (ZP-484), bounded by bytes.
//
// Why in memory and not in storage: the public route is unauthenticated, so
// writing to the bucket from it would let anonymous traffic create objects
// (cost and abuse), and would need write access from the public path. The
// set of entries is small (public keys x 7 widths), resizing a <=1200px WebP
// takes milliseconds, and a cold instance simply recomputes. The cache is
// only read AFTER the visibility check, so it never decides what is public.

export class ByteLruCache {
  private readonly entries = new Map<string, Buffer>()
  private total = 0

  constructor(readonly maxBytes: number) {}

  get size(): number {
    return this.entries.size
  }

  get bytes(): number {
    return this.total
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  get(key: string): Buffer | undefined {
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    this.entries.delete(key) // Map order = least recently used first
    this.entries.set(key, value)
    return value
  }

  set(key: string, value: Buffer): void {
    this.delete(key)
    if (value.length > this.maxBytes) return
    while (this.total + value.length > this.maxBytes) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.delete(oldest)
    }
    this.entries.set(key, value)
    this.total += value.length
  }

  delete(key: string): void {
    const old = this.entries.get(key)
    if (old === undefined) return
    this.entries.delete(key)
    this.total -= old.length
  }
}
