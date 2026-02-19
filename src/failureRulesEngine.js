// ═══════════════════════════════════════════════════════════════════════════
// FAILURE RULES ENGINE  —  Step 2 of 4
// Safaricom LNM Merchant Digital Twin
//
// Responsibilities:
//   1. RULES CATALOGUE  — 12 rules, each mapped to a call center demand driver
//   2. EVALUATOR        — evaluateAction(merchant, actionKey) → result object
//   3. PRE-SCANNER      — scanAllFailures(merchant) → prioritised failure list
//   4. BATCH SCANNER    — scanMerchantBatch(merchants) → fleet-level risk matrix
//   5. RESULT SCHEMA    — standard result object shape consumed by the simulator
//
// Consumed by:  merchant-simulator.jsx  (Step 3 simulator)
//               Step 4 Twin Loop Dashboard
//
// Imports from: merchantDataModel.js  (merchant shape + utilities)
// ═══════════════════════════════════════════════════════════════════════════

import { formatKES } from "./merchantDataModel.js";


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — RESULT SCHEMA
// Every rule returns one of these three shapes.
// ─────────────────────────────────────────────────────────────────────────────

// SUCCESS result
function ok(inline) {
  return {
    success: true,
    code: "OK",
    severity: null,
    inline,            // message shown in-app / on USSD / on web
    reason: null,      // why it happened (null on success)
    fix: null,         // how to fix (null on success)
    escalation: null,  // where to escalate (null on success)
    demand_rank: null,
  };
}

// FAILURE result
function fail(code, severity, inline, reason, fix, demandRank = null) {
  const escalation = severity === "critical"
    ? "🚨 Call Safaricom Business: 0722 000 100 — available 24/7 for urgent cases"
    : severity === "high"
    ? "📞 Call 100 (free) or visit your nearest Safaricom Shop with National ID"
    : "💬 Chat via My Safaricom App > Help, or SMS 'HELP' to 100";

  return {
    success: false,
    code,
    severity,          // critical | high | medium | low
    inline,            // short message shown on device screen
    reason,            // WHY — explains the root cause
    fix,               // HOW TO FIX — actionable steps
    escalation,        // ESCALATION — where to get human help
    demand_rank: demandRank,   // call center demand priority (1 = highest)
  };
}

// WARNING result (action completes but with a known degradation)
function warn(code, severity, inline, reason, fix) {
  return {
    success: "warn",
    code,
    severity,
    inline,
    reason,
    fix,
    escalation: "💬 Chat via My Safaricom App > Help",
    demand_rank: null,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — RULES CATALOGUE
// 12 rules, ordered by call center demand (Oct–Dec 2025 aggregate).
// Each rule is a pure function: merchant → result.
// Rule priority reflects real contact volume — fix the highest first.
// ─────────────────────────────────────────────────────────────────────────────

//
// Rule metadata — exported so Step 4 dashboard can display demand context
//
export const RULE_METADATA = {
  SETTLE_FUNDS: {
    label: "Withdraw / Settle Funds",
    demand_rank: 1,
    demand_total: 14144,   // Oct + Nov + Dec calls
    menu_path: "Lipa na M-PESA → Withdraw / Settle Funds",
    ussd_path: "*234# → 1 → 1",
    description: "Merchant withdraws accumulated paybill balance to their bank account.",
  },
  PIN_PUK: {
    label: "Change / Reset PIN",
    demand_rank: 2,
    demand_total: 11353,
    menu_path: "Security & PIN → Change / Reset PIN",
    ussd_path: "*234# → 2 → 1",
    description: "Merchant changes or resets their M-PESA Business PIN.",
  },
  SIM_SWAP: {
    label: "SIM Swap Request",
    demand_rank: 3,
    demand_total: 10076,
    menu_path: "SIM & Operator → SIM Swap Request",
    ussd_path: "*234# → 4 → 1",
    description: "Merchant requests replacement SIM for their registered number.",
  },
  ACCOUNT_STATUS: {
    label: "Account Status & Issues",
    demand_rank: 4,
    demand_total: 9951,
    menu_path: "My Account → Account Status & Issues",
    ussd_path: "*234# → 3 → 1",
    description: "Merchant checks or resolves account suspension / freeze.",
  },
  START_KEY: {
    label: "Reset Start Key",
    demand_rank: 5,
    demand_total: 9303,
    menu_path: "Security & PIN → Reset Start Key",
    ussd_path: "*234# → 2 → 3",
    description: "Merchant resets their cryptographic start key used to authenticate transactions.",
  },
  STATEMENT: {
    label: "Mini Statement",
    demand_rank: 6,
    demand_total: 8330,
    menu_path: "Lipa na M-PESA → Mini Statement",
    ussd_path: "*234# → 1 → 3",
    description: "Merchant requests a transaction statement for the last 90 days.",
  },
  KYC_CHANGE: {
    label: "Update KYC Details",
    demand_rank: 7,
    demand_total: 8157,
    menu_path: "My Account → Update KYC Details",
    ussd_path: "*234# → 3 → 2",
    description: "Merchant updates identity or business KYC information.",
  },
  NOTIFICATIONS: {
    label: "Notification Settings",
    demand_rank: 8,
    demand_total: 5013,
    menu_path: "My Account → Notification Settings",
    ussd_path: "*234# → 3 → 4",
    description: "Merchant manages SMS and push notification preferences.",
  },
  BALANCE: {
    label: "Balance Enquiry",
    demand_rank: 9,
    demand_total: 4439,
    menu_path: "Lipa na M-PESA → Balance Enquiry",
    ussd_path: "*234# → 1 → 2",
    description: "Merchant checks available paybill balance.",
  },
  DORMANT_OP: {
    label: "Operator Status",
    demand_rank: 10,
    demand_total: 3778,
    menu_path: "SIM & Operator → Operator Status",
    ussd_path: "*234# → 4 → 2",
    description: "Merchant checks G2 operator active status and dormancy days.",
  },
  PIN_UNLOCK: {
    label: "Unlock PIN",
    demand_rank: 11,
    demand_total: 3788,
    menu_path: "Security & PIN → Unlock PIN",
    ussd_path: "*234# → 2 → 2",
    description: "Merchant unlocks their PIN after security lockout.",
  },
  APPLICATION: {
    label: "New Application",
    demand_rank: 12,
    demand_total: 3483,
    menu_path: "My Account → New Application",
    ussd_path: "*234# → 3 → 3",
    description: "Merchant submits a new paybill or product application.",
  },
};

//
// The rules themselves — one function per action key
//
const RULES = {

  // ── RULE 1: Settlement of Funds  (14,144 calls / 3 months)
  // Most common call driver. Blocked by: suspension, freeze, hold, expired KYC, SIM swap, zero balance.
  SETTLE_FUNDS: (m) => {
    if (m.account_status === "suspended")
      return fail("ACC_SUSPENDED", "critical",
        "Your account is suspended. Settlement is blocked.",
        "Account suspension prevents all fund disbursements until resolved.",
        "Visit the nearest Safaricom Shop or call 100 with your National ID to resolve the suspension.", 1);

    if (m.account_status === "frozen")
      return fail("ACC_FROZEN", "critical",
        "Account frozen — settlement on hold pending compliance review.",
        "A compliance hold prevents outflows. This is triggered by regulatory review or KYC overdue >365 days.",
        "Contact Safaricom Business Compliance on 0722 000 100 to initiate account unfreeze.", 1);

    if (m.settlement_on_hold)
      return fail("SETTLE_HOLD", "high",
        "Settlement is manually on hold for your paybill " + m.paybill + ".",
        "A settlement hold has been applied, often after a dispute or fraud investigation.",
        "Call 100 and reference your paybill " + m.paybill + " to request hold removal.", 1);

    if (m.kyc_status === "expired")
      return fail("KYC_EXPIRED", "high",
        "Settlement blocked — your KYC documents have expired.",
        "CBK regulations require valid KYC for all fund settlements. Your KYC is " + m.kyc_age_days + " days old.",
        "Update KYC at any Safaricom Shop. Bring: National ID + business certificate.", 1);

    if (m.sim_status === "swapped" && m.sim_swap_days_ago !== null && m.sim_swap_days_ago < 30)
      return fail("SIM_SWAP_HOLD", "medium",
        "Settlement locked for " + (30 - m.sim_swap_days_ago) + " more day(s) after SIM swap.",
        "A 30-day fraud prevention hold applies after every SIM swap event.",
        "Wait " + (30 - m.sim_swap_days_ago) + " day(s) or visit Safaricom Shop with original ID to request early lift.", 1);

    if (m.balance <= 0)
      return fail("ZERO_BALANCE", "high",
        "No balance available to settle.",
        "Your paybill has zero or negative balance — nothing to disburse.",
        "Accept customer payments to accumulate balance, then initiate settlement.", 1);

    return ok("Settlement of " + formatKES(m.balance) + " processed to " + m.bank_account_name + " (" + m.bank + "). Funds arrive within 24 working hours.");
  },

  // ── RULE 2: PIN / PUK Request  (11,353 calls)
  PIN_PUK: (m) => {
    if (m.account_status === "suspended")
      return fail("ACC_SUSPENDED", "critical",
        "PIN operations are blocked — account is suspended.",
        "Account suspension restricts all authentication and security operations.",
        "Resolve the account suspension first by calling 100 or visiting Safaricom Shop.", 2);

    if (m.pin_locked)
      return fail("PIN_LOCKED", "high",
        "Account locked after 3 failed PIN attempts.",
        "Security lockout is triggered automatically after 3 consecutive wrong PINs.",
        "Visit any Safaricom Shop with your National ID for PIN reset. USSD/App self-service is unavailable after lockout.", 2);

    if (m.sim_status === "swapped" && m.sim_swap_days_ago !== null && m.sim_swap_days_ago < 7)
      return fail("SIM_SWAP_RECENT", "medium",
        "PIN request blocked — SIM swap was " + m.sim_swap_days_ago + " day(s) ago (7-day hold).",
        "A 7-day security hold prevents PIN changes immediately after SIM swap.",
        "Wait " + (7 - m.sim_swap_days_ago) + " more day(s) or visit Safaricom Shop in person.", 2);

    return ok("PIN/PUK request initiated. A confirmation SMS will be sent to " + m.phone_number + " within 2 minutes.");
  },

  // ── RULE 3: SIM Swap  (10,076 calls)
  SIM_SWAP: (m) => {
    if (m.account_status === "frozen")
      return fail("ACC_FROZEN", "critical",
        "SIM swap not permitted — account is frozen.",
        "Frozen accounts cannot process identity changes until the freeze is lifted.",
        "Request account unfreeze via 0722 000 100, then retry SIM swap.", 3);

    if (m.account_status === "suspended")
      return fail("ACC_SUSPENDED", "critical",
        "SIM swap blocked — account is suspended.",
        "Suspended accounts cannot initiate SIM swaps.",
        "Resolve the suspension first by calling 100 or visiting Safaricom Shop.", 3);

    if (m.kyc_status === "expired")
      return fail("KYC_EXPIRED", "high",
        "SIM swap requires valid KYC. Yours expired " + (m.kyc_age_days - 365) + " day(s) ago.",
        "CBK regulatory requirement: valid KYC must be on file for SIM swap.",
        "Renew KYC at any Safaricom Shop before proceeding with SIM swap.", 3);

    if (m.kyc_status === "pending")
      return fail("KYC_PENDING", "medium",
        "SIM swap on hold — KYC review is still in progress.",
        "Cannot process SIM swap while KYC is actively under review.",
        "Wait 24–48hrs for KYC approval, or visit Safaricom Shop to expedite review.", 3);

    if (m.pin_locked)
      return fail("PIN_LOCKED", "high",
        "Cannot process SIM swap — PIN is locked.",
        "A valid PIN is required to authenticate the SIM swap request.",
        "Reset PIN at Safaricom Shop first, then retry SIM swap.", 3);

    return ok("SIM swap initiated. Present your National ID at any Safaricom Shop. Reference: SWP-" + m.paybill + ". Processing takes 2–4 hours.");
  },

  // ── RULE 4: Account Status & Issues  (9,951 calls)
  ACCOUNT_STATUS: (m) => {
    if (m.account_status === "active" && m.dormant_days < 30 && m.kyc_status === "verified")
      return ok("Account is fully active. KYC: VERIFIED. Last activity: " + m.dormant_days + " day(s) ago. All services operational.");

    if (m.kyc_age_days > 365)
      return fail("KYC_OVERDUE_365", "critical",
        "Account frozen — KYC overdue by " + (m.kyc_age_days - 365) + " day(s).",
        "Accounts with KYC older than 1 year are automatically frozen per Safaricom compliance policy.",
        "Renew KYC immediately at any Safaricom Shop. Bring: National ID, Business Certificate, KRA PIN.", 4);

    if (m.dormant_days >= 90)
      return fail("FULLY_DORMANT", "critical",
        "Account suspended — no transactions in " + m.dormant_days + " days.",
        "Accounts with no activity for 90+ days are automatically suspended by the dormancy system.",
        "Visit Safaricom Shop or call 100 to reactivate. A transaction history review will be required.", 4);

    if (m.dormant_days >= 60)
      return fail("DORMANT_60", "high",
        "Account suspended — inactive for " + m.dormant_days + " days.",
        "Dormancy suspension is triggered at 60 days of inactivity.",
        "Call 100 or visit Safaricom Shop with National ID to reactivate your account.", 4);

    if (m.account_status === "frozen")
      return fail("COMPLIANCE_FREEZE", "critical",
        "Account is under a compliance freeze. All services restricted.",
        "The compliance team has placed a hold on your account for regulatory review.",
        "Contact Safaricom Business Compliance: 0722 000 100. Have paybill " + m.paybill + " and ID ready.", 4);

    if (m.account_status === "suspended")
      return fail("COMPLIANCE_HOLD", "high",
        "Account is suspended. Services are restricted.",
        "Account suspension may be due to inactivity, compliance review, or manual hold.",
        "Call 100 or visit Safaricom Shop with National ID to resolve and reactivate.", 4);

    return ok("Account status: " + m.account_status.toUpperCase() + ". KYC: " + m.kyc_status.toUpperCase() + ". Dormant days: " + m.dormant_days + ". Review required.");
  },

  // ── RULE 5: Start Key Reset  (9,303 calls)
  START_KEY: (m) => {
    if (m.start_key_status === "expired")
      return fail("START_KEY_EXPIRED", "critical",
        "Start key expired — you cannot send or receive any payments.",
        "An expired start key completely breaks the merchant payment pipeline. Customers cannot pay you.",
        "Request urgent start key renewal via the Safaricom Business portal or call 100 immediately.", 5);

    if (m.start_key_status === "invalid")
      return fail("START_KEY_CORRUPT", "critical",
        "Start key is corrupted. Customer payments are actively failing.",
        "Key corruption is caused by SIM swap without re-registration, or a system error. Payments fail silently.",
        "Visit any Safaricom Shop immediately with National ID. Request emergency start key regeneration.", 5);

    if (m.account_status !== "active")
      return fail("ACC_NOT_ACTIVE", "high",
        "Start key reset requires an active account.",
        "Key operations are locked when account is " + m.account_status + ".",
        "Reactivate the account first, then retry the start key reset.", 5);

    if (m.sim_status === "swapped" && m.sim_swap_days_ago !== null && m.sim_swap_days_ago < 2)
      return fail("SIM_SWAP_KEY_HOLD", "medium",
        "Start key reset available in " + (2 - m.sim_swap_days_ago) + " day(s) — SIM swap too recent.",
        "System requires SIM stabilisation before issuing new start key.",
        "Wait 1–2 days after SIM swap, then retry. Or visit Safaricom Shop for same-day resolution.", 5);

    return ok("Start key reset successful. New key provisioned to " + m.phone_number + ". Key activates within 5 minutes. Test a payment to confirm.");
  },

  // ── RULE 6: Statement Request  (8,330 calls)
  STATEMENT: (m) => {
    if (m.account_status === "suspended")
      return fail("ACC_SUSPENDED", "medium",
        "Statement access restricted — account is suspended.",
        "Suspended accounts have limited portal access. Full statements are unavailable.",
        "Call 100 for a partial statement via agent access. Resolve suspension to restore full access.", 6);

    if (m.account_status === "frozen")
      return fail("ACC_FROZEN", "medium",
        "Statement access restricted — account is under compliance freeze.",
        "Frozen accounts have read-restricted access. Statement generation is paused.",
        "Contact the compliance team on 0722 000 100 to request a statement during the freeze period.", 6);

    if (!m.notifications_enabled)
      return warn("NOTIF_OFF", "low",
        "Statement generated but cannot be delivered — notifications are disabled.",
        "SMS and email notifications are turned off on your account. The statement was created but won't be sent.",
        "Enable notifications: App > Settings > Notifications > Enable All. Then request statement again.");

    return ok("Statement for paybill " + m.paybill + " generated and sent to " + m.email + " and " + m.phone_number + ". Covers last 90 days.");
  },

  // ── RULE 7: Update KYC Details  (8,157 calls)
  KYC_CHANGE: (m) => {
    if (m.account_status === "frozen")
      return fail("ACC_FROZEN", "critical",
        "KYC changes blocked — account is frozen.",
        "Frozen accounts require compliance clearance before any KYC modifications.",
        "Request account unfreeze first via 0722 000 100, then resubmit KYC change.", 7);

    if (m.sim_status === "swapped" && m.sim_swap_days_ago !== null && m.sim_swap_days_ago < 14)
      return fail("SIM_SWAP_KYC_HOLD", "medium",
        "KYC change blocked — " + (14 - m.sim_swap_days_ago) + " day(s) remaining on post-SIM swap hold.",
        "A 14-day fraud prevention hold restricts KYC changes after every SIM swap.",
        "Wait " + (14 - m.sim_swap_days_ago) + " day(s), or visit Safaricom Shop in person for an assisted KYC update.", 7);

    if (m.kyc_status === "pending")
      return fail("KYC_REVIEW_ACTIVE", "medium",
        "KYC change locked — a review is already in progress.",
        "You cannot modify KYC details while an existing review is active.",
        "Wait 24–48 hours for current review to complete, then submit your changes.", 7);

    return ok("KYC update submitted for paybill " + m.paybill + ". Review expected within 24–48 hours. Reference: KYC-" + m.document_number + ".");
  },

  // ── RULE 8: Notification Settings  (5,013 calls)
  NOTIFICATIONS: (m) => {
    if (!m.notifications_enabled)
      return fail("NOTIF_DISABLED", "low",
        "Notifications are OFF — you will miss payment alerts, settlement SMS, and security warnings.",
        "Your account has notifications disabled. This causes missed payment confirmations and delayed fraud alerts.",
        "Enable via: App > Settings > Notifications > Enable All. Or: *234# > 3 > 4.", 8);

    if (m.sim_status === "swapped")
      return fail("SIM_NOTIF_UNREG", "medium",
        "New SIM not registered — notifications are going to your old number.",
        "SIM swap does not automatically re-register notification channels. Your old SIM receives alerts.",
        "Update via: *234# > My Account > Update Phone Number, or visit Safaricom Shop.", 8);

    if (m.account_status !== "active")
      return fail("ACC_INACTIVE_NOTIF", "medium",
        "Notifications are paused while account is " + m.account_status + ".",
        "Non-active accounts have notification services suspended as part of account lifecycle policy.",
        "Reactivate the account to restore full notification delivery.", 8);

    return ok("Notification test sent to " + m.phone_number + " and " + m.email + ". All channels are operational. You will receive payment and security alerts in real time.");
  },

  // ── RULE 9: Balance Enquiry  (4,439 calls)
  BALANCE: (m) => {
    if (m.account_status === "frozen")
      return fail("ACC_FROZEN_BAL", "medium",
        "Balance display restricted — account is frozen.",
        "Frozen accounts have read-limited access. Balance cannot be confirmed via self-service.",
        "Contact 0722 000 100 for a balance confirmation from a Safaricom agent.", 9);

    if (m.pin_locked)
      return fail("PIN_LOCKED_BAL", "high",
        "Balance enquiry unavailable — PIN is locked.",
        "PIN lockout restricts all authenticated account actions including balance checks.",
        "Reset PIN at any Safaricom Shop with National ID, then retry balance enquiry.", 9);

    return ok("Available Balance: " + formatKES(m.balance) + " | Paybill: " + m.paybill + " | Last activity: " + m.dormant_days + " day(s) ago.");
  },

  // ── RULE 10: G2 Dormant Operator  (3,778 calls)
  DORMANT_OP: (m) => {
    if (m.operator_dormant_days >= 90)
      return fail("OP_FULLY_DORMANT", "critical",
        "Operator access revoked — inactive for " + m.operator_dormant_days + " days.",
        "G2 operator permissions are automatically revoked after 90 days without login or transaction.",
        "Visit Safaricom Shop for operator reactivation. Bring: National ID + business registration documents.", 10);

    if (m.operator_dormant_days >= 60)
      return fail("OP_DORMANT_WARN", "high",
        "Warning: Operator approaching dormancy lock (" + m.operator_dormant_days + "/90 days inactive).",
        "Operator will be fully locked in " + (90 - m.operator_dormant_days) + " day(s) if no action is taken.",
        "Initiate any transaction or G2 login now to reset your dormancy timer.", 10);

    if (m.operator_dormant_days >= 30)
      return warn("OP_DORMANT_NOTICE", "low",
        "Operator inactive for " + m.operator_dormant_days + " days. Dormancy warning at 60 days.",
        "Early notice: operator has been inactive for " + m.operator_dormant_days + " days.",
        "Make a transaction soon to prevent dormancy escalation.");

    return ok("Operator is active. Last activity " + m.operator_dormant_days + " day(s) ago. Dormancy warning triggers at 60 days. You are clear.");
  },

  // ── RULE 11: PIN Unlock  (3,788 calls)
  PIN_UNLOCK: (m) => {
    if (!m.pin_locked)
      return ok("PIN is not locked. Current failed attempts: " + m.pin_attempts + "/3. No unlock needed.");

    if (m.account_status === "suspended")
      return fail("ACC_SUSPENDED_UNLOCK", "critical",
        "Cannot unlock PIN — account is suspended.",
        "Account suspension blocks all authentication management including PIN unlock.",
        "Resolve the suspension first (call 100), then proceed with PIN unlock.", 11);

    if (m.kyc_status === "expired")
      return fail("KYC_EXPIRED_UNLOCK", "high",
        "PIN unlock requires valid KYC. Your KYC has expired.",
        "Identity verification for PIN unlock fails when KYC is expired.",
        "Renew KYC at Safaricom Shop, then return for PIN unlock via OTP.", 11);

    if (m.sim_status === "swapped" && m.sim_swap_days_ago !== null && m.sim_swap_days_ago < 7)
      return fail("SIM_SWAP_PIN_UNLOCK", "medium",
        "PIN unlock blocked — SIM swap too recent (" + m.sim_swap_days_ago + " day(s) ago).",
        "OTP for PIN unlock cannot be sent to a new SIM within 7 days of swap.",
        "Wait " + (7 - m.sim_swap_days_ago) + " more day(s), or visit Safaricom Shop in person for immediate unlock.", 11);

    return ok("PIN unlock OTP sent to " + m.phone_number + ". Enter the code within 5 minutes to complete unlock. Your PIN will reset to a new value.");
  },

  // ── RULE 12: New Application  (3,483 calls)
  APPLICATION: (m) => {
    if (m.kyc_status === "expired")
      return fail("KYC_EXPIRED_APP", "high",
        "Application rejected — KYC has expired.",
        "All new applications require valid KYC on file. Your KYC expired " + (m.kyc_age_days - 365) + " day(s) ago.",
        "Renew KYC first. Required documents: National ID, Business Certificate, KRA PIN.", 12);

    if (m.kyc_status === "pending")
      return fail("KYC_PENDING_APP", "medium",
        "Application on hold — KYC review is in progress.",
        "New applications cannot be processed while a KYC review is active for the same merchant.",
        "Wait 24–48hrs for current KYC review to complete, then resubmit.", 12);

    if (m.account_status === "suspended")
      return fail("ACC_SUSPENDED_APP", "critical",
        "Application blocked — account is suspended.",
        "Suspended merchants cannot initiate new product applications.",
        "Resolve the suspension first, then resubmit your application.", 12);

    if (m.account_status === "frozen")
      return fail("ACC_FROZEN_APP", "critical",
        "Application blocked — account is frozen.",
        "Frozen accounts cannot initiate new applications until the compliance freeze is lifted.",
        "Contact the compliance team to unfreeze, then resubmit.", 12);

    return ok("Application submitted for paybill " + m.paybill + ". Reference: APP-" + m.paybill + "-" + Date.now().toString().slice(-6) + ". Expected review: 3–5 business days.");
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — EVALUATOR
// Public API: evaluate one action against one merchant.
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateAction(merchant, actionKey) {
  const rule = RULES[actionKey];
  if (!rule) return ok("Action not found in rules engine.");
  try {
    return rule(merchant);
  } catch (err) {
    return fail("RULE_ERROR", "high",
      "An error occurred evaluating this action.",
      "Rules engine threw: " + err.message,
      "Report this error to the digital twin engineering team.");
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — PRE-SCANNER
// Runs ALL rules against ONE merchant and returns a sorted failure list.
// This is how the twin detects failures BEFORE the merchant even tries.
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

export function scanAllFailures(merchant) {
  const results = [];

  Object.keys(RULES).forEach(actionKey => {
    const result = evaluateAction(merchant, actionKey);
    const meta = RULE_METADATA[actionKey];

    if (!result.success) {
      results.push({
        actionKey,
        actionLabel: meta.label,
        menu_path: meta.menu_path,
        ussd_path: meta.ussd_path,
        demand_rank: meta.demand_rank,
        demand_total: meta.demand_total,
        ...result,
      });
    }
  });

  // Sort by: severity first, then demand rank (highest impact failures first)
  results.sort((a, b) => {
    const sevDiff = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
    if (sevDiff !== 0) return sevDiff;
    return (a.demand_rank || 99) - (b.demand_rank || 99);
  });

  return results;
}

// Get pass/fail summary counts for a merchant
export function getMerchantSummary(merchant) {
  const all = Object.keys(RULES).map(key => ({
    key,
    result: evaluateAction(merchant, key),
    meta: RULE_METADATA[key],
  }));

  const failures = all.filter(r => !r.result.success);
  const passing = all.filter(r => r.result.success === true);
  const warnings = all.filter(r => r.result.success === "warn");

  const bySevirity = { critical: 0, high: 0, medium: 0, low: 0 };
  failures.forEach(f => { bySevirity[f.result.severity] = (bySevirity[f.result.severity] || 0) + 1; });

  return {
    total: all.length,
    passing: passing.length,
    warnings: warnings.length,
    failures: failures.length,
    bySeverity: bySevirity,
    // Estimated call center contacts prevented if failures are fixed
    callsAtRisk: failures.reduce((sum, f) => sum + (f.meta?.demand_total || 0), 0),
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — BATCH SCANNER
// Runs all rules across an entire fleet of merchants.
// Used by Step 4 dashboard to show fleet-level risk and prioritise outreach.
// ─────────────────────────────────────────────────────────────────────────────

export function scanMerchantBatch(merchants) {
  const merchantResults = merchants.map(merchant => ({
    merchant,
    failures: scanAllFailures(merchant),
    summary: getMerchantSummary(merchant),
  }));

  // Fleet-level stats
  const totalMerchants = merchants.length;
  const merchantsWithCritical = merchantResults.filter(r => r.summary.bySeverity.critical > 0).length;
  const merchantsWithAnyFailure = merchantResults.filter(r => r.summary.failures > 0).length;
  const totalCallsAtRisk = merchantResults.reduce((sum, r) => sum + r.summary.callsAtRisk, 0);

  // Most common failure across fleet
  const failureFrequency = {};
  merchantResults.forEach(({ failures }) => {
    failures.forEach(f => {
      failureFrequency[f.code] = (failureFrequency[f.code] || 0) + 1;
    });
  });
  const topFailures = Object.entries(failureFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, count]) => ({ code, count, pct: Math.round((count / totalMerchants) * 100) }));

  return {
    merchantResults,
    fleet: {
      totalMerchants,
      merchantsWithCritical,
      merchantsWithAnyFailure,
      healthyMerchants: totalMerchants - merchantsWithAnyFailure,
      totalCallsAtRisk,
      topFailures,
    },
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — MENU STRUCTURE
// Exported here so the simulator (Step 3) and dashboard (Step 4)
// both share the same canonical menu tree — single source of truth.
// ─────────────────────────────────────────────────────────────────────────────

export const MENU_STRUCTURE = [
  {
    id: "payments", label: "Lipa na M-PESA", icon: "💳", ussd: "1",
    items: [
      { id: "SETTLE_FUNDS", label: "Withdraw / Settle Funds", ussd: "1" },
      { id: "BALANCE",      label: "Balance Enquiry",         ussd: "2" },
      { id: "STATEMENT",    label: "Mini Statement",          ussd: "3" },
    ],
  },
  {
    id: "security", label: "Security & PIN", icon: "🔐", ussd: "2",
    items: [
      { id: "PIN_PUK",    label: "Change / Reset PIN", ussd: "1" },
      { id: "PIN_UNLOCK", label: "Unlock PIN",         ussd: "2" },
      { id: "START_KEY",  label: "Reset Start Key",   ussd: "3" },
    ],
  },
  {
    id: "account", label: "My Account", icon: "🏦", ussd: "3",
    items: [
      { id: "ACCOUNT_STATUS", label: "Account Status & Issues", ussd: "1" },
      { id: "KYC_CHANGE",     label: "Update KYC Details",     ussd: "2" },
      { id: "APPLICATION",    label: "New Application",        ussd: "3" },
      { id: "NOTIFICATIONS",  label: "Notification Settings",  ussd: "4" },
    ],
  },
  {
    id: "simop", label: "SIM & Operator", icon: "📡", ussd: "4",
    items: [
      { id: "SIM_SWAP",   label: "SIM Swap Request", ussd: "1" },
      { id: "DORMANT_OP", label: "Operator Status",  ussd: "2" },
    ],
  },
];
