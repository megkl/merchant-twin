// ═══════════════════════════════════════════════════════════════════════════
// TWIN LOOP DASHBOARD  —  Step 4 of 4
// Safaricom LNM Merchant Digital Twin
//
// Panels:
//   1. Twin Loop Visualiser     (Mirror → Analyze → Update → Summarize)
//   2. Fleet Overview           (all merchants, risk tiers, health scores)
//   3. Pre-Failure Alert Feed   (failures detected before merchant tries)
//   4. Real-Time Activity Log   (every action, timestamp, outcome)
//   5. Demand Heatmap           (call center volume vs predicted failure rate)
//   6. Merchant Deep-Dive       (full sensor state + all 12 rule results)
//
// Twin outputs per failure:
//   • Proactive alert           (caught before merchant tries)
//   • Diagnostic replay         (root cause explanation)
//   • Intervention rec.         (what Safaricom should do)
//   • Escalation trigger        (auto-flag critical merchants)
//
// Imports from: merchantDataModel.js (Step 1) + failureRulesEngine.js (Step 2)
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";

import {
  MERCHANT_REGISTRY,
  generateMerchantBatch,
  getRiskTier,
  RISK_TIER_STYLE,
  getSensorHealth,
  formatKES,
  SENSOR_FIELDS,
  advanceDays,
  applySimSwap,
  applyPinAttempt,
  applyAccountSuspend,
  applyTransaction,
} from "./merchantDataModel.js";

import {
  evaluateAction,
  scanAllFailures,
  getMerchantSummary,
  scanMerchantBatch,
  MENU_STRUCTURE,
  RULE_METADATA,
} from "./failureRulesEngine.js";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const ALL_ACTION_KEYS = Object.keys(RULE_METADATA);

const SEV = {
  critical: { bd: "#ef4444", bg: "#1a0000", badge: "#ef4444", icon: "🔴", label: "CRITICAL", glow: "rgba(239,68,68,0.3)" },
  high:     { bd: "#f97316", bg: "#1a0900", badge: "#f97316", icon: "🟠", label: "HIGH",     glow: "rgba(249,115,22,0.3)" },
  medium:   { bd: "#eab308", bg: "#1a1500", badge: "#eab308", icon: "🟡", label: "MEDIUM",   glow: "rgba(234,179,8,0.2)"  },
  low:      { bd: "#60a5fa", bg: "#001029", badge: "#60a5fa", icon: "🔵", label: "LOW",      glow: "rgba(96,165,250,0.2)" },
};

const DEMAND_DATA = [
  { month: "Oct-25", data: { "Settlement of Funds": 5570, "PIN/PUK Request": 3606, "SIM Swap": 3223, "Suspended/Frozen Account": 3340, "Statement Request": 3158, "Start Key Reset": 3036, "Change of KYC Details": 2555, "Failed/Delayed Notifications": 1608, "General Balance Enquiries": 1478, "G2 Dormant Operator": 1451, "Pin Unlock": 1089, "Application Request": 1185 }},
  { month: "Nov-25", data: { "Settlement of Funds": 4818, "PIN/PUK Request": 3724, "SIM Swap": 3695, "Suspended/Frozen Account": 3160, "Statement Request": 2690, "Start Key Reset": 3124, "Change of KYC Details": 2816, "Failed/Delayed Notifications": 1561, "General Balance Enquiries": 1563, "G2 Dormant Operator": 1263, "Pin Unlock": 1260, "Application Request": 1243 }},
  { month: "Dec-25", data: { "Settlement of Funds": 3756, "PIN/PUK Request": 4023, "SIM Swap": 3158, "Suspended/Frozen Account": 3451, "Statement Request": 2482, "Start Key Reset": 3143, "Change of KYC Details": 2786, "Failed/Delayed Notifications": 1844, "General Balance Enquiries": 1398, "G2 Dormant Operator": 1064, "Pin Unlock": 1439, "Application Request": 1055 }},
];

const ACTION_TO_DEMAND_KEY = {
  SETTLE_FUNDS: "Settlement of Funds",
  PIN_PUK: "PIN/PUK Request",
  SIM_SWAP: "SIM Swap",
  ACCOUNT_STATUS: "Suspended/Frozen Account",
  STATEMENT: "Statement Request",
  START_KEY: "Start Key Reset",
  KYC_CHANGE: "Change of KYC Details",
  NOTIFICATIONS: "Failed/Delayed Notifications",
  BALANCE: "General Balance Enquiries",
  DORMANT_OP: "G2 Dormant Operator",
  PIN_UNLOCK: "Pin Unlock",
  APPLICATION: "Application Request",
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function ts() { return new Date().toLocaleTimeString("en-KE", { hour12: false }); }
function uid() { return Math.random().toString(36).slice(2, 8); }

function getTwinOutput(merchant, actionKey, result) {
  const meta = RULE_METADATA[actionKey];
  const demandKey = ACTION_TO_DEMAND_KEY[actionKey];
  const totalDemand = DEMAND_DATA.reduce((s, m) => s + (m.data[demandKey] || 0), 0);
  const tier = getRiskTier(merchant);

  if (result.success === true) {
    return {
      type: "success",
      proactive: null,
      diagnostic: `Action completed successfully via ${meta.menu_path}. No failures detected for this merchant state.`,
      intervention: null,
      escalation: false,
    };
  }

  const sev = result.severity;
  const interventions = {
    critical: [
      `🚨 Immediate outreach required to ${merchant.first_name} ${merchant.last_name} (${merchant.phone_number})`,
      `Assign dedicated case manager for paybill ${merchant.paybill}`,
      `Trigger automated SMS to merchant with fix instructions`,
      `Flag account for same-day resolution SLA`,
    ],
    high: [
      `📞 Schedule proactive call to ${merchant.first_name} ${merchant.last_name} within 24hrs`,
      `Send guided fix SMS to ${merchant.phone_number}`,
      `Add to priority queue in CRM for paybill ${merchant.paybill}`,
    ],
    medium: [
      `💬 Send automated in-app notification with self-service fix steps`,
      `Queue for outreach if unresolved within 48hrs`,
    ],
    low: [
      `📧 Include in next weekly merchant health digest email`,
      `Enable contextual help banner in merchant app`,
    ],
  };

  return {
    type: "failure",
    proactive: {
      detected_at: ts(),
      action: meta.label,
      merchant: `${merchant.business_name} (${merchant.paybill})`,
      code: result.code,
      severity: sev,
      message: result.inline,
      calls_prevented: Math.round(totalDemand / 30), // daily estimate
    },
    diagnostic: {
      root_cause: result.reason,
      contributing_sensors: getSensorHealth(merchant).red.concat(getSensorHealth(merchant).amber),
      fix: result.fix,
      demand_context: `${totalDemand.toLocaleString()} calls to contact center for "${demandKey}" (Oct–Dec 2025)`,
      ussd_path: meta.ussd_path,
    },
    intervention: interventions[sev] || interventions.low,
    escalation: sev === "critical" || (sev === "high" && tier === "CRITICAL"),
    escalation_channel: result.escalation,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TWIN LOOP VISUALISER
// ─────────────────────────────────────────────────────────────────────────────
function TwinLoopVisualiser({ loopState, lastEvent }) {
  const steps = [
    { key: "mirror",    label: "Mirror",    icon: "📡", desc: "Replicate physical merchant state into twin" },
    { key: "analyze",   label: "Analyze",   icon: "🧠", desc: "Apply 12 failure rules against sensor data" },
    { key: "update",    label: "Update",    icon: "🔄", desc: "Sync twin state with evaluation results" },
    { key: "summarize", label: "Summarize", icon: "💡", desc: "Emit insight, alert, and intervention output" },
  ];

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 14, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 12 }}>
        ⚙️ TWIN LOOP — CONTINUOUS CYCLE
      </div>

      {/* Steps */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
        {steps.map((step, i) => {
          const active = loopState[step.key];
          return (
            <div key={step.key} style={{ flex: 1, display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{
                flex: 1, background: active ? "linear-gradient(135deg,#00a651,#006b35)" : "#161b22",
                border: `1px solid ${active ? "#00a651" : "#21262d"}`,
                borderRadius: 8, padding: "10px 8px", textAlign: "center",
                boxShadow: active ? "0 0 16px rgba(0,166,81,0.5)" : "none",
                transition: "all 0.3s",
              }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{step.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: active ? "white" : "white" }}>{step.label}</div>
                <div style={{ fontSize: 10, color: active ? "rgba(255,255,255,0.7)" : "white", marginTop: 2, lineHeight: 1.3 }}>{step.desc}</div>
              </div>
              {i < steps.length - 1 && (
                <div style={{ color: active ? "#00a651" : "#ffffff", fontSize: 14, transition: "color 0.3s" }}>→</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Last event trace */}
      {lastEvent && (
        <div style={{ background: "#080b10", borderRadius: 7, padding: "8px 10px", border: "1px solid #1e2730" }}>
          <div style={{ fontSize: 10, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 5 }}>LAST REASONING TRACE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div>
              <div style={{ fontSize: 10, color: "#374151", marginBottom: 2 }}>MERCHANT</div>
              <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>{lastEvent.merchantName}</div>
              <div style={{ fontSize: 10, color: "white" }}>{lastEvent.phone}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#374151", marginBottom: 2 }}>ACTION EVALUATED</div>
              <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>{lastEvent.actionLabel}</div>
              <div style={{ fontSize: 10, color: "white" }}>{lastEvent.ussdPath}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#374151", marginBottom: 2 }}>RESULT</div>
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <span style={{ fontSize: 14 }}>{lastEvent.success ? "✅" : "❌"}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: lastEvent.success ? "#4ade80" : SEV[lastEvent.severity]?.badge }}>
                  {lastEvent.success ? "PASS" : lastEvent.code}
                </span>
                {lastEvent.severity && (
                  <span style={{ fontSize: 10, background: SEV[lastEvent.severity]?.badge + "22", color: SEV[lastEvent.severity]?.badge, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>
                    {SEV[lastEvent.severity]?.label}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#374151", marginBottom: 2 }}>TIMESTAMP</div>
              <div style={{ fontSize: 14, color: "#e2e8f0", fontFamily: "monospace" }}>{lastEvent.timestamp}</div>
            </div>
          </div>
          {!lastEvent.success && lastEvent.reason && (
            <div style={{ marginTop: 6, fontSize: 10, color: "#6b7280", borderTop: "1px solid #1e2730", paddingTop: 5, lineHeight: 1.5 }}>
              <span style={{ color: "#374151" }}>Root cause: </span>{lastEvent.reason}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FLEET OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
function FleetOverview({ merchants, onSelectMerchant, selectedId }) {
  const batchResult = scanMerchantBatch(merchants);
  const { fleet } = batchResult;

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 14, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
        🏪 FLEET OVERVIEW — {merchants.length} MERCHANTS
      </div>

      {/* Fleet KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 12 }}>
        {[
          { label: "Healthy", value: fleet.healthyMerchants, color: "#4ade80", bg: "rgba(74,222,128,0.08)" },
          { label: "With Failures", value: fleet.merchantsWithAnyFailure, color: "#f97316", bg: "rgba(249,115,22,0.08)" },
          { label: "Critical", value: fleet.merchantsWithCritical, color: "#ef4444", bg: "rgba(239,68,68,0.08)" },
          { label: "Calls at Risk", value: fleet.totalCallsAtRisk.toLocaleString(), color: "#eab308", bg: "rgba(234,179,8,0.08)" },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: kpi.bg, border: `1px solid ${kpi.color}22`, borderRadius: 7, padding: "8px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: 10, color: "white", marginTop: 2 }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Merchant rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
        {batchResult.merchantResults.map(({ merchant, summary }) => {
          const tier = getRiskTier(merchant);
          const ts = RISK_TIER_STYLE[tier];
          const isSelected = merchant.id === selectedId;
          const { green, amber, red } = getSensorHealth(merchant);
          const total = green.length + amber.length + red.length;

          return (
            <button key={merchant.id} onClick={() => onSelectMerchant(merchant)}
              style={{
                background: isSelected ? "rgba(0,166,81,0.08)" : "rgba(255,255,255,0.02)",
                border: isSelected ? "1px solid rgba(0,166,81,0.4)" : `1px solid ${ts.bd}22`,
                borderRadius: 7, padding: "8px 10px", cursor: "pointer", textAlign: "left",
                transition: "all 0.15s",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 15 }}>{merchant.avatar}</span>
                  <div>
                    <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600 }}>{merchant.business_name}</div>
                    <div style={{ color: "white", fontSize: 10 }}>PB {merchant.paybill} · {merchant.phone_number}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {summary.bySeverity.critical > 0 && (
                    <span style={{ fontSize: 10, background: "#ef444422", color: "#ef4444", padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>🔴 {summary.bySeverity.critical}</span>
                  )}
                  {summary.bySeverity.high > 0 && (
                    <span style={{ fontSize: 10, background: "#f9731622", color: "#f97316", padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>🟠 {summary.bySeverity.high}</span>
                  )}
                  <span style={{ fontSize: 10, fontWeight: 700, color: ts.color }}>{tier}</span>
                  <span style={{ fontSize: 10, color: "white" }}>{summary.passing}/{summary.total} ✓</span>
                </div>
              </div>
              {/* Health bar */}
              <div style={{ display: "flex", gap: 1, height: 3, borderRadius: 2, overflow: "hidden", marginTop: 5 }}>
                <div style={{ flex: green.length, background: "#4ade80", minWidth: green.length > 0 ? 2 : 0 }} />
                <div style={{ flex: amber.length, background: "#fbbf24", minWidth: amber.length > 0 ? 2 : 0 }} />
                <div style={{ flex: red.length, background: "#f87171", minWidth: red.length > 0 ? 2 : 0 }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-FAILURE ALERT FEED
// ─────────────────────────────────────────────────────────────────────────────
function AlertFeed({ alerts, onSelectMerchant }) {
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all" ? alerts : alerts.filter(a => a.severity === filter);

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 14, color: "white", fontWeight: 700, letterSpacing: 1 }}>
          🚨 PRE-FAILURE ALERT FEED — {alerts.length} DETECTED
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {["all","critical","high","medium","low"].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              background: filter === f ? (f === "all" ? "#161b22" : SEV[f]?.badge + "22") : "transparent",
              border: `1px solid ${filter === f ? (f === "all" ? "#21262d" : SEV[f]?.badge) : "#21262d"}`,
              color: filter === f ? (f === "all" ? "#e2e8f0" : SEV[f]?.badge) : "white",
              borderRadius: 4, padding: "2px 7px", fontSize: 10, cursor: "pointer", fontWeight: 600,
            }}>{f.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", maxHeight: 380, display: "flex", flexDirection: "column", gap: 5 }}>
        {filtered.length === 0 && (
          <div style={{ color: "#374151", fontSize: 11, textAlign: "center", marginTop: 30 }}>No alerts for this filter</div>
        )}
        {filtered.map((alert, i) => {
          const s = SEV[alert.severity];
          return (
            <div key={i} style={{
              background: s.bg, border: `1px solid ${s.bd}44`,
              borderLeft: `3px solid ${s.bd}`, borderRadius: 6, padding: "9px 10px",
              cursor: "pointer", transition: "border-color 0.15s",
            }} onClick={() => onSelectMerchant(alert.merchant)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 13 }}>{alert.merchant.avatar}</span>
                  <div>
                    <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600 }}>{alert.merchant.business_name}</div>
                    <div style={{ color: "white", fontSize: 10 }}>PB {alert.merchant.paybill}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 10, background: s.badge + "22", color: s.badge, padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>{s.icon} {s.label}</span>
                  <div style={{ fontSize: 7, color: "white", fontFamily: "monospace", marginTop: 2 }}>[{alert.code}]</div>
                </div>
              </div>
              <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 3 }}>
                <span style={{ color: "#6b7280" }}>Action: </span>{alert.actionLabel}
              </div>
              <div style={{ fontSize: 9, color: "#cbd5e1", lineHeight: 1.4, marginBottom: 4 }}>{alert.inline}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <span style={{ fontSize: 7, color: "#374151" }}>💡 {alert.fix?.slice(0, 60)}...</span>
              </div>
              {(alert.severity === "critical" || alert.severity === "high") && (
                <div style={{ marginTop: 5, fontSize: 10, color: "#7dd3fc", background: "rgba(99,179,237,0.06)", borderRadius: 4, padding: "3px 7px" }}>
                  🎯 ESCALATION: {alert.escalation}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY LOG
// ─────────────────────────────────────────────────────────────────────────────
function ActivityLog({ events, onSelectMerchant }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events.length]);

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 14, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
        📋 REAL-TIME ACTIVITY LOG — {events.length} EVENTS
      </div>

      <div style={{ flex: 1, overflowY: "auto", maxHeight: 380, display: "flex", flexDirection: "column", gap: 3 }}>
        {events.length === 0 && (
          <div style={{ color: "#374151", fontSize: 11, textAlign: "center", marginTop: 30 }}>
            Start the twin loop or trigger a manual action
          </div>
        )}
        {[...events].reverse().map((ev, i) => {
          const s = ev.severity ? SEV[ev.severity] : null;
          return (
            <div key={ev.id} onClick={() => onSelectMerchant(ev.merchant)}
              style={{
                borderLeft: `3px solid ${s ? s.bd : "#00a651"}`,
                background: "rgba(255,255,255,0.015)", borderRadius: "0 5px 5px 0",
                padding: "5px 8px", cursor: "pointer",
                opacity: i > 30 ? 0.5 : 1,
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  <span style={{ fontSize: 14 }}>{ev.success ? "✅" : ev.success === "warn" ? "⚠️" : "❌"}</span>
                  <span style={{ fontSize: 9, fontWeight: 600, color: s ? s.badge : "#4ade80" }}>
                    {ev.merchant.business_name}
                  </span>
                  <span style={{ fontSize: 10, color: "white" }}>·</span>
                  <span style={{ fontSize: 10, color: "#6b7280" }}>{ev.actionLabel}</span>
                </div>
                <span style={{ fontSize: 10, color: "#374151", fontFamily: "monospace" }}>{ev.timestamp}</span>
              </div>
              {!ev.success && ev.code && (
                <div style={{ fontSize: 7, color: "white", fontFamily: "monospace", marginTop: 1 }}>
                  [{ev.code}] {s && <span style={{ color: s.badge }}>{s.label}</span>}
                  {ev.escalated && <span style={{ marginLeft: 6, color: "#7dd3fc" }}>🎯 ESCALATED</span>}
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMAND HEATMAP
// ─────────────────────────────────────────────────────────────────────────────
function DemandHeatmap({ merchants }) {
  const totals = {};
  DEMAND_DATA.forEach(({ data }) => {
    Object.entries(data).forEach(([k, v]) => { totals[k] = (totals[k] || 0) + v; });
  });
  const maxDemand = Math.max(...Object.values(totals));

  // Failure rate per action key across current merchant fleet
  const failureRates = {};
  ALL_ACTION_KEYS.forEach(key => {
    const fails = merchants.filter(m => !evaluateAction(m, key).success).length;
    failureRates[key] = merchants.length > 0 ? (fails / merchants.length) * 100 : 0;
  });

  const rows = ALL_ACTION_KEYS.map(key => {
    const demandKey = ACTION_TO_DEMAND_KEY[key];
    const demand = totals[demandKey] || 0;
    const failRate = failureRates[key] || 0;
    const riskScore = (demand / maxDemand) * failRate;
    return { key, label: RULE_METADATA[key].label, demand, failRate, riskScore, demandKey };
  }).sort((a, b) => b.riskScore - a.riskScore);

  const maxRisk = Math.max(...rows.map(r => r.riskScore), 1);

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 14, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
        📊 DEMAND × FAILURE RATE HEATMAP
      </div>
      <div style={{ fontSize: 10, color: "#374151", marginBottom: 10 }}>
        Risk Score = (Call center demand / max demand) × Predicted failure rate across fleet · Darker = higher risk
      </div>

      {/* Month bars */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {DEMAND_DATA.map(({ month, data }) => {
          const total = Object.values(data).reduce((a, b) => a + b, 0);
          return (
            <div key={month} style={{ flex: 1, background: "#161b22", borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#00a651" }}>{total.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: "white" }}>{month}</div>
            </div>
          );
        })}
        <div style={{ flex: 1, background: "#161b22", borderRadius: 6, padding: "6px 8px", textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#eab308" }}>{Object.values(totals).reduce((a, b) => a + b, 0).toLocaleString()}</div>
          <div style={{ fontSize: 10, color: "white" }}>Total Q4</div>
        </div>
      </div>

      {/* Heatmap rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {rows.map(row => {
          const intensity = row.riskScore / maxRisk;
          const r = Math.round(239 * intensity);
          const g = Math.round(68 + (166 - 68) * (1 - intensity));
          const b = Math.round(68 * (1 - intensity));
          const cellColor = `rgba(${r},${g},${b},${0.15 + intensity * 0.6})`;

          return (
            <div key={row.key} style={{ display: "grid", gridTemplateColumns: "160px 1fr 60px 60px 70px", gap: 6, alignItems: "center" }}>
              <div style={{ fontSize: 9, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                #{RULE_METADATA[row.key].demand_rank} {row.label}
              </div>
              <div style={{ background: "#161b22", borderRadius: 3, height: 14, overflow: "hidden" }}>
                <div style={{ height: "100%", background: cellColor, width: `${intensity * 100}%`, borderRadius: 3, transition: "width 0.5s" }} />
              </div>
              <div style={{ fontSize: 10, color: "#6b7280", textAlign: "right", fontFamily: "monospace" }}>
                {row.demand.toLocaleString()}
              </div>
              <div style={{ fontSize: 10, textAlign: "right", fontFamily: "monospace", color: row.failRate > 60 ? "#ef4444" : row.failRate > 30 ? "#f97316" : "white" }}>
                {row.failRate.toFixed(0)}% fail
              </div>
              <div style={{ background: cellColor, borderRadius: 4, padding: "2px 5px", textAlign: "center" }}>
                <span style={{ fontSize: 7, fontWeight: 700, color: "white" }}>
                  {intensity > 0.7 ? "🔴 HIGH" : intensity > 0.4 ? "🟡 MED" : "🟢 LOW"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MERCHANT DEEP-DIVE
// ─────────────────────────────────────────────────────────────────────────────
function MerchantDeepDive({ merchant, lastTwinOutput }) {
  const failures = scanAllFailures(merchant);
  const summary = getMerchantSummary(merchant);
  const tier = getRiskTier(merchant);
  const ts = RISK_TIER_STYLE[tier];
  const { red, amber, green, score } = getSensorHealth(merchant);

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 14, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
        🔬 MERCHANT DEEP-DIVE
      </div>

      {/* Merchant header */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, background: "#080b10", borderRadius: 8, padding: "10px 12px" }}>
        <div style={{ fontSize: 28 }}>{merchant.avatar}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{merchant.business_name}</div>
          <div style={{ fontSize: 9, color: "white" }}>{merchant.first_name} {merchant.last_name} · PB {merchant.paybill} · {merchant.phone_number}</div>
          <div style={{ fontSize: 9, color: "white" }}>{merchant.bank} · {merchant.county}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#e2e8f0" }}>{formatKES(merchant.balance)}</div>
          <div style={{ fontSize: 9, color: ts.color, fontWeight: 700, marginBottom: 3 }}>{ts.label}</div>
          <div style={{ fontSize: 10, color: "white" }}>{summary.passing}/{summary.total} actions pass</div>
        </div>
      </div>

      {/* Health score */}
      <div style={{ background: "#080b10", borderRadius: 7, padding: "8px 10px", marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: "white" }}>Sensor Health Score</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: score > 0.7 ? "#4ade80" : score > 0.4 ? "#fbbf24" : "#f87171" }}>
            {Math.round(score * 100)}%
          </span>
        </div>
        <div style={{ display: "flex", gap: 2, height: 6, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ flex: green.length, background: "#4ade80" }} />
          <div style={{ flex: amber.length, background: "#fbbf24" }} />
          <div style={{ flex: red.length, background: "#f87171" }} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <span style={{ fontSize: 7, color: "#4ade80" }}>● {green.length} OK</span>
          <span style={{ fontSize: 7, color: "#fbbf24" }}>● {amber.length} WARN</span>
          <span style={{ fontSize: 7, color: "#f87171" }}>● {red.length} FAIL</span>
        </div>
      </div>

      {/* All 12 rule results */}
      <div style={{ fontSize: 12, color: "#374151", fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 }}>
        ALL 12 RULE EVALUATIONS
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 280, overflowY: "auto" }}>
        {ALL_ACTION_KEYS.map(key => {
          const result = evaluateAction(merchant, key);
          const meta = RULE_METADATA[key];
          const s = !result.success ? SEV[result.severity] : null;
          return (
            <div key={key} style={{
              background: !result.success ? s.bg : "rgba(74,222,128,0.03)",
              border: `1px solid ${!result.success ? s.bd + "44" : "#1e2730"}`,
              borderRadius: 5, padding: "6px 8px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  <span style={{ fontSize: 14 }}>{result.success === true ? "✅" : result.success === "warn" ? "⚠️" : "❌"}</span>
                  <span style={{ fontSize: 9, color: !result.success ? s.badge : "#4ade80", fontWeight: 600 }}>
                    #{meta.demand_rank} {meta.label}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {!result.success && s && (
                    <span style={{ fontSize: 7, background: s.badge + "22", color: s.badge, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>{s.label}</span>
                  )}
                  {result.code && result.code !== "OK" && (
                    <span style={{ fontSize: 7, color: "#374151", fontFamily: "monospace" }}>[{result.code}]</span>
                  )}
                </div>
              </div>
              {!result.success && (
                <div style={{ fontSize: 10, color: "#6b7280", marginTop: 3, lineHeight: 1.4 }}>{result.inline}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Twin output for last event */}
      {lastTwinOutput && lastTwinOutput.type === "failure" && (
        <div style={{ marginTop: 10, borderTop: "1px solid #1e2730", paddingTop: 10 }}>
          <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 }}>
            🤖 TWIN OUTPUT — LAST EVALUATED ACTION
          </div>

          {/* Intervention */}
          <div style={{ background: "rgba(234,179,8,0.05)", border: "1px solid rgba(234,179,8,0.15)", borderRadius: 6, padding: "8px 10px", marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: "#eab308", fontWeight: 700, letterSpacing: 1, marginBottom: 5 }}>INTERVENTION RECOMMENDATIONS</div>
            {lastTwinOutput.intervention.map((rec, i) => (
              <div key={i} style={{ fontSize: 9, color: "#cbd5e1", marginBottom: 3, lineHeight: 1.4 }}>• {rec}</div>
            ))}
          </div>

          {/* Diagnostic */}
          <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "8px 10px", marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>DIAGNOSTIC REPLAY</div>
            <div style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.4, marginBottom: 3 }}>
              <span style={{ color: "white" }}>Root cause: </span>{lastTwinOutput.diagnostic.root_cause}
            </div>
            <div style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.4, marginBottom: 3 }}>
              <span style={{ color: "white" }}>Sensors affected: </span>
              {lastTwinOutput.diagnostic.contributing_sensors.join(", ") || "None"}
            </div>
            <div style={{ fontSize: 9, color: "#7dd3fc", lineHeight: 1.4 }}>
              <span style={{ color: "white" }}>Demand context: </span>{lastTwinOutput.diagnostic.demand_context}
            </div>
          </div>

          {/* Escalation */}
          {lastTwinOutput.escalation && (
            <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "#ef4444", fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>🎯 ESCALATION TRIGGERED</div>
              <div style={{ fontSize: 9, color: "#fca5a5" }}>{lastTwinOutput.escalation_channel}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL TRIGGER PANEL
// ─────────────────────────────────────────────────────────────────────────────
function ManualTrigger({ merchants, onFire }) {
  const [selMerchant, setSelMerchant] = useState(merchants[0]?.id || "");
  const [selAction, setSelAction] = useState(ALL_ACTION_KEYS[0]);

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 14, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
        🎮 MANUAL TRIGGER
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select value={selMerchant} onChange={e => setSelMerchant(e.target.value)}
          style={{ flex: 2, background: "#161b22", border: "1px solid #21262d", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 14, outline: "none" }}>
          {merchants.map(m => (
            <option key={m.id} value={m.id}>{m.business_name} ({m.paybill})</option>
          ))}
        </select>
        <select value={selAction} onChange={e => setSelAction(e.target.value)}
          style={{ flex: 2, background: "#161b22", border: "1px solid #21262d", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 14, outline: "none" }}>
          {ALL_ACTION_KEYS.map(key => (
            <option key={key} value={key}>#{RULE_METADATA[key].demand_rank} {RULE_METADATA[key].label}</option>
          ))}
        </select>
        <button onClick={() => {
          const merchant = merchants.find(m => m.id === selMerchant);
          if (merchant) onFire(merchant, selAction);
        }} style={{
          background: "#00a651", color: "white", border: "none",
          borderRadius: 6, padding: "7px 16px", fontWeight: 700, fontSize: 11, cursor: "pointer",
        }}>▶ Fire</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT — TWIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
export default function TwinDashboard() {
  const [merchants, setMerchants] = useState([...MERCHANT_REGISTRY]);
  const [selectedMerchant, setSelectedMerchant] = useState(MERCHANT_REGISTRY[0]);
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [autoRunning, setAutoRunning] = useState(false);
  const [loopState, setLoopState] = useState({ mirror: false, analyze: false, update: false, summarize: false });
  const [lastEvent, setLastEvent] = useState(null);
  const [lastTwinOutput, setLastTwinOutput] = useState(null);
  const [twinStats, setTwinStats] = useState({ total: 0, failures: 0, escalations: 0, callsPrevented: 0 });
  const [generatedCount, setGeneratedCount] = useState(0);
  const autoRef = useRef(null);

  // Pre-scan all merchants for alert feed on load + merchant change
  useEffect(() => {
    const allAlerts = [];
    merchants.forEach(merchant => {
      const failures = scanAllFailures(merchant);
      failures.forEach(f => {
        allAlerts.push({ ...f, merchant });
      });
    });
    allAlerts.sort((a, b) => {
      const sevRank = { critical: 4, high: 3, medium: 2, low: 1 };
      return (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
    });
    setAlerts(allAlerts);
  }, [merchants]);

  // Fire one twin cycle
  const fireCycle = useCallback((merchant, actionKey) => {
    const meta = RULE_METADATA[actionKey];
    const result = evaluateAction(merchant, actionKey);
    const output = getTwinOutput(merchant, actionKey, result);

    // Animate twin loop
    setLoopState({ mirror: true, analyze: false, update: false, summarize: false });
    setTimeout(() => setLoopState({ mirror: true, analyze: true, update: false, summarize: false }), 250);
    setTimeout(() => setLoopState({ mirror: true, analyze: true, update: true, summarize: false }), 500);
    setTimeout(() => setLoopState({ mirror: true, analyze: true, update: true, summarize: true }), 750);
    setTimeout(() => setLoopState({ mirror: false, analyze: false, update: false, summarize: false }), 1400);

    const ev = {
      id: uid(),
      merchant,
      merchantName: merchant.business_name,
      phone: merchant.phone_number,
      actionKey,
      actionLabel: meta.label,
      ussdPath: meta.ussd_path,
      success: result.success,
      code: result.code,
      severity: result.severity,
      reason: result.reason,
      escalated: output.escalation,
      timestamp: ts(),
    };

    setLastEvent(ev);
    setLastTwinOutput(output);
    setSelectedMerchant(merchant);
    setEvents(prev => [...prev, ev].slice(-200));
    setTwinStats(prev => ({
      total: prev.total + 1,
      failures: prev.failures + (!result.success ? 1 : 0),
      escalations: prev.escalations + (output.escalation ? 1 : 0),
      callsPrevented: prev.callsPrevented + (output.proactive?.calls_prevented || 0),
    }));
  }, []);

  // Auto simulation
  useEffect(() => {
    if (autoRunning) {
      autoRef.current = setInterval(() => {
        const merchant = merchants[Math.floor(Math.random() * merchants.length)];
        const action = ALL_ACTION_KEYS[Math.floor(Math.random() * ALL_ACTION_KEYS.length)];
        fireCycle(merchant, action);
      }, 1600);
    } else {
      clearInterval(autoRef.current);
    }
    return () => clearInterval(autoRef.current);
  }, [autoRunning, merchants, fireCycle]);

  const addGenerated = (n) => {
    const batch = generateMerchantBatch(n);
    setMerchants(prev => [...prev, ...batch]);
    setGeneratedCount(c => c + n);
  };

  const resetMerchants = () => {
    setMerchants([...MERCHANT_REGISTRY]);
    setGeneratedCount(0);
    setSelectedMerchant(MERCHANT_REGISTRY[0]);
  };

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif", background: "#060a0f", color: "#e2e8f0", minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* ── HEADER */}
      <div style={{ background: "#080b10", borderBottom: "1px solid #1e2730", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ background: "linear-gradient(135deg,#00a651,#005520)", borderRadius: 8, padding: "7px 10px", fontSize: 15 }}>🔁</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>
              Merchant Digital Twin
              <span style={{ color: "#374151", fontWeight: 400 }}> · </span>
              <span style={{ color: "#00a651" }}>Step 4: Twin Loop Dashboard</span>
            </div>
            <div style={{ fontSize: 12, color: "#374151" }}>
              Mirror → Analyze → Update → Summarize · {merchants.length} merchants · {events.length} events · {alerts.length} pre-failure alerts
            </div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* KPI bar */}
          {[
            { label: "Cycles", value: twinStats.total, color: "#6b7280" },
            { label: "Failures", value: twinStats.failures, color: "#f97316" },
            { label: "Escalations", value: twinStats.escalations, color: "#ef4444" },
            { label: "Calls Prevented", value: twinStats.callsPrevented.toLocaleString(), color: "#4ade80" },
          ].map(k => (
            <div key={k.label} style={{ textAlign: "center", background: "#161b22", borderRadius: 6, padding: "4px 10px" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: k.color }}>{k.value}</div>
              <div style={{ fontSize: 7, color: "#374151" }}>{k.label}</div>
            </div>
          ))}

          <button onClick={() => setAutoRunning(p => !p)} style={{
            background: autoRunning ? "#ef4444" : "#00a651",
            color: "white", border: "none", borderRadius: 7,
            padding: "7px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer",
            boxShadow: autoRunning ? "0 0 12px rgba(239,68,68,0.4)" : "0 0 12px rgba(0,166,81,0.4)",
          }}>
            {autoRunning ? "⏹ Pause" : "▶ Auto Run"}
          </button>

          <button onClick={() => addGenerated(5)} style={{ background: "#161b22", color: "#e2e8f0", border: "1px solid #21262d", borderRadius: 7, padding: "7px 12px", fontSize: 11, cursor: "pointer" }}>
            + 5 Merchants
          </button>
          <button onClick={resetMerchants} style={{ background: "#161b22", color: "#6b7280", border: "1px solid #21262d", borderRadius: 7, padding: "7px 12px", fontSize: 11, cursor: "pointer" }}>
            Reset
          </button>
          <button onClick={() => setEvents([])} style={{ background: "#161b22", color: "#6b7280", border: "1px solid #21262d", borderRadius: 7, padding: "7px 12px", fontSize: 11, cursor: "pointer" }}>
            Clear Log
          </button>
        </div>
      </div>

      {/* ── ARCHITECTURE BREADCRUMB */}
      <div style={{ background: "#0a0e14", borderBottom: "1px solid #1e2730", padding: "5px 20px", display: "flex", gap: 16, alignItems: "center" }}>
        {[
          { step: "Step 1", file: "merchantDataModel.js", done: true },
          { step: "Step 2", file: "failureRulesEngine.js", done: true },
          { step: "Step 3", file: "merchantSimulator.jsx", done: true },
          { step: "Step 4", file: "twinDashboard.jsx", current: true },
        ].map((s, i) => (
          <div key={s.step} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <span style={{ color: "#1e2730", fontSize: 14 }}>→</span>}
            <div style={{
              background: s.current ? "rgba(0,166,81,0.12)" : "transparent",
              border: s.current ? "1px solid rgba(0,166,81,0.3)" : "1px solid transparent",
              borderRadius: 5, padding: "2px 8px",
            }}>
              <span style={{ fontSize: 10, color: s.current ? "#00a651" : "#374151", fontWeight: 700 }}>{s.step} {s.done && !s.current ? "✓" : s.current ? "← CURRENT" : ""}</span>
              <span style={{ fontSize: 7, color: "#1e2730", marginLeft: 5 }}>{s.file}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── MAIN GRID */}
      <div style={{ flex: 1, padding: 14, display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "auto auto auto auto", overflowY: "auto" }}>

        {/* Row 1: Twin loop + Manual trigger (span 2) + Fleet KPI (span 1) */}
        <div style={{ gridColumn: "1 / 3" }}>
          <TwinLoopVisualiser loopState={loopState} lastEvent={lastEvent} />
        </div>

        <div style={{ gridColumn: "3 / 4", display: "flex", flexDirection: "column", gap: 12 }}>
          <ManualTrigger merchants={merchants} onFire={fireCycle} />

          {/* Quick sensor read of selected merchant */}
          <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 12, flex: 1 }}>
            <div style={{ fontSize: 9, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
              📡 SELECTED MERCHANT SENSORS
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>{selectedMerchant.avatar}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{selectedMerchant.business_name}</div>
                <div style={{ fontSize: 10, color: "white" }}>PB {selectedMerchant.paybill}</div>
              </div>
              <div style={{ marginLeft: "auto" }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: RISK_TIER_STYLE[getRiskTier(selectedMerchant)].color }}>
                  {RISK_TIER_STYLE[getRiskTier(selectedMerchant)].label}
                </span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
              {[
                ["Account", selectedMerchant.account_status, selectedMerchant.account_status === "active"],
                ["KYC", selectedMerchant.kyc_status, selectedMerchant.kyc_status === "verified"],
                ["PIN", selectedMerchant.pin_locked ? "LOCKED" : "OK", !selectedMerchant.pin_locked],
                ["SIM", selectedMerchant.sim_status, selectedMerchant.sim_status === "active"],
                ["Start Key", selectedMerchant.start_key_status, selectedMerchant.start_key_status === "valid"],
                ["Notif.", selectedMerchant.notifications_enabled ? "ON" : "OFF", selectedMerchant.notifications_enabled],
                ["Settle", selectedMerchant.settlement_on_hold ? "ON HOLD" : "CLEAR", !selectedMerchant.settlement_on_hold],
                ["Dormant", `${selectedMerchant.dormant_days}d`, selectedMerchant.dormant_days < 30],
              ].map(([k, v, ok]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", background: "#080b10", borderRadius: 4, padding: "3px 6px" }}>
                  <span style={{ fontSize: 10, color: "white" }}>{k}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: ok ? "#4ade80" : "#f87171", textTransform: "uppercase" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2: Fleet Overview + Alert Feed */}
        <div style={{ gridColumn: "1 / 2" }}>
          <FleetOverview merchants={merchants} onSelectMerchant={setSelectedMerchant} selectedId={selectedMerchant.id} />
        </div>
        <div style={{ gridColumn: "2 / 3" }}>
          <AlertFeed alerts={alerts} onSelectMerchant={setSelectedMerchant} />
        </div>
        <div style={{ gridColumn: "3 / 4" }}>
          <ActivityLog events={events} onSelectMerchant={setSelectedMerchant} />
        </div>

        {/* Row 3: Demand heatmap (span 2) + Deep dive (span 1) */}
        <div style={{ gridColumn: "1 / 3" }}>
          <DemandHeatmap merchants={merchants} />
        </div>
        <div style={{ gridColumn: "3 / 4" }}>
          <MerchantDeepDive merchant={selectedMerchant} lastTwinOutput={lastTwinOutput} />
        </div>

      </div>

      {/* ── FOOTER */}
      <div style={{ background: "#080b10", borderTop: "1px solid #1e2730", padding: "5px 20px", display: "flex", justifyContent: "space-between", fontSize: 9, color: "#1e2730" }}>
        <span>Step 4 / 4 — Digital Twin complete: Data Model → Rules Engine → Simulator → Twin Loop Dashboard</span>
        <span>{new Date().toLocaleString("en-KE")}</span>
      </div>
    </div>
  );
}
