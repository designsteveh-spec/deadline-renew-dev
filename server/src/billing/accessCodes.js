import crypto from "crypto";
import { PLAN_IDS, normalizePlanId } from "./plans.js";

const ACCESS_SECRET = process.env.ACCESS_CODE_SECRET || "";
const ACCESS_PRO_30_DAY_DAYS = Number(process.env.ACCESS_CODE_PRO_30_DAY_DAYS || 30);
const ACCESS_PRO_ANNUAL_DAYS = Number(process.env.ACCESS_CODE_PRO_ANNUAL_DAYS || 365);

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64url(input) {
  return Buffer.from(String(input || ""), "base64url");
}

function signRaw(value) {
  return crypto.createHmac("sha256", ACCESS_SECRET).update(value).digest("base64url");
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function isAccessCodeEnabled() {
  return !!ACCESS_SECRET;
}

export function createAccessCode({ planId, exp, sub = "", product = "deadline_renew" }) {
  if (!ACCESS_SECRET) return null;
  const normalizedPlan = normalizePlanId(planId);
  const payload = {
    v: 1,
    plan: normalizedPlan,
    exp: Number(exp || 0),
    iat: Math.floor(Date.now() / 1000),
    sub: String(sub || ""),
    product: String(product || "deadline_renew"),
    nonce: crypto.randomBytes(6).toString("hex")
  };
  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = signRaw(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyAccessCode(code) {
  if (!ACCESS_SECRET) return { ok: false, error: "missing_secret" };
  const raw = String(code || "").trim();
  if (!raw || !raw.includes(".")) return { ok: false, error: "invalid_format" };
  const [payloadB64, sig] = raw.split(".", 2);
  if (!payloadB64 || !sig) return { ok: false, error: "invalid_format" };
  const expectedSig = signRaw(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, error: "invalid_signature" };
  }
  let payload;
  try {
    payload = JSON.parse(fromBase64url(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, error: "invalid_payload" };
  }
  const plan = normalizePlanId(payload?.plan);
  if (![PLAN_IDS.PRO_30_DAY, PLAN_IDS.PRO_ANNUAL, PLAN_IDS.PRO_LIFETIME].includes(plan)) {
    return { ok: false, error: "invalid_plan" };
  }
  const exp = Number(payload?.exp || 0);
  if (plan !== PLAN_IDS.PRO_LIFETIME) {
    if (!Number.isFinite(exp) || exp <= 0) return { ok: false, error: "missing_exp" };
    if (Date.now() >= exp) return { ok: false, error: "expired" };
  }
  return {
    ok: true,
    plan,
    exp,
    sub: String(payload?.sub || ""),
    product: String(payload?.product || ""),
    codeHash: sha256Hex(raw)
  };
}

export function defaultExpirationForPlan(planId) {
  const now = Date.now();
  const normalized = normalizePlanId(planId);
  if (normalized === PLAN_IDS.PRO_LIFETIME) {
    return 0;
  }
  if (normalized === PLAN_IDS.PRO_ANNUAL) {
    return now + ACCESS_PRO_ANNUAL_DAYS * 24 * 60 * 60 * 1000;
  }
  return now + ACCESS_PRO_30_DAY_DAYS * 24 * 60 * 60 * 1000;
}

export function parsePromoCodes(raw) {
  const source = String(raw || "");
  const map = new Map();
  if (!source.trim()) return map;
  for (const pair of source.split(",")) {
    const [promo, planRaw] = pair.split(":").map((v) => String(v || "").trim());
    if (!promo || !planRaw) continue;
    const plan = normalizePlanId(planRaw);
    if (![PLAN_IDS.PRO_30_DAY, PLAN_IDS.PRO_ANNUAL, PLAN_IDS.PRO_LIFETIME].includes(plan)) continue;
    map.set(promo.toUpperCase(), plan);
  }
  return map;
}
