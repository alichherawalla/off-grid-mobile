/** Select the real Off Grid renderer, not an auxiliary clipboard or notification window. */
export function selectMainOffGridPage(targets) {
  const pages = targets.filter(
    (target) => target.type === 'page' && /Off Grid/i.test(target.title ?? ''),
  );
  const main = pages.find((target) => {
    try {
      const url = new URL(target.url);
      return !url.hash;
    } catch {
      return false;
    }
  });
  return main ?? pages.find((target) => !/#(?:clip|notification)-popup\b/i.test(target.url ?? ''));
}
