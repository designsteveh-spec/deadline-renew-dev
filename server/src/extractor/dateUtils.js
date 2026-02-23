const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";
const SHORT_MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const NUMBER_WORD_UNITS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19
};
const NUMBER_WORD_TENS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};
const NUMBER_WORD_REGEX =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\\s](?:one|two|three|four|five|six|seven|eight|nine))?";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function normalizeYear(yearRaw) {
  const year = Number(yearRaw);
  if (String(yearRaw).length === 2) {
    return 2000 + year;
  }
  return year;
}

function monthNameToNumber(name) {
  const v = name.toLowerCase();
  const map = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    sept: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12
  };
  return map[v] || null;
}

function parseNumberToken(raw) {
  if (!raw) return null;
  const normalized = String(raw)
    .toLowerCase()
    .replace(/[,'".]/g, "")
    .replace(/\band\b/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) return Number(normalized);

  const tokens = normalized.split(" ");
  let total = 0;
  let current = 0;
  for (const token of tokens) {
    if (NUMBER_WORD_UNITS[token] !== undefined) {
      current += NUMBER_WORD_UNITS[token];
    } else if (NUMBER_WORD_TENS[token] !== undefined) {
      current += NUMBER_WORD_TENS[token];
    } else if (token === "hundred") {
      current = Math.max(1, current) * 100;
    } else if (token === "thousand") {
      total += Math.max(1, current) * 1000;
      current = 0;
    } else {
      return null;
    }
  }
  return total + current;
}

function toDays(value, unitRaw = "days") {
  const n = Number(value);
  const unit = String(unitRaw).toLowerCase();
  if (Number.isNaN(n)) return 0;
  if (unit.startsWith("week")) return n * 7;
  if (unit.startsWith("month")) return n * 30;
  if (unit.startsWith("year")) return n * 365;
  return n;
}

function directionFromToken(token, fallback = -1) {
  const t = String(token || "").toLowerCase();
  if (t.includes("after") || t.includes("following") || t.includes("of") || t.includes("from")) return 1;
  if (t.includes("before") || t.includes("prior")) return -1;
  return fallback;
}

function inferAnchorHint(snippet) {
  const s = String(snippet || "").toLowerCase();
  if (s.includes("renewal") || s.includes("renew")) return "renewal";
  if (s.includes("term end") || s.includes("end of term") || s.includes("expiration") || s.includes("expires")) return "term_end";
  if (s.includes("effective date") || s.includes("commencement") || s.includes("start date")) return "effective";
  if (s.includes("invoice") || s.includes("billing")) return "invoice";
  if (s.includes("execution")) return "execution";
  if (s.includes("receipt")) return "receipt";
  if (s.includes("notice")) return "notice";
  if (s.includes("request")) return "request";
  if (s.includes("approval")) return "approval";
  return null;
}

function pushRelative(out, lineStarts, { amount, unit, direction, snippet, index }) {
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
  out.push({
    offsetDays: toDays(parsedAmount, unit),
    direction,
    snippet,
    index,
    line: positionToLine(index, lineStarts),
    anchorHint: inferAnchorHint(snippet)
  });
}

export function toIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== m ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function addDays(isoDate, offsetDays) {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function detectAbsoluteDates(text, lineStarts) {
  const matches = [];

  const patterns = [
    {
      re: new RegExp(
        `\\b(${MONTHS}|${SHORT_MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{2,4})\\b`,
        "gi"
      ),
      parse: (m) => {
        const month = monthNameToNumber(m[1]);
        const day = Number(m[2]);
        const year = normalizeYear(m[3]);
        return toIsoDate(year, month, day);
      }
    },
    {
      re: new RegExp(
        `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS}|${SHORT_MONTHS})\\.?[,]?\\s+(\\d{2,4})\\b`,
        "gi"
      ),
      parse: (m) => {
        const day = Number(m[1]);
        const month = monthNameToNumber(m[2]);
        const year = normalizeYear(m[3]);
        return toIsoDate(year, month, day);
      }
    },
    {
      re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
      parse: (m) => toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]))
    },
    {
      re: /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g,
      parse: (m) => {
        const month = Number(m[1]);
        const day = Number(m[2]);
        const year = normalizeYear(m[3]);
        return toIsoDate(year, month, day);
      }
    }
  ];

  for (const p of patterns) {
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const iso = p.parse(m);
      if (!iso) continue;
      const index = m.index;
      matches.push({
        isoDate: iso,
        original: m[0],
        index,
        line: positionToLine(index, lineStarts)
      });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

export function detectRelativeDates(text, lineStarts) {
  const rel = [];

  const numericPatterns = [
    /\bwithin\s+(\d{1,3})\s+days\b/gi,
    /\bwithin\s+(\d{1,3})\s+business\s+days\b/gi,
    /\b(\d{1,3})\s+days?\s+prior\b/gi,
    /\b(\d{1,3})\s+business\s+days?\s+prior\b/gi,
    /\bno\s+later\s+than\s+(\d{1,3})\s+days?\s+after\b/gi,
    /\bno\s+later\s+than\s+(\d{1,3})\s+days?\s+prior\s+to\b/gi,
    /\b(\d{1,3})\s+days?\s+before\s+the\s+end\s+of\s+the\s+term\b/gi,
    /\b(\d{1,3})\s+days?\s+prior\s+to\s+renewal\b/gi,
    /\b(\d{1,3})\s+days?\s+after\s+invoice\b/gi,
    /\b(\d{1,3})\s+days?\s+of\s+execution\b/gi
  ];

  for (const re of numericPatterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const snippet = m[0];
      const lower = snippet.toLowerCase();
      const direction = lower.includes("after") || lower.includes("within") || lower.includes("of execution") ? 1 : -1;
      pushRelative(rel, lineStarts, {
        amount: Number(m[1]),
        unit: "days",
        direction,
        snippet,
        index: m.index
      });
    }
  }

  const legalParenPatterns = [
    {
      re: /\bwithin\s+\w+\s*\((\d{1,3})\)\s*(business\s+|calendar\s+)?(days?|weeks?|months?|years?)\b/gi,
      amountIndex: 1,
      unitIndex: 3,
      direction: 1
    },
    {
      re: /\bno\s+later\s+than\s+\w+\s*\((\d{1,3})\)\s*(business\s+|calendar\s+)?(days?|weeks?|months?|years?)\s+(after|following|before|prior\s+to)\b/gi,
      amountIndex: 1,
      unitIndex: 3,
      tokenIndex: 4,
      direction: -1
    },
    {
      re: /\b\w+\s*\((\d{1,3})\)\s*(business\s+|calendar\s+)?(days?|weeks?|months?|years?)(?:['’]s?)?\s+(prior\s+to|before|after|following|of|from)\b/gi,
      amountIndex: 1,
      unitIndex: 3,
      tokenIndex: 4,
      direction: -1
    },
    {
      re: /\b\w+\s*\((\d{1,3})\)\s*(business\s+|calendar\s+)?(days?|weeks?|months?|years?)(?:['’]s?)?\s+(?:written\s+)?notice\b/gi,
      amountIndex: 1,
      unitIndex: 3,
      direction: -1
    },
    {
      re: /\b(?:at\s+least|not\s+less\s+than)\s+(\d{1,3})\s*(business\s+|calendar\s+)?(days?|weeks?|months?|years?)\s+(before|prior\s+to|after|following)\b/gi,
      amountIndex: 1,
      unitIndex: 3,
      tokenIndex: 4,
      direction: -1
    },
    {
      re: /\b(\d{1,3})\s*(business\s+|calendar\s+)?(days?|weeks?|months?|years?)\s+(before|prior\s+to|after|following|of|from)\b/gi,
      amountIndex: 1,
      unitIndex: 3,
      tokenIndex: 4,
      direction: -1
    },
    {
      re: /\b\((\d{1,3})\)\s*(business\s+|calendar\s+)?(days?|weeks?|months?|years?)\s+(before|prior\s+to|after|following|of|from)\b/gi,
      amountIndex: 1,
      unitIndex: 3,
      tokenIndex: 4,
      direction: -1
    }
  ];

  for (const p of legalParenPatterns) {
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const unit = m[p.unitIndex] || "days";
      const snippet = m[0];
      const dir = p.tokenIndex ? directionFromToken(m[p.tokenIndex], p.direction) : p.direction;
      pushRelative(rel, lineStarts, {
        amount: Number(m[p.amountIndex]),
        unit,
        direction: dir,
        snippet,
        index: m.index
      });
    }
  }

  const wordPatterns = [
    {
      re: new RegExp(`\\bwithin\\s+(${NUMBER_WORD_REGEX})\\s+(business\\s+|calendar\\s+)?(days?|weeks?|months?|years?)\\b`, "gi"),
      amountIndex: 1,
      unitIndex: 3,
      direction: 1
    },
    {
      re: new RegExp(
        `\\bno\\s+later\\s+than\\s+(${NUMBER_WORD_REGEX})\\s+(business\\s+|calendar\\s+)?(days?|weeks?|months?|years?)\\s+(before|prior\\s+to|after|following|from|of)\\b`,
        "gi"
      ),
      amountIndex: 1,
      unitIndex: 3,
      tokenIndex: 4,
      direction: -1
    },
    {
      re: new RegExp(
        `\\b(${NUMBER_WORD_REGEX})\\s+(business\\s+|calendar\\s+)?(days?|weeks?|months?|years?)(?:['’]s?)?\\s+(prior\\s+to|before|after|following|from|of)\\b`,
        "gi"
      ),
      amountIndex: 1,
      unitIndex: 3,
      tokenIndex: 4,
      direction: -1
    },
    {
      re: new RegExp(
        `\\b(${NUMBER_WORD_REGEX})\\s+(business\\s+|calendar\\s+)?(days?|weeks?|months?|years?)(?:['’]s?)?\\s+(?:written\\s+)?notice\\b`,
        "gi"
      ),
      amountIndex: 1,
      unitIndex: 3,
      direction: -1
    }
  ];

  for (const p of wordPatterns) {
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const amount = parseNumberToken(m[p.amountIndex]);
      if (!amount) continue;
      const unit = m[p.unitIndex] || "days";
      const snippet = m[0];
      const dir = p.tokenIndex ? directionFromToken(m[p.tokenIndex], p.direction) : p.direction;
      pushRelative(rel, lineStarts, {
        amount,
        unit,
        direction: dir,
        snippet,
        index: m.index
      });
    }
  }

  const dedup = new Map();
  for (const r of rel) {
    const key = `${r.index}|${r.offsetDays}|${r.direction}|${r.snippet.toLowerCase()}`;
    if (!dedup.has(key)) dedup.set(key, r);
  }
  return [...dedup.values()].sort((a, b) => a.index - b.index);
}

function positionToLine(pos, lineStarts) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lineStarts[mid] <= pos) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, hi);
}
