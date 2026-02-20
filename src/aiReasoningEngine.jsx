// ═══════════════════════════════════════════════════════════════════════════
// AI REASONING ENGINE  —  Claude-Powered Merchant Intelligence
// Safaricom LNM Merchant Digital Twin
//
// Replaces hardcoded intervention templates with live Claude reasoning.
// Claude receives the full merchant sensor state + failure context and
// reasons across compound failures like a human analyst would.
//
// Functions exported:
//   analyzeWithClaude(merchant, failures, actionKey, result) → AI output
//   generateFleetInsight(batchResult) → fleet-level AI summary
//   generateInterventionSMS(merchant, failure) → personalized SMS draft
//   generateAgentBriefing(merchant, failures) → CRM agent briefing note
//
// Used by: twinDashboardV2.jsx (Step 4 upgraded)
// ═══════════════════════════════════════════════════════════════════════════

import { getSensorHealth, getRiskTier, formatKES } from "./merchantDataModel";
import { RULE_METADATA } from "./failureRulesEngine";

const MODEL = "claude-sonnet-4-20250514";
const API_URL = "https://api.anthropic.com/v1/messages";

// ─────────────────────────────────────────────────────────────────────────────
// CORE API CALLER
// ─────────────────────────────────────────────────────────────────────────────
async function callClaude(systemPrompt, userPrompt, maxTokens = 1000) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`API error ${response.status}: ${err.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const text = data.content?.map(b => b.text || "").join("") || "";
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// MERCHANT CONTEXT BUILDER
// Serializes merchant state into a structured prompt context
// ─────────────────────────────────────────────────────────────────────────────
function buildMerchantContext(merchant, failures = []) {
  const { red, amber, green } = getSensorHealth(merchant);
  const tier = getRiskTier(merchant);

  return `
MERCHANT PROFILE:
  Name: ${merchant.first_name} ${merchant.last_name}
  Business: ${merchant.business_name} (${merchant.business_category})
  Paybill: ${merchant.paybill}
  Phone: ${merchant.phone_number}
  County: ${merchant.county}
  Bank: ${merchant.bank} — ${merchant.bank_account_name}
  Balance: ${formatKES(merchant.balance)}
  Risk Tier: ${tier}

LIVE SENSOR STATE:
  account_status: ${merchant.account_status}
  kyc_status: ${merchant.kyc_status} (age: ${merchant.kyc_age_days} days)
  sim_status: ${merchant.sim_status}${merchant.sim_swap_days_ago !== null ? ` (swapped ${merchant.sim_swap_days_ago} days ago)` : ""}
  pin_attempts: ${merchant.pin_attempts}/3 | pin_locked: ${merchant.pin_locked}
  start_key_status: ${merchant.start_key_status}
  dormant_days: ${merchant.dormant_days}
  operator_dormant_days: ${merchant.operator_dormant_days}
  notifications_enabled: ${merchant.notifications_enabled}
  settlement_on_hold: ${merchant.settlement_on_hold}

SENSOR HEALTH:
  🔴 Critical sensors: ${red.length > 0 ? red.join(", ") : "none"}
  🟡 Warning sensors: ${amber.length > 0 ? amber.join(", ") : "none"}
  🟢 OK sensors: ${green.length} of ${red.length + amber.length + green.length}

DETECTED FAILURES (${failures.length}):
${failures.length > 0
  ? failures.map(f => `  [${f.severity.toUpperCase()}] ${f.actionLabel} — ${f.code}: ${f.inline}`).join("\n")
  : "  None"}
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. MAIN ANALYSIS — replaces getTwinOutput()
// Returns structured reasoning across all compound failures
// ─────────────────────────────────────────────────────────────────────────────
export async function analyzeWithClaude(merchant, failures, actionKey, result) {
  const meta = actionKey ? RULE_METADATA[actionKey] : null;
  const merchantCtx = buildMerchantContext(merchant, failures);

  const system = `You are an AI reasoning engine embedded in a Safaricom merchant digital twin system.
Your role is to analyze M-PESA Business merchant account states and provide:
1. Compound failure analysis (how multiple sensor failures interact)
2. Root cause diagnosis
3. Prioritized intervention recommendations for Safaricom agents
4. Risk assessment and predicted contact center impact

You have deep knowledge of Safaricom M-PESA Business operations including:
- LNM (Lipa na M-PESA) paybill lifecycle
- KYC requirements and CBK regulations
- SIM swap security protocols
- Account dormancy rules
- Settlement processes
- G2 operator permissions

Always be specific, actionable, and reference exact sensor values.
Format your response as clean JSON only — no markdown, no preamble.`;

  const user = `Analyze this merchant's digital twin state and the triggered failure.

${merchantCtx}

TRIGGERED ACTION: ${meta ? `${meta.label} (${meta.ussd_path})` : "Pre-scan analysis"}
RESULT: ${result ? `${result.success ? "SUCCESS" : "FAILED"} — ${result.code || "OK"} — ${result.inline}` : "Pre-scan"}
DEMAND CONTEXT: ${meta ? `${meta.demand_total.toLocaleString()} calls to contact center for this issue (Oct–Dec 2025)` : "Multiple issues"}

Respond with exactly this JSON structure:
{
  "compound_analysis": "2-3 sentence explanation of how the failing sensors interact with each other to create compounded risk",
  "primary_root_cause": "The single most critical thing causing failures right now",
  "predicted_next_failure": "What will fail next if nothing is done, and when",
  "risk_score": <number 0-100>,
  "risk_explanation": "Why this score",
  "interventions": [
    { "priority": 1, "action": "specific action", "channel": "SMS|Call|In-Person|Portal", "timeframe": "immediate|24hrs|48hrs|7days" },
    { "priority": 2, "action": "specific action", "channel": "SMS|Call|In-Person|Portal", "timeframe": "immediate|24hrs|48hrs|7days" },
    { "priority": 3, "action": "specific action", "channel": "SMS|Call|In-Person|Portal", "timeframe": "immediate|24hrs|48hrs|7days" }
  ],
  "calls_prevented_if_resolved": <estimated number of contact center calls prevented>,
  "escalate_immediately": <true|false>,
  "escalation_reason": "Why immediate escalation is or isn't needed"
}`;

  const raw = await callClaude(system, user, 800);

  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    return { success: true, data: JSON.parse(clean), raw };
  } catch {
    return { success: false, raw, data: null, error: "Failed to parse Claude response" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PERSONALIZED SMS GENERATOR
// Drafts intervention SMS in both English and Kiswahili
// ─────────────────────────────────────────────────────────────────────────────
export async function generateInterventionSMS(merchant, failure) {
  const system = `You are drafting intervention SMS messages for Safaricom M-PESA Business merchants in Kenya.
Messages must be:
- Under 160 characters each (one SMS)
- Clear and actionable with no jargon
- Written in a helpful, not alarming tone
- Include the specific fix step
- Respond with JSON only.`;

  const user = `Draft two SMS messages for this merchant — one in English, one in Kiswahili.

Merchant: ${merchant.first_name} ${merchant.last_name} — ${merchant.business_name}
Issue: ${failure.code} — ${failure.inline}
Fix required: ${failure.fix}
Paybill: ${merchant.paybill}

JSON format:
{
  "english": "SMS text in English under 160 chars",
  "kiswahili": "SMS text in Kiswahili under 160 chars",
  "urgency": "low|medium|high|critical"
}`;

  const raw = await callClaude(system, user, 300);
  try {
    return { success: true, data: JSON.parse(raw.replace(/```json|```/g, "").trim()) };
  } catch {
    return { success: false, raw };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. AGENT BRIEFING GENERATOR
// Creates a CRM-ready briefing note for a contact center agent
// ─────────────────────────────────────────────────────────────────────────────
export async function generateAgentBriefing(merchant, failures) {
  const merchantCtx = buildMerchantContext(merchant, failures);

  const system = `You are generating CRM briefing notes for Safaricom contact center agents.
Notes must be concise, structured, and immediately actionable.
The agent will use this note before calling or meeting the merchant.
Respond with JSON only.`;

  const user = `Generate a contact center agent briefing note for this merchant visit/call.

${merchantCtx}

JSON format:
{
  "headline": "One sentence summary of the merchant's situation",
  "open_with": "Exactly what the agent should say to open the conversation",
  "key_issues": ["issue 1", "issue 2", "issue 3"],
  "resolution_steps": ["step 1", "step 2", "step 3"],
  "things_to_avoid": ["don't say X", "don't promise Y"],
  "escalation_threshold": "When to escalate to senior agent",
  "estimated_handle_time": "X minutes"
}`;

  const raw = await callClaude(system, user, 600);
  try {
    return { success: true, data: JSON.parse(raw.replace(/```json|```/g, "").trim()) };
  } catch {
    return { success: false, raw };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. FLEET INSIGHT GENERATOR
// High-level AI summary of the entire merchant fleet's health
// ─────────────────────────────────────────────────────────────────────────────
export async function generateFleetInsight(batchResult) {
  const { fleet, merchantResults } = batchResult;

  const merchantSummaries = merchantResults.map(({ merchant, summary, failures }) => ({
    name: merchant.business_name,
    paybill: merchant.paybill,
    tier: getRiskTier(merchant),
    failures: failures.length,
    critical: summary.bySeverity.critical,
    callsAtRisk: summary.callsAtRisk,
    topIssue: failures[0]?.code || "none",
  }));

  const system = `You are an AI analyst reviewing a fleet of Safaricom M-PESA Business merchants.
Provide strategic insights for a Safaricom operations manager.
Be concise, data-driven, and specific. Respond with JSON only.`;

  const user = `Analyze this merchant fleet health snapshot.

FLEET SUMMARY:
  Total merchants: ${fleet.totalMerchants}
  Healthy: ${fleet.healthyMerchants}
  With failures: ${fleet.merchantsWithAnyFailure}
  Critical: ${fleet.merchantsWithCritical}
  Estimated contact center calls at risk: ${fleet.totalCallsAtRisk.toLocaleString()}
  Top failure codes: ${fleet.topFailures.map(f => `${f.code} (${f.count} merchants)`).join(", ")}

MERCHANT BREAKDOWN:
${merchantSummaries.map(m => `  ${m.name} (PB:${m.paybill}) — ${m.tier} — ${m.failures} failures — ${m.callsAtRisk} calls at risk`).join("\n")}

JSON format:
{
  "fleet_health_summary": "2-3 sentence executive summary",
  "biggest_risk": "The single most urgent fleet-level risk",
  "pattern_detected": "Any pattern across merchants (e.g. KYC expiry cluster, dormancy wave)",
  "recommended_campaign": "What proactive outreach campaign Safaricom should run",
  "estimated_call_reduction": "Estimated % reduction in contact center calls if top issues are resolved",
  "priority_merchants": ["merchant name 1", "merchant name 2", "merchant name 3"],
  "30_day_forecast": "What will happen to the fleet in 30 days if no action is taken"
}`;

  const raw = await callClaude(system, user, 700);
  try {
    return { success: true, data: JSON.parse(raw.replace(/```json|```/g, "").trim()) };
  } catch {
    return { success: false, raw };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ANOMALY DETECTOR
// Statistical anomaly detection on failure rates using Z-score
// No ML library needed — pure JavaScript
// ─────────────────────────────────────────────────────────────────────────────
export function detectAnomalies(eventLog) {
  if (eventLog.length < 10) return [];

  // Group failures by action key, compute rate per 10-event window
  const windows = [];
  const windowSize = 10;
  for (let i = 0; i <= eventLog.length - windowSize; i++) {
    const window = eventLog.slice(i, i + windowSize);
    const failRate = window.filter(e => !e.success).length / windowSize;
    windows.push(failRate);
  }

  const mean = windows.reduce((a, b) => a + b, 0) / windows.length;
  const variance = windows.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / windows.length;
  const stdDev = Math.sqrt(variance);

  const latest = windows[windows.length - 1];
  const zScore = stdDev > 0 ? (latest - mean) / stdDev : 0;

  const anomalies = [];
  if (zScore > 1.5) {
    anomalies.push({
      type: "FAILURE_RATE_SPIKE",
      severity: zScore > 2.5 ? "critical" : "high",
      message: `Failure rate anomaly detected — ${(latest * 100).toFixed(0)}% vs baseline ${(mean * 100).toFixed(0)}%`,
      zScore: zScore.toFixed(2),
      description: `Z-score of ${zScore.toFixed(2)} indicates a statistically significant spike in failures across the fleet.`,
    });
  }

  // Detect critical merchant cluster
  return anomalies;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. FAILURE PREDICTOR
// Scores each merchant 0-100 on likelihood of calling contact center
// within 7 days, based on sensor proximity to failure thresholds
// ─────────────────────────────────────────────────────────────────────────────
export function predictContactProbability(merchant) {
  let score = 0;
  const factors = [];

  // Account status
  if (merchant.account_status === "suspended") { score += 30; factors.push("Account suspended (+30)"); }
  else if (merchant.account_status === "frozen") { score += 35; factors.push("Account frozen (+35)"); }

  // KYC proximity to expiry (365 days)
  if (merchant.kyc_status === "expired") { score += 25; factors.push("KYC expired (+25)"); }
  else if (merchant.kyc_age_days > 300) { score += 15; factors.push(`KYC aging ${merchant.kyc_age_days}d (+15)`); }
  else if (merchant.kyc_age_days > 240) { score += 8; factors.push(`KYC aging ${merchant.kyc_age_days}d (+8)`); }

  // PIN proximity to lockout
  if (merchant.pin_locked) { score += 20; factors.push("PIN locked (+20)"); }
  else if (merchant.pin_attempts === 2) { score += 12; factors.push("2 PIN attempts (+12)"); }

  // SIM swap recency
  if (merchant.sim_status === "swapped") {
    const daysAgo = merchant.sim_swap_days_ago || 0;
    if (daysAgo < 7) { score += 18; factors.push(`SIM swap ${daysAgo}d ago (+18)`); }
    else if (daysAgo < 30) { score += 10; factors.push(`SIM swap ${daysAgo}d ago (+10)`); }
  }

  // Start key
  if (merchant.start_key_status === "expired") { score += 22; factors.push("Start key expired (+22)"); }
  else if (merchant.start_key_status === "invalid") { score += 18; factors.push("Start key invalid (+18)"); }

  // Dormancy proximity
  if (merchant.dormant_days >= 60) { score += 20; factors.push(`Dormant ${merchant.dormant_days}d (+20)`); }
  else if (merchant.dormant_days >= 45) { score += 12; factors.push(`Dormant ${merchant.dormant_days}d (+12)`); }
  else if (merchant.dormant_days >= 30) { score += 6; factors.push(`Dormant ${merchant.dormant_days}d (+6)`); }

  // Notifications off
  if (!merchant.notifications_enabled) { score += 8; factors.push("Notifications off (+8)"); }

  // Settlement hold
  if (merchant.settlement_on_hold) { score += 10; factors.push("Settlement on hold (+10)"); }

  // Operator dormancy
  if (merchant.operator_dormant_days >= 60) { score += 10; factors.push(`Operator dormant ${merchant.operator_dormant_days}d (+10)`); }

  const capped = Math.min(score, 100);
  const tier = capped >= 70 ? "VERY HIGH" : capped >= 50 ? "HIGH" : capped >= 30 ? "MEDIUM" : "LOW";
  const color = capped >= 70 ? "#ef4444" : capped >= 50 ? "#f97316" : capped >= 30 ? "#eab308" : "#4ade80";

  return { score: capped, tier, color, factors };
}