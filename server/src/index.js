import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import Stripe from "stripe";
import { extractFromSource } from "./extractor/extract.js";
import { attachEntitlements, enforceRunLimits } from "./billing/entitlements.js";
import { PLAN_IDS, PLAN_LIMITS, normalizePlanId } from "./billing/plans.js";
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
const processedStripeEventIds = new Set();
const emailedStripeSessionIds = new Set();
const MAX_ACCEPTED_INPUT_BYTES = 40 * 1024 * 1024;
const EXPECTED_STRIPE_CURRENCY = String(process.env.STRIPE_CURRENCY || "usd").toLowerCase();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const RESEND_FROM_EMAIL = String(process.env.RESEND_FROM_EMAIL || "").trim();
const SUPPORT_EMAIL = String(process.env.SUPPORT_EMAIL || "support@trusted-tools.com").trim();

app.use(cors());

function getPriceIdForPlan(plan) {
  if (plan === PLAN_IDS.PRO_LIFETIME) return String(process.env.STRIPE_PRICE_PRO_LIFETIME || "");
  if (plan === PLAN_IDS.PRO_ANNUAL) return String(process.env.STRIPE_PRICE_PRO_ANNUAL || "");
  if (plan === PLAN_IDS.PRO_30_DAY) return String(process.env.STRIPE_PRICE_PRO_30_DAY || "");
  return "";
}

function planLabel(plan) {
  if (plan === PLAN_IDS.PRO_LIFETIME) return "Pro Lifetime Pass";
  if (plan === PLAN_IDS.PRO_ANNUAL) return "Pro Annual Pass";
  return "Pro 30-Day Pass";
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendPurchaseEmail({ to, plan, code, exp }) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL || !to) return false;
  const fe = String(process.env.FRONTEND_ORIGIN || "").replace(/\/+$/, "");
  const expiresAt = new Date(Number(exp || 0));
  const expHuman = Number.isFinite(expiresAt.getTime())
    ? expiresAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : "n/a";
  const subject = `Your ${planLabel(plan)} access code`;
  const safeCode = escapeHtml(code);
  const safeSupport = escapeHtml(SUPPORT_EMAIL);
  const safeFe = escapeHtml(fe || "your dashboard");
  const html =
    `<div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.45;">` +
    `<h2 style="margin:0 0 10px;">Your pass is active</h2>` +
    `<p style="margin:0 0 10px;">Thanks for purchasing ${escapeHtml(planLabel(plan))}. Your access code is below.</p>` +
    `<p style="margin:0 0 6px;"><b>Access code</b></p>` +
    `<p style="margin:0 0 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${safeCode}</p>` +
    `<p style="margin:0 0 12px;">Open <b>${safeFe}</b>, paste this code into the Access Code field at top right, and submit.</p>` +
    `<p style="margin:0 0 12px;">Pass expires on <b>${escapeHtml(expHuman)}</b>.</p>` +
    `<p style="margin:0;">Need help? Contact <a href="mailto:${safeSupport}">${safeSupport}</a>.</p>` +
    `</div>`;
  const text =
    `Your pass is active.\n\n` +
    `Plan: ${planLabel(plan)}\n` +
    `Access code: ${code}\n\n` +
    `Open ${fe || "the app"}, paste this code into the Access Code field, and submit.\n` +
    `Pass expires on: ${expHuman}\n\n` +
    `Support: ${SUPPORT_EMAIL}\n`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [to],
        subject,
        html,
        text
      })
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function activatePaidSession(sessionId) {
  if (!stripe) throw httpError(500, "Stripe is not configured (missing STRIPE_SECRET_KEY).");
  if (!isAccessCodeEnabled()) throw httpError(500, "Server not configured (missing ACCESS_CODE_SECRET).");
  const cached = codeBySessionId.get(sessionId);
  if (cached) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return { response: cached, session };
  }
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (!session || session.payment_status !== "paid") {
    throw httpError(400, "Checkout session is not paid.");
  }
  if (session.mode !== "payment") {
    throw httpError(400, "Invalid checkout session mode.");
  }
  const metadataPlan = normalizePlanId(session.metadata?.plan);
  if (![PLAN_IDS.PRO_30_DAY, PLAN_IDS.PRO_ANNUAL, PLAN_IDS.PRO_LIFETIME].includes(metadataPlan)) {
    throw httpError(400, "Invalid plan metadata on checkout session.");
  }
  const plan = metadataPlan;
  const expectedPriceId = getPriceIdForPlan(plan);
  if (!expectedPriceId) {
    throw httpError(400, "Missing Stripe price configuration for session plan.");
  }
  const sessionCurrency = String(session.currency || "").toLowerCase();
  if (sessionCurrency && sessionCurrency !== EXPECTED_STRIPE_CURRENCY) {
    throw httpError(400, "Checkout session currency mismatch.");
  }
  const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 3, expand: ["data.price"] });
  if (!lineItems?.data?.length) {
    throw httpError(400, "No line items found for checkout session.");
  }
  if (lineItems.data.length !== 1) {
    throw httpError(400, "Unexpected number of line items for checkout session.");
  }
  const lineItem = lineItems.data[0];
  const lineItemPriceId = typeof lineItem.price === "string" ? lineItem.price : lineItem.price?.id;
  if (!lineItemPriceId || lineItemPriceId !== expectedPriceId) {
    throw httpError(400, "Checkout session price does not match selected plan.");
  }
  const quantity = Number(lineItem.quantity || 0);
  if (quantity !== 1) {
    throw httpError(400, "Unexpected checkout quantity.");
  }
  const lineItemAmountTotal = Number(lineItem.amount_total || 0);
  const sessionAmountTotal = Number(session.amount_total || 0);
  if (lineItemAmountTotal <= 0 || sessionAmountTotal <= 0 || lineItemAmountTotal !== sessionAmountTotal) {
    throw httpError(400, "Checkout session amount mismatch.");
  }
  const lineItemCurrency = String(lineItem.currency || "").toLowerCase();
  if (lineItemCurrency && lineItemCurrency !== EXPECTED_STRIPE_CURRENCY) {
    throw httpError(400, "Checkout line item currency mismatch.");
  }
  const exp = defaultExpirationForPlan(plan);
  const code = createAccessCode({
    planId: plan,
    exp,
    sub: String(session.customer_email || session.customer || ""),
    product: "deadline_renew"
  });
  if (!code) throw httpError(500, "Code generation failed.");
  const response = { ok: true, plan, exp, code };
  codeBySessionId.set(sessionId, response);
  return { response, session };
}

async function attachPurchaseEmailStatus(sessionId, response, sessionArg) {
  if (typeof response?.emailSent === "boolean") return response;
  if (emailedStripeSessionIds.has(sessionId)) {
    const next = { ...response, emailSent: true };
    codeBySessionId.set(sessionId, next);
    return next;
  }
  let session = sessionArg;
  if (!session && stripe) {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  }
  const to = String(session?.customer_details?.email || session?.customer_email || "").trim();
  if (!to) {
    const next = { ...response, emailSent: false };
    codeBySessionId.set(sessionId, next);
    return next;
  }
  const sent = await sendPurchaseEmail({
    to,
    plan: response.plan,
    code: response.code,
    exp: response.exp
  });
  if (sent) emailedStripeSessionIds.add(sessionId);
  const next = { ...response, emailSent: sent };
  codeBySessionId.set(sessionId, next);
  return next;
}

app.post("/api/stripe/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  if (!stripe) {
    return res.status(500).send("Stripe is not configured.");
  }
  const sig = req.header("stripe-signature");
  if (!sig) {
    return res.status(400).send("Webhook Error: Missing stripe-signature header");
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, String(process.env.STRIPE_WEBHOOK_SECRET || ""));
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err?.message || "Invalid signature"}`);
  }
  if (event?.id && processedStripeEventIds.has(event.id)) {
    return res.json({ received: true, deduped: true, type: event.type });
  }
  if (event?.id) processedStripeEventIds.add(event.id);
  try {
    if (event.type === "checkout.session.completed") {
      const sessionId = String(event?.data?.object?.id || "").trim();
      if (!sessionId) return res.json({ received: true, type: event.type, skipped: "missing_session_id" });
      const { response, session } = await activatePaidSession(sessionId);
      const withEmail = await attachPurchaseEmailStatus(sessionId, response, session);
      return res.json({ received: true, type: event.type, emailSent: !!withEmail.emailSent });
    }
    return res.json({ received: true, type: event.type });
  } catch {
    return res.json({ received: true, type: event.type, error: "handler_exception" });
  }
});

app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 3,
    fileSize: MAX_ACCEPTED_INPUT_BYTES
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
  const priceId = getPriceIdForPlan(plan);
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
  try {
    const { response, session } = await activatePaidSession(sessionId);
    const withEmail = await attachPurchaseEmailStatus(sessionId, response, session);
    return res.json(withEmail);
  } catch (err) {
    const status = Number(err?.status || 500);
    const message = err instanceof Error && err.message ? err.message : "Failed to activate pass.";
    return res.status(status).json({ error: message });
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
        const extracted = await extractTextFromFile(file);
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
        chars: extracted.length
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

async function extractTextFromFile(file) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith(".txt")) {
    return file.buffer.toString("utf-8");
  }
  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value || "";
  }
  if (name.endsWith(".pdf")) {
    return extractTextFromPdf(file.buffer);
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
