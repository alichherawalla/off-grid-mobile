/** Memoize a composition so module order never matters: every export here is a function. */
export function once<T>(create: () => T): () => T {
  let made = false;
  let value: T | undefined;
  return () => {
    if (!made) {
      value = create();
      made = true;
    }
    return value as T;
  };
}
