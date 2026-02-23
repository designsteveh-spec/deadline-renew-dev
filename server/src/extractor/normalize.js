export function normalizeText(raw) {
  const safe = String(raw || "").replace(/\r\n/g, "\n");
  // Trim only spaces/tabs at edges so form-feed (\f) page markers can survive PDF parsing.
  const lines = safe.split("\n").map((l) => l.replace(/[ \t]+/g, " ").replace(/^[ \t]+|[ \t]+$/g, ""));
  const text = lines.join("\n");
  const lineStarts = [];
  let cursor = 0;
  for (const line of lines) {
    lineStarts.push(cursor);
    cursor += line.length + 1;
  }
  return { text, lines, lineStarts };
}

export function snippetAround(text, index, radius = 180) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}
