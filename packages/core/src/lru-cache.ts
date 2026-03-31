/**
 * LRUCache — bounded Map-based least-recently-used cache.
 *
 * Uses Map's insertion-order property: the first entry is the oldest,
 * the last entry is the most recently used. On get(), the entry is
 * deleted and re-inserted to move it to the end. On set(), when at
 * capacity the first (oldest) entry is evicted.
 */
export class LRUCache<K, V> {
  private readonly _maxSize: number;
  private readonly _map: Map<K, V>;

  constructor(maxSize: number) {
    if (maxSize < 1) {
      throw new RangeError(`LRUCache maxSize must be >= 1, got ${maxSize}`);
    }
    this._maxSize = maxSize;
    this._map = new Map<K, V>();
  }

  get(key: K): V | undefined {
    if (!this._map.has(key)) return undefined;
    // Move to end (most recently used).
    const value = this._map.get(key) as V;
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this._map.has(key)) {
      // Remove first so re-insertion moves it to end.
      this._map.delete(key);
    } else if (this._map.size >= this._maxSize) {
      // Evict oldest (first) entry.
      const oldest = this._map.keys().next().value;
      if (oldest !== undefined) {
        this._map.delete(oldest);
      }
    }
    this._map.set(key, value);
  }

  has(key: K): boolean {
    return this._map.has(key);
  }

  delete(key: K): boolean {
    return this._map.delete(key);
  }

  clear(): void {
    this._map.clear();
  }

  get size(): number {
    return this._map.size;
  }
}
