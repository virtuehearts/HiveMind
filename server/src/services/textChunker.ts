const TOKEN_CHAR_RATIO = 4;
const MIN_TOKENS = 1000;
const MAX_TOKENS = 2000;

const maxChars = MAX_TOKENS * TOKEN_CHAR_RATIO;
const minChars = MIN_TOKENS * TOKEN_CHAR_RATIO;

function breakLongText(text: string): string[] {
  if (text.length <= maxChars) return [text];

  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    pieces.push(text.slice(start, end).trim());
    start = end;
  }
  return pieces.filter(Boolean);
}

export function chunkText(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);

  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = '';
    }
  };

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    const next = current ? `${current} ${trimmed}` : trimmed;

    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current.length >= minChars) {
      pushCurrent();
      current = trimmed;
      continue;
    }

    const broken = breakLongText(next);
    for (const piece of broken) {
      if (piece.length >= minChars || current.length === 0) {
        chunks.push(piece.trim());
      } else {
        current = current ? `${current} ${piece}` : piece;
      }
    }
    current = '';
  }

  if (current.length && (current.length >= minChars || !chunks.length)) {
    pushCurrent();
  } else if (current.length && chunks.length) {
    const last = chunks.pop();
    if (last) {
      chunks.push(`${last}\n${current}`.trim());
    }
  }

  return chunks;
}

export { TOKEN_CHAR_RATIO };
