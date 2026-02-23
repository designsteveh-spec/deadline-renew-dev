export const PLAN_IDS = {
  FREE: "free",
  PRO_MONTHLY: "pro_monthly",
  PRO_ANNUAL: "pro_annual"
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
  [PLAN_IDS.PRO_MONTHLY]: {
    id: PLAN_IDS.PRO_MONTHLY,
    label: "Pro Monthly",
    extractionLimit: 300,
    extractionWindow: "month",
    maxFilesPerRun: 3,
    maxFileBytes: 10 * 1024 * 1024
  },
  [PLAN_IDS.PRO_ANNUAL]: {
    id: PLAN_IDS.PRO_ANNUAL,
    label: "Pro Annual",
    extractionLimit: 1500,
    extractionWindow: "month",
    maxFilesPerRun: 3,
    maxFileBytes: 20 * 1024 * 1024
  }
};

export function normalizePlanId(rawPlan) {
  const value = String(rawPlan || "").toLowerCase().trim();
  if (value in PLAN_LIMITS) return value;
  return PLAN_IDS.FREE;
}

