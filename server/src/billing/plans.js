export const PLAN_IDS = {
  FREE: "free",
  PRO_30_DAY: "pro_30_day",
  PRO_ANNUAL: "pro_annual",
  PRO_LIFETIME: "pro_lifetime"
};

export const PLAN_LIMITS = {
  [PLAN_IDS.FREE]: {
    id: PLAN_IDS.FREE,
    label: "Free",
    extractionLimit: 3,
    extractionWindow: "day",
    maxFilesPerRun: 1,
    maxFileBytes: 5 * 1024 * 1024
  },
  [PLAN_IDS.PRO_30_DAY]: {
    id: PLAN_IDS.PRO_30_DAY,
    label: "Pro 30-Day Pass",
    extractionLimit: 300,
    extractionWindow: "month",
    maxFilesPerRun: 3,
    maxFileBytes: 10 * 1024 * 1024
  },
  [PLAN_IDS.PRO_ANNUAL]: {
    id: PLAN_IDS.PRO_ANNUAL,
    label: "Pro Annual",
    extractionLimit: 1500,
    extractionWindow: "year",
    maxFilesPerRun: 3,
    maxFileBytes: 20 * 1024 * 1024
  },
  [PLAN_IDS.PRO_LIFETIME]: {
    id: PLAN_IDS.PRO_LIFETIME,
    label: "Pro Lifetime Pass",
    extractionLimit: 5000,
    extractionWindow: "year",
    maxFilesPerRun: 3,
    maxFileBytes: 20 * 1024 * 1024
  }
};

export function normalizePlanId(rawPlan) {
  const value = String(rawPlan || "").toLowerCase().trim();
  if (value === "pro_monthly") return PLAN_IDS.PRO_30_DAY;
  if (value in PLAN_LIMITS) return value;
  return PLAN_IDS.FREE;
}
