import crypto from "node:crypto";
import { addDays, detectAbsoluteDates, detectRelativeDates } from "./dateUtils.js";
import { normalizeText, snippetAround } from "./normalize.js";

const TYPE_KEYWORDS = {
  renewal: ["renew", "renewal", "auto-renew", "extend", "extension", "successive term"],
  notice: [
    "notice",
    "notify",
    "termination",
    "cancel",
    "approval",
    "request",
    "deliver",
    "provided",
    "written notice",
    "promptly"
  ],
  payment: ["payment due", "invoice", "billed", "fee due", "payable", "fees", "compensation", "paid", "payment"],
  term_end: ["expiration", "expires", "end of term", "expire", "termination date", "term ends"],
  trial_end: ["trial", "free trial", "trial period"]
};

const TYPE_LABELS = {
  renewal: "Renewal",
  notice: "Notice Deadline",
  payment: "Payment Due",
  term_end: "Term End",
  trial_end: "Trial End",
  other: "Other"
};

const OBLIGATION_TERMS = [
  "must",
  "shall",
  "required",
  "due",
  "no later than",
  "prior to",
  "before",
  "after",
  "within",
  "at least",
  "not less than",
  "terminate",
  "cancellation",
  "cancel",
  "notice",
  "renewal",
  "auto-renew",
  "expires",
  "expiration",
  "invoice",
  "payment due",
  "fee due",
  "trial",
  "provide",
  "deliver",
  "submit",
  "furnish",
  "payable"
];

const DEADLINE_SIGNAL_TERMS = [
  "within",
  "no later than",
  "prior to",
  "before",
  "after",
  "by ",
  "due",
  "deadline",
  "renewal",
  "renew",
  "auto-renew",
  "expiration",
  "expires",
  "end of term",
  "term end",
  "termination date",
  "invoice",
  "payment due",
  "written notice",
  "business days",
  "calendar days",
  "days of",
  "days from",
  "days following"
];

const REGULATORY_NOISE_TERMS = [
  "federal register",
  "guidance",
  "regulation",
  "regulations",
  "nist",
  "u.s.c.",
  "cfr",
  "public law",
  "statute",
  "promulgated"
];

const CONTRACT_CONTEXT_TERMS = [
  "agreement",
  "contract",
  "term",
  "effective date",
  "services",
  "party",
  "parties",
  "statement of work",
  "renewal",
  "notice",
  "invoice",
  "payment",
  "vendor",
  "contractor",
  "client"
];

const ANCHOR_KEYWORDS = {
  renewal: ["renew", "renewal", "auto-renew", "extension", "successive term"],
  term_end: ["end of term", "term end", "expires", "expiration", "termination date"],
  effective: ["effective date", "commencement", "start date"],
  invoice: ["invoice", "billing date", "billed", "statement date"],
  execution: ["execution", "executed"],
  receipt: ["receipt", "received"]
};

const STRONG_OBLIGATION_TERMS = ["must", "shall", "required", "no later than", "prior to", "within", "due", "at least"];
const PRIORITY_SCORE = {
  high: 3,
  medium: 2,
  low: 1
};
const DEADLINE_CONFIDENCE_LABELS = {
  hard: "Hard deadline",
  autoRenewal: "Auto-renewal",
  soft: "Soft / implied",
  penaltyBacked: "Penalty-backed"
};

function normalizeSnippet(text) {
  return String(text || "")
    .replace(/\[\[\[TT_PAGE_\d+\]\]\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasObligationLanguage(text) {
  const t = String(text || "").toLowerCase();
  return OBLIGATION_TERMS.some((term) => t.includes(term));
}

function hasStrongObligationLanguage(text) {
  const t = String(text || "").toLowerCase();
  return STRONG_OBLIGATION_TERMS.some((term) => t.includes(term));
}

function hasDeadlineSignal(text) {
  const t = String(text || "").toLowerCase();
  return DEADLINE_SIGNAL_TERMS.some((term) => t.includes(term));
}

function hasContractContext(text) {
  const t = String(text || "").toLowerCase();
  return CONTRACT_CONTEXT_TERMS.some((term) => t.includes(term));
}

function looksLikeRegulatoryReference(text) {
  const t = String(text || "").toLowerCase();
  const hits = REGULATORY_NOISE_TERMS.filter((term) => t.includes(term)).length;
  return hits >= 2;
}

function typeFromWindow(windowText, fallbackHint = null) {
  const t = String(windowText || "").toLowerCase();
  let bestType = "other";
  let bestScore = 0;

  for (const [type, kws] of Object.entries(TYPE_KEYWORDS)) {
    let score = 0;
    for (const kw of kws) {
      if (t.includes(kw)) score += kw.includes(" ") ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  if (bestType !== "other") return bestType;
  if (!fallbackHint) return "other";
  if (fallbackHint === "invoice") return "payment";
  if (fallbackHint === "renewal") return "renewal";
  if (fallbackHint === "term_end") return "term_end";
  if (fallbackHint === "notice" || fallbackHint === "request" || fallbackHint === "approval") return "notice";
  return "other";
}

function confidenceForAbsolute(type, context) {
  const strong = hasStrongObligationLanguage(context);
  const contract = hasContractContext(context);
  if (type !== "other" && strong) return "high";
  if (type !== "other" && contract) return "medium";
  if (strong && contract) return "medium";
  return "low";
}

function confidenceForRelative(type, context, hasAnchor) {
  const strong = hasStrongObligationLanguage(context);
  const contract = hasContractContext(context);
  if (hasAnchor && type !== "other" && strong) return "high";
  if (hasAnchor && type !== "other") return "medium";
  if (hasAnchor && strong && contract) return "medium";
  if (!hasAnchor && strong) return "low";
  return "low";
}

function score(conf) {
  if (conf === "high") return 3;
  if (conf === "medium") return 2;
  return 1;
}

function splitClauses(text) {
  const clauses = [];
  const re = /[^.;\n]+[.;\n]?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const cleaned = normalizeSnippet(raw);
    if (!cleaned) continue;
    if (cleaned.length <= 650) {
      clauses.push({ text: cleaned, start: m.index });
      continue;
    }
    // Large PDF clauses can be extremely long; chunk to improve local anchor/date pairing.
    const stride = 300;
    const window = 520;
    for (let i = 0; i < cleaned.length; i += stride) {
      const slice = cleaned.slice(i, Math.min(cleaned.length, i + window)).trim();
      if (slice) {
        clauses.push({ text: slice, start: m.index + i });
      }
    }
  }
  return clauses;
}

function nearestAbsoluteBeforeOrAfter(absoluteDates, idx) {
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const d of absoluteDates) {
    const dist = Math.abs(d.index - idx);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

function extractAnchors(text, absoluteDates) {
  const anchors = [];
  for (const d of absoluteDates) {
    const local = snippetAround(text, d.index, 130).toLowerCase();
    const labels = [];
    for (const [label, kws] of Object.entries(ANCHOR_KEYWORDS)) {
      if (kws.some((kw) => local.includes(kw))) labels.push(label);
    }
    anchors.push({
      isoDate: d.isoDate,
      index: d.index,
      line: d.line,
      labels: labels.length ? labels : ["generic"]
    });
  }
  return anchors;
}

function labelsFromContext(context, hint) {
  const c = String(context || "").toLowerCase();
  const out = new Set();
  if (hint) out.add(hint);
  for (const [label, kws] of Object.entries(ANCHOR_KEYWORDS)) {
    if (kws.some((kw) => c.includes(kw))) out.add(label);
  }
  return [...out];
}

function resolveAnchor(anchors, absoluteDates, rel, relIndex, context) {
  const preferred = labelsFromContext(context, rel.anchorHint).filter((label) => ANCHOR_KEYWORDS[label]);
  const near = anchors
    .filter((a) => Math.abs(a.index - relIndex) <= 2600)
    .sort((a, b) => Math.abs(a.index - relIndex) - Math.abs(b.index - relIndex));

  if (preferred.length > 0) {
    const match = near.find((a) => a.labels.some((label) => preferred.includes(label)));
    if (match) return match.isoDate;
    return null;
  }

  if (rel.anchorHint && ANCHOR_KEYWORDS[rel.anchorHint]) {
    const hinted = near.find((a) => a.labels.includes(rel.anchorHint));
    return hinted ? hinted.isoDate : null;
  }

  const fallback = nearestAbsoluteBeforeOrAfter(absoluteDates, relIndex);
  if (!fallback) return null;
  const fallbackWindow = snippetAround(context, Math.max(0, Math.floor(context.length / 2)), 120).toLowerCase();
  if (!hasDeadlineSignal(fallbackWindow)) return null;
  return fallback.isoDate;
}

function itemKey(item) {
  const tokens = normalizeSnippet(item.snippet)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const tokenKey = [...new Set(tokens)].sort().slice(0, 24).join(" ");
  return `${item.date || "null"}|${item.type}|${item.location || ""}|${tokenKey}`;
}

function buildItem({ type, date, confidence, snippet, notes, source, location }) {
  return {
    id: crypto.randomUUID(),
    type,
    date,
    confidence,
    deadlineConfidence: DEADLINE_CONFIDENCE_LABELS.soft,
    item: TYPE_LABELS[type] || TYPE_LABELS.other,
    snippet: normalizeSnippet(snippet),
    notes,
    source,
    location
  };
}

function mergeItems(existing, incoming) {
  const map = new Map(existing.map((it) => [itemKey(it), it]));
  for (const it of incoming) {
    const key = itemKey(it);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, it);
      continue;
    }
    const prevScore = score(prev.confidence);
    const nextScore = score(it.confidence);
    if (nextScore > prevScore) {
      map.set(key, it);
      continue;
    }
    if (nextScore === prevScore && (it.notes?.length || 0) > (prev.notes?.length || 0)) {
      map.set(key, it);
    }
  }
  return [...map.values()];
}

function relevance(it) {
  let r = 0;
  if (it.type !== "other") r += 3;
  if (it.date) r += 2;
  if (hasObligationLanguage(it.snippet)) r += 2;
  if (hasContractContext(it.snippet)) r += 1;
  if (looksLikeRegulatoryReference(it.snippet) && it.type === "other") r -= 3;
  return r;
}

function promoteConfidence(it) {
  if (!it.date) return it;
  if (it.type !== "other" && hasStrongObligationLanguage(it.snippet) && hasDeadlineSignal(it.snippet)) {
    return { ...it, confidence: "high" };
  }
  if (it.type !== "other" && hasObligationLanguage(it.snippet) && hasDeadlineSignal(it.snippet) && it.confidence === "low") {
    return { ...it, confidence: "medium" };
  }
  return it;
}

function keepCandidate(type, snippet) {
  const deadline = hasDeadlineSignal(snippet);
  const strong = hasStrongObligationLanguage(snippet);
  const obligation = hasObligationLanguage(snippet);
  const contract = hasContractContext(snippet);

  if (type === "notice") return deadline && (strong || obligation || contract);
  if (type === "payment" || type === "renewal" || type === "term_end" || type === "trial_end") {
    return deadline || (strong && contract);
  }
  if (type !== "other") return deadline || (strong && contract);
  if (deadline && (strong || contract) && !looksLikeRegulatoryReference(snippet)) return true;
  if (strong && obligation && contract && !looksLikeRegulatoryReference(snippet)) return true;
  return false;
}

function runBaselineAbsoluteLayer({ absolute, text, source, locationFor }) {
  const out = [];
  for (const d of absolute) {
    const snip = normalizeSnippet(snippetAround(text, d.index, 140));
    const type = typeFromWindow(snip);
    if (!keepCandidate(type, snip)) continue;
    out.push(
      buildItem({
        type,
        date: d.isoDate,
        confidence: confidenceForAbsolute(type, snip),
        snippet: snip,
        notes: `Detected absolute date "${d.original}" on line ${d.line + 1}.`,
        source,
        location: locationFor(d.index, d.line)
      })
    );
  }
  return out;
}

function runBaselineRelativeLayer({ relative, absolute, anchors, text, source, locationFor }) {
  const out = [];
  for (const r of relative) {
    const snip = normalizeSnippet(snippetAround(text, r.index, 230));
    const type = typeFromWindow(snip, r.anchorHint);
    const anchor = resolveAnchor(anchors, absolute, r, r.index, snip);
    if (!anchor) {
      if (!keepCandidate(type, snip)) continue;
      out.push(
        buildItem({
          type,
          date: null,
          confidence: confidenceForRelative(type, snip, false),
          snippet: snip,
          notes: `Relative clause "${r.snippet}" found but no anchor date detected nearby.`,
          source,
          location: locationFor(r.index, r.line)
        })
      );
      continue;
    }
    if (!keepCandidate(type, snip) && type === "other") continue;
    out.push(
      buildItem({
        type,
        date: addDays(anchor, r.direction * r.offsetDays),
        confidence: confidenceForRelative(type, snip, true),
        snippet: snip,
        notes: `Derived from "${r.snippet}" using anchor date ${anchor}.`,
        source,
        location: locationFor(r.index, r.line)
      })
    );
  }
  return out;
}

function runClauseLayer({ clauses, absolute, anchors, source, locationFor }) {
  const out = [];
  for (const clause of clauses) {
    const clauseText = normalizeSnippet(clause.text);
    if (!hasObligationLanguage(clauseText) && !hasContractContext(clauseText)) continue;

    const absInClause = detectAbsoluteDates(clauseText, [0]);
    for (const d of absInClause) {
      const absoluteIndex = clause.start + d.index;
      const type = typeFromWindow(clauseText);
      if (!keepCandidate(type, clauseText)) continue;
      out.push(
        buildItem({
          type,
          date: d.isoDate,
          confidence: confidenceForAbsolute(type, clauseText),
          snippet: clauseText,
          notes: `Detected obligation-linked absolute date "${d.original}" in clause context.`,
          source,
          location: locationFor(absoluteIndex, d.line)
        })
      );
    }

    const relInClause = detectRelativeDates(clauseText, [0]);
    for (const r of relInClause) {
      const absoluteIndex = clause.start + r.index;
      const type = typeFromWindow(clauseText, r.anchorHint);
      const anchor = resolveAnchor(anchors, absolute, r, absoluteIndex, clauseText);
      if (!anchor) {
        if (!keepCandidate(type, clauseText)) continue;
        out.push(
          buildItem({
            type,
            date: null,
            confidence: confidenceForRelative(type, clauseText, false),
            snippet: clauseText,
            notes: `Relative clause "${r.snippet}" found in obligation context but no anchor date resolved.`,
            source,
            location: locationFor(absoluteIndex, r.line)
          })
        );
        continue;
      }
      out.push(
        buildItem({
          type,
          date: addDays(anchor, r.direction * r.offsetDays),
          confidence: confidenceForRelative(type, clauseText, true),
          snippet: clauseText,
          notes: `Derived from clause-relative date "${r.snippet}" using anchor ${anchor}.`,
          source,
          location: locationFor(absoluteIndex, r.line)
        })
      );
    }
  }
  return out;
}

function runAnchorExpansionLayer({ anchors, text, source, locationFor }) {
  const out = [];
  for (const anchor of anchors) {
    if (anchor.labels.includes("generic")) continue;
    const context = normalizeSnippet(snippetAround(text, anchor.index, 280));
    const rel = detectRelativeDates(context, [0]);
    for (const r of rel) {
      const type = typeFromWindow(context, r.anchorHint || anchor.labels[0]);
      if (!keepCandidate(type, context)) continue;
      out.push(
        buildItem({
          type,
          date: addDays(anchor.isoDate, r.direction * r.offsetDays),
          confidence: confidenceForRelative(type, context, true),
          snippet: context,
          notes: `Anchor-expansion: "${r.snippet}" resolved from anchor ${anchor.isoDate}.`,
          source,
          location: locationFor(anchor.index, anchor.line)
        })
      );
    }
  }
  return out;
}

function runSentenceSweepLayer({ text, absolute, anchors, source, locationFor }) {
  const out = [];
  const sentenceRegex = /[^.?!;\n]+[.?!;\n]?/g;
  let m;
  while ((m = sentenceRegex.exec(text)) !== null) {
    const sentence = normalizeSnippet(m[0]);
    if (!sentence) continue;
    if (!hasObligationLanguage(sentence)) continue;

    const rel = detectRelativeDates(sentence, [0]);
    for (const r of rel) {
      const globalIndex = m.index + r.index;
      const type = typeFromWindow(sentence, r.anchorHint);
      const anchor = resolveAnchor(anchors, absolute, r, globalIndex, sentence);
      if (!anchor) continue;
      out.push(
        buildItem({
          type,
          date: addDays(anchor, r.direction * r.offsetDays),
          confidence: confidenceForRelative(type, sentence, true),
          snippet: sentence,
          notes: `Sentence sweep derived from "${r.snippet}" with anchor ${anchor}.`,
          source,
          location: locationFor(globalIndex, r.line)
        })
      );
    }
  }
  return out;
}

function rankAndFilter(items, lockedKeys) {
  const promoted = items.map(promoteConfidence);

  const kept = promoted.filter((it) => {
    const key = itemKey(it);
    if (lockedKeys.has(key)) return true;
    if (it.type !== "other") return true;
    if (it.date && hasDeadlineSignal(it.snippet) && !looksLikeRegulatoryReference(it.snippet)) return true;
    if (it.confidence === "high" && hasContractContext(it.snippet)) return true;
    return false;
  });

  const sorted = kept.sort((a, b) => {
    const rb = relevance(b);
    const ra = relevance(a);
    if (rb !== ra) return rb - ra;
    return score(b.confidence) - score(a.confidence);
  });

  return sorted.slice(0, 240);
}

function priorityRank(value) {
  return PRIORITY_SCORE[value] || PRIORITY_SCORE.low;
}

function looksLikeHighPriorityClause(item) {
  if (!item.date) return false;
  const text = `${item.snippet || ""} ${item.notes || ""}`.toLowerCase();
  const renewalCritical =
    /auto[- ]?renew|renewal term|notice of non[- ]?renewal|non[- ]?renewal|successive one/.test(text) &&
    /notice|prior|before|at least|no later than/.test(text);
  const termBoundary = /end of term|term ends?|expires?|expiration|termination date/.test(text);
  const terminationNotice =
    /(terminate|termination|cancel|cancellation).{0,90}(prior notice|written notice|at least|no later than|before)/.test(text) ||
    /(prior notice|written notice).{0,90}(terminate|termination|cancel|cancellation)/.test(text);
  return renewalCritical || termBoundary || terminationNotice;
}

function looksLikeMediumPriorityClause(item) {
  if (!item.date) return false;
  const text = `${item.snippet || ""} ${item.notes || ""}`.toLowerCase();
  const insuranceNotice = /insurance|policy/.test(text) && /notice|cancel|cancellation/.test(text);
  const paymentDue = item.type === "payment" && /payment due|invoice|fee due|payable/.test(text);
  const retentionDeadline = /retain|retention|records|audit period/.test(text) && /years?\s+after|after/.test(text);
  if (insuranceNotice || paymentDue || retentionDeadline) return true;
  return item.type !== "other" && item.confidence !== "low";
}

function withPriority(items) {
  const scored = items.map((item) => {
    const text = `${item.snippet || ""} ${item.notes || ""}`.toLowerCase();
    let highScore = 0;
    if (looksLikeHighPriorityClause(item)) highScore += 4;
    if (item.type === "renewal" || item.type === "term_end") highScore += 2;
    if (/non[- ]?renewal|auto[- ]?renew|renewal term/.test(text)) highScore += 2;
    if (/terminate|termination|cancel|cancellation/.test(text) && /notice|prior|before|at least/.test(text)) highScore += 2;
    if (item.confidence === "high") highScore += 1;
    return { ...item, priority: "low", _highScore: highScore };
  });

  const highCandidates = scored
    .filter((item) => item._highScore > 0)
    .sort((a, b) => {
      if (b._highScore !== a._highScore) return b._highScore - a._highScore;
      const dateA = a.date || "9999-12-31";
      const dateB = b.date || "9999-12-31";
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return score(b.confidence) - score(a.confidence);
    });

  const highKeys = new Set();
  const highSignatures = new Set();
  for (const candidate of highCandidates) {
    const signature = `${candidate.type}|${candidate.date || "null"}|${candidate.location || ""}`;
    if (highSignatures.has(signature)) continue;
    highSignatures.add(signature);
    highKeys.add(itemKey(candidate));
    if (highKeys.size >= 3) break;
  }

  const prioritized = scored.map((item) => {
    const key = itemKey(item);
    if (highKeys.has(key)) return { ...item, priority: "high" };
    if (looksLikeMediumPriorityClause(item)) return { ...item, priority: "medium" };
    return item;
  });

  return prioritized
    .map(({ _highScore, ...item }) => item)
    .sort((a, b) => {
      const priorityDiff = priorityRank(b.priority) - priorityRank(a.priority);
      if (priorityDiff !== 0) return priorityDiff;
      const dateA = a.date || "9999-12-31";
      const dateB = b.date || "9999-12-31";
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return score(b.confidence) - score(a.confidence);
    });
}

function withDeadlineConfidence(items) {
  return items.map((item) => {
    const text = `${item.snippet || ""} ${item.notes || ""}`.toLowerCase();
    const hasAutoRenewSignal = /auto[- ]?renew|renewal term|non[- ]?renewal|notice of non[- ]?renewal|successive term/.test(text);
    if (hasAutoRenewSignal) {
      return { ...item, deadlineConfidence: DEADLINE_CONFIDENCE_LABELS.autoRenewal };
    }

    const hasPenaltySignal =
      /(late fee|penalty|penalties|interest|default|breach|liquidated damages|service charge)/.test(text) ||
      (/(suspend|termination|terminate|cancellation|cancel)/.test(text) && /(non[- ]?payment|failure to pay|past due|overdue)/.test(text));
    if (hasPenaltySignal) {
      return { ...item, deadlineConfidence: DEADLINE_CONFIDENCE_LABELS.penaltyBacked };
    }

    const hasHardDeadlineSignal =
      !!item.date &&
      (/(no later than|prior to|at least|not less than|within|before|due|deadline|must|shall|required)/.test(text) ||
        item.priority === "high" ||
        (item.type !== "other" && item.confidence !== "low"));
    if (hasHardDeadlineSignal) {
      return { ...item, deadlineConfidence: DEADLINE_CONFIDENCE_LABELS.hard };
    }

    return { ...item, deadlineConfidence: DEADLINE_CONFIDENCE_LABELS.soft };
  });
}

export function extractFromSource(rawText, source) {
  const { text, lineStarts } = normalizeText(rawText);
  const sourceLower = String(source || "").toLowerCase();
  const isPdfSource = sourceLower.endsWith(".pdf");
  const absolute = detectAbsoluteDates(text, lineStarts);
  const relative = detectRelativeDates(text, lineStarts);

  const pageMarkers = [];
  const markerRe = /\[\[\[TT_PAGE_(\d+)\]\]\]/g;
  let markerMatch;
  while ((markerMatch = markerRe.exec(text)) !== null) {
    pageMarkers.push({
      index: markerMatch.index,
      page: Number(markerMatch[1])
    });
  }

  function locationFor(index, line) {
    if (isPdfSource && pageMarkers.length) {
      let page = 1;
      for (const marker of pageMarkers) {
        if (marker.index <= index) page = marker.page;
      }
      return `Page ${page}`;
    }
    return `Line ${line + 1}`;
  }

  const anchors = extractAnchors(text, absolute);
  const clauses = splitClauses(text);

  // Locked baseline: these are preserved even when additional layers are added.
  const baseline = mergeItems([], [
    ...runBaselineAbsoluteLayer({ absolute, text, source, locationFor }),
    ...runBaselineRelativeLayer({ relative, absolute, anchors, text, source, locationFor }),
    ...runClauseLayer({ clauses, absolute, anchors, source, locationFor })
  ]);

  const lockedKeys = new Set(baseline.map(itemKey));

  let merged = mergeItems(baseline, runAnchorExpansionLayer({ anchors, text, source, locationFor }));
  merged = mergeItems(merged, runSentenceSweepLayer({ text, absolute, anchors, source, locationFor }));

  return withDeadlineConfidence(withPriority(rankAndFilter(merged, lockedKeys)));
}
