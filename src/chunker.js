/**
 * Split text into overlapping chunks, preferring paragraph / sentence /
 * Thai-space boundaries so chunks stay readable.
 */
export function chunkText(text, size = 800, overlap = 100) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (overlap >= size) overlap = Math.floor(size / 4);

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf(" ")
      );
      if (breakAt > size * 0.5) end = start + breakAt + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
