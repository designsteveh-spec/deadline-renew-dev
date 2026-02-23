import { PLAN_LIMITS, normalizePlanId } from "./plans.js";
import { verifyAccessCode } from "./accessCodes.js";

const usageStore = new Map();

function periodKey(windowName, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  if (windowName === "day") return `${y}-${m}-${d}`;
  return `${y}-${m}`;
}

function userKey(req) {
  if (req.access?.codeHash) return `code:${req.access.codeHash}`;
  const accountId = req.header("x-account-id");
  if (accountId) return `acct:${accountId}`;
  return `ip:${req.ip || "unknown"}`;
}

export function attachEntitlements(req, _res, next) {
  const accessCode = String(req.header("x-access-code") || req.body?.accessCode || "").trim();
  let planId = normalizePlanId(req.header("x-plan"));
  if (accessCode) {
    const verified = verifyAccessCode(accessCode);
    if (verified.ok) {
      req.access = verified;
      planId = verified.plan;
    }
  }
  req.entitlement = PLAN_LIMITS[planId];
  req.usageKey = userKey(req);
  next();
}

export function enforceRunLimits(req, res, next) {
  const limits = req.entitlement;
  const files = req.files || [];
  const period = periodKey(limits.extractionWindow);
  const key = `${req.usageKey}|${limits.id}|${period}`;
  const used = usageStore.get(key) || 0;

  if (used >= limits.extractionLimit) {
    return res.status(429).json({
      error: `Plan limit reached for ${limits.label}: ${limits.extractionLimit} extractions per ${limits.extractionWindow}.`
    });
  }

  if (files.length > limits.maxFilesPerRun) {
    return res.status(400).json({
      error: `${limits.label} allows up to ${limits.maxFilesPerRun} file(s) per extraction.`
    });
  }

  for (const file of files) {
    if (file.size > limits.maxFileBytes) {
      const mb = Math.floor(limits.maxFileBytes / (1024 * 1024));
      return res.status(400).json({
        error: `${limits.label} allows up to ${mb}MB per file. "${file.originalname}" is too large.`
      });
    }
  }

  usageStore.set(key, used + 1);
  return next();
}
