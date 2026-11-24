import "server-only";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 外部 API ごとの簡易レートリミッタ。
 * 前回の実行開始から minIntervalMs 空けてから次を実行する（同時実行は concurrency まで）。
 */
export function rateLimiter(minIntervalMs: number, concurrency = 1) {
  let last = 0;
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    const wait = Math.max(0, last + minIntervalMs - Date.now());
    active++;
    setTimeout(() => {
      last = Date.now();
      const run = queue.shift();
      run?.();
    }, wait);
  };

  return function schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}

/** 有効期限つきの簡易メモリキャッシュ */
export function memo<T>(ttlMs: number) {
  const store = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string, fn: () => Promise<T>): Promise<T> => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = fn().catch((e) => {
      store.delete(key);
      throw e;
    });
    store.set(key, { at: Date.now(), value });
    return value;
  };
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
