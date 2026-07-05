// Server-side spam detection for user-submitted text (Arabic + Latin).
// Rejects obvious low-quality / spam content while accepting legitimate
// short complaints.

const KEYBOARD_SEQUENCES = [
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "azertyuiop",
  "qsdfghjklm",
  "wxcvbn",
  "1234567890",
  "0987654321",
  "ضصثقفغعهخحجد",
  "شسيبلاتنمكط",
  "ئءؤرلاىةوزظ",
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function hasExcessiveRepetition(s: string): boolean {
  // Reject only when repetition dominates the text: either a very long run
  // (7+ identical chars) or the longest run covers >= 50% of non-space chars,
  // or the text has fewer than 3 distinct non-space chars.
  const compact = s.replace(/\s+/g, "");
  if (compact.length === 0) return false;
  const distinct = new Set(compact).size;
  if (compact.length >= 5 && distinct < 3) return true;
  const m = compact.match(/(\S)\1{6,}/u);
  if (m) return true;
  const longest = compact.match(/(\S)\1{3,}/u);
  if (longest && longest[0].length >= Math.ceil(compact.length / 2)) return true;
  return false;
}

function containsKeyboardSmash(s: string): boolean {
  const norm = normalize(s);
  if (norm.length < 5) return false;
  for (const seq of KEYBOARD_SEQUENCES) {
    for (let i = 0; i + 5 <= seq.length; i++) {
      const chunk = seq.slice(i, i + 5);
      if (norm.includes(chunk)) return true;
      const rev = chunk.split("").reverse().join("");
      if (norm.includes(rev)) return true;
    }
  }
  return false;
}

function tokenize(s: string): string[] {
  return s
    .split(/[\s\p{P}\p{S}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

export type SpamCheckOptions = {
  minLength: number;
  requireMultipleWords?: boolean;
  minDistinctWords?: number;
};

export function detectSpam(
  raw: string,
  opts: SpamCheckOptions,
): string | null {
  const text = (raw ?? "").trim();
  if (text.length < opts.minLength) {
    return `النص قصير جداً، يجب ألا يقل عن ${opts.minLength} حرفاً.`;
  }
  if (hasExcessiveRepetition(text)) {
    return "يبدو النص مكوّناً من حروف متكررة. الرجاء كتابة وصف حقيقي للمشكلة.";
  }
  if (containsKeyboardSmash(text)) {
    return "يبدو النص عشوائياً (ضغط عشوائي على لوحة المفاتيح). الرجاء كتابة وصف حقيقي.";
  }
  if (opts.requireMultipleWords) {
    const tokens = tokenize(text);
    const distinct = new Set(tokens.map((t) => t.toLowerCase()));
    const minDistinct = opts.minDistinctWords ?? 3;
    if (distinct.size < minDistinct) {
      return "الوصف غير كافٍ. الرجاء كتابة جملة مفهومة تصف المشكلة.";
    }
  }
  return null;
}
