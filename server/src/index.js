import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import Stripe from "stripe";
import { extractFromSource } from "./extractor/extract.js";
import { attachEntitlements, enforceRunLimits } from "./billing/entitlements.js";
import { PAID_PLAN_IDS, PLAN_IDS, PLAN_LIMITS, normalizePlanId } from "./billing/plans.js";
import {
  createAccessCode,
  defaultExpirationForPlan,
  isAccessCodeEnabled,
  parsePromoCodes,
  verifyAccessCode
} from "./billing/accessCodes.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" })
  : null;
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || "");
const PROMO_CODES = parsePromoCodes(process.env.PROMO_CODES || "");
const codeBySessionId = new Map();
const PAID_REDUCTION_TRIGGER_BYTES = 30 * 1024 * 1024;
const PAID_REDUCTION_MAX_INPUT_BYTES = 40 * 1024 * 1024;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 3,
    fileSize: PAID_REDUCTION_MAX_INPUT_BYTES
  },
  fileFilter: (_req, file, cb) => {
    const ok = [".pdf", ".docx", ".txt"].some((ext) => file.originalname.toLowerCase().endsWith(ext));
    if (!ok) return cb(new Error("Unsupported file type. Allowed: PDF, DOCX, TXT."));
    cb(null, true);
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/plans", (_req, res) => {
  res.json({
    plans: Object.values(PLAN_LIMITS)
  });
});

app.post("/api/access-codes/verify", (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (!code) return res.status(400).json({ error: "Code required." });
  const result = verifyAccessCode(code);
  if (!result.ok) return res.status(400).json({ error: "Invalid or expired access code." });
  return res.json({
    ok: true,
    plan: result.plan,
    exp: result.exp
  });
});

app.post("/api/admin/access-codes/generate", (req, res) => {
  if (!ADMIN_TOKEN || String(req.header("x-admin-token") || "") !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  if (!isAccessCodeEnabled()) {
    return res.status(500).json({ error: "Server not configured (missing ACCESS_CODE_SECRET)." });
  }
  const plan = normalizePlanId(req.body?.plan);
  if (![PLAN_IDS.PRO_30_DAY, PLAN_IDS.PRO_ANNUAL, PLAN_IDS.PRO_LIFETIME].includes(plan)) {
    return res.status(400).json({ error: "Only pro_30_day, pro_annual, or pro_lifetime access codes can be generated." });
  }
  const exp = Number(req.body?.exp || defaultExpirationForPlan(plan));
  const sub = String(req.body?.sub || "");
  const code = createAccessCode({ planId: plan, exp, sub, product: "deadline_renew" });
  if (!code) return res.status(500).json({ error: "Code generation failed." });
  return res.json({ ok: true, plan, exp, code });
});

app.post("/api/promo/redeem", (req, res) => {
  if (!isAccessCodeEnabled()) {
    return res.status(500).json({ error: "Server not configured (missing ACCESS_CODE_SECRET)." });
  }
  const promo = String(req.body?.promo || "").trim().toUpperCase();
  if (!promo) return res.status(400).json({ error: "Promo code required." });
  const plan = PROMO_CODES.get(promo);
  if (!plan) return res.status(400).json({ error: "Invalid promo code." });
  const exp = defaultExpirationForPlan(plan);
  const code = createAccessCode({ planId: plan, exp, sub: `promo:${promo}`, product: "deadline_renew" });
  if (!code) return res.status(500).json({ error: "Code generation failed." });
  return res.json({ ok: true, plan, exp, code });
});

app.post("/api/stripe/create-checkout-session", async (req, res) => {
  if (!stripe) return res.status(500).json({ error: "Stripe is not configured (missing STRIPE_SECRET_KEY)." });
  const plan = normalizePlanId(req.body?.plan);
  const priceId =
    plan === PLAN_IDS.PRO_LIFETIME
      ? process.env.STRIPE_PRICE_PRO_LIFETIME
      : plan === PLAN_IDS.PRO_ANNUAL
        ? process.env.STRIPE_PRICE_PRO_ANNUAL
        : process.env.STRIPE_PRICE_PRO_30_DAY;
  if (!priceId) return res.status(400).json({ error: "Missing Stripe price configuration for selected plan." });
  const fe = String(process.env.FRONTEND_ORIGIN || "http://localhost:5173").replace(/\/+$/, "");
  const successUrl = `${fe}/?paid=1&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${fe}/#pricing`;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        app: "deadline_renew",
        plan
      }
    });
    return res.json({ ok: true, id: session.id, url: session.url });
  } catch {
    return res.status(500).json({ error: "Failed to create checkout session." });
  }
});

app.post("/api/stripe/activate-session", async (req, res) => {
  if (!stripe) return res.status(500).json({ error: "Stripe is not configured (missing STRIPE_SECRET_KEY)." });
  if (!isAccessCodeEnabled()) {
    return res.status(500).json({ error: "Server not configured (missing ACCESS_CODE_SECRET)." });
  }
  const sessionId = String(req.body?.session_id || "").trim();
  if (!sessionId) return res.status(400).json({ error: "session_id required." });
  if (codeBySessionId.has(sessionId)) {
    return res.json(codeBySessionId.get(sessionId));
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== "paid") {
      return res.status(400).json({ error: "Checkout session is not paid." });
    }
    const metadataPlan = normalizePlanId(session.metadata?.plan);
    const plan = [PLAN_IDS.PRO_30_DAY, PLAN_IDS.PRO_ANNUAL, PLAN_IDS.PRO_LIFETIME].includes(metadataPlan)
      ? metadataPlan
      : PLAN_IDS.PRO_30_DAY;
    const exp = defaultExpirationForPlan(plan);
    const code = createAccessCode({
      planId: plan,
      exp,
      sub: String(session.customer_email || session.customer || ""),
      product: "deadline_renew"
    });
    if (!code) return res.status(500).json({ error: "Code generation failed." });
    const response = { ok: true, plan, exp, code };
    codeBySessionId.set(sessionId, response);
    return res.json(response);
  } catch {
    return res.status(500).json({ error: "Failed to activate pass." });
  }
});

app.post("/api/extract", upload.array("files", 3), attachEntitlements, enforceRunLimits, async (req, res) => {
  const files = req.files || [];
  const text = typeof req.body.text === "string" ? req.body.text : "";

  const allItems = [];
  const fileReports = [];

  if (text.trim()) {
    const items = extractFromSource(text, "Pasted Text");
    allItems.push(...items);
    fileReports.push({
      source: "Pasted Text",
      ok: true,
      chars: text.length
    });
  }

  for (const file of files) {
    const source = file.originalname;
    try {
      const extraction = await extractTextFromFile(file, {
        planId: req.entitlement?.id || PLAN_IDS.FREE
      });
      const extracted = extraction.text;
      if (file.originalname.toLowerCase().endsWith(".pdf") && extracted.length < 50) {
        fileReports.push({
          source,
          ok: false,
          error:
            "This PDF appears to be image-only (scanned). Please paste text or upload a text-based document.",
          chars: extracted.length
        });
        continue;
      }
      if (!extracted.trim()) {
        fileReports.push({
          source,
          ok: false,
          error: "No readable text found in file.",
          chars: 0
        });
        continue;
      }
      const items = extractFromSource(extracted, source);
      allItems.push(...items);
      fileReports.push({
        source,
        ok: true,
        chars: extracted.length,
        error: extraction.optimized ? "Oversized PDF reduced automatically for deterministic extraction." : undefined
      });
    } catch (error) {
      fileReports.push({
        source,
        ok: false,
        error: error instanceof Error ? error.message : "Failed to parse file."
      });
    }
  }

  res.json({
    items: allItems,
    fileReports
  });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ error: "Maximum 3 files allowed." });
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File is too large to process. Maximum accepted input is 40MB." });
    }
  }
  if (err) {
    return res.status(400).json({ error: err.message || "Upload failed." });
  }
  return res.status(500).json({ error: "Unexpected error." });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${port}`);
});

async function extractTextFromFile(file, { planId }) {
  const name = file.originalname.toLowerCase();
  const isPaidPlan = PAID_PLAN_IDS.includes(planId);
  if (name.endsWith(".txt")) {
    return { text: file.buffer.toString("utf-8"), optimized: false };
  }
  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return { text: result.value || "", optimized: false };
  }
  if (name.endsWith(".pdf")) {
    if (isPaidPlan && file.size > PAID_REDUCTION_TRIGGER_BYTES && file.size <= PAID_REDUCTION_MAX_INPUT_BYTES) {
      const text = await extractTextFromPdf(file.buffer);
      return { text, optimized: true };
    }
    const text = await extractTextFromPdf(file.buffer);
    return { text, optimized: false };
  }
  throw new Error("Unsupported file type.");
}

async function extractTextFromPdf(buffer) {
  let pageIndex = 0;
  const renderPage = async (pageData) => {
    const textContent = await pageData.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    const marker = `\n[[[TT_PAGE_${pageIndex + 1}]]]\n`;
    pageIndex += 1;
    return `${marker}${pageText}`;
  };
  const result = await pdfParse(buffer, { pagerender: renderPage });
  return result.text || "";
}
