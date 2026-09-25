/**
 * Runs tasks over an iterable or async iterable with bounded concurrency.
 *
 * @param items The items to process (array, iterable, or async iterable).
 * @param concurrency Maximum number of active workers running concurrently.
 * @param worker Async function invoked for each item.
 * @param onProgress Callback invoked after each item finishes (successfully or with error).
 */
export async function runWithConcurrency<T>(
  items: AsyncIterable<T> | Iterable<T>,
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  onProgress: (completed: number, total: number) => void,
): Promise<void> {
  const isArray = Array.isArray(items);
  const total = isArray ? (items as T[]).length : typeof (items as any)?.length === "number" ? (items as any).length : 0;

  const iterator: Iterator<T> | AsyncIterator<T> =
    Symbol.asyncIterator in items
      ? (items as AsyncIterable<T>)[Symbol.asyncIterator]()
      : (items as Iterable<T>)[Symbol.iterator]();

  let completed = 0;
  let index = 0;
  let pullChain: Promise<unknown> = Promise.resolve();

  async function pullNext(): Promise<{ item: T; idx: number } | null> {
    return new Promise((resolve, reject) => {
      pullChain = pullChain.then(async () => {
        try {
          const currentIdx = index++;
          const res = await iterator.next();
          if (res.done) {
            resolve(null);
          } else {
            resolve({ item: res.value, idx: currentIdx });
          }
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async function runWorker(): Promise<void> {
    while (true) {
      const next = await pullNext();
      if (!next) break;

      try {
        await worker(next.item, next.idx);
      } catch (err) {
        // If an item throws, catch it and continue
        console.error(`Import worker error on item ${next.idx}:`, err);
      } finally {
        completed++;
        onProgress(completed, total > 0 ? total : completed);
      }
    }
  }

  const workerCount = Math.max(1, total > 0 ? Math.min(concurrency, total) : concurrency);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(runWorker());
  }

  await Promise.all(workers);
}
