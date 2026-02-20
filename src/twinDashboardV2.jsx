// ═══════════════════════════════════════════════════════════════════════════
// TWIN DASHBOARD V2  —  Step 4 with Claude AI Reasoning
// Safaricom LNM Merchant Digital Twin
//
// New in V2 vs V1:
//   • AI Deep-Dive     — Claude analyzes compound failures in real language
//   • SMS Generator    — Claude drafts English + Kiswahili intervention SMS
//   • Agent Briefing   — Claude writes CRM briefing note per merchant
//   • Fleet Insight    — Claude summarizes entire fleet with strategic recs
//   • Anomaly Detector — Z-score spike detection on live event stream
//   • Failure Predictor— 0-100 contact probability score per merchant
//
// Imports:
//   Step 1 → merchantDataModel.js
//   Step 2 → failureRulesEngine.js
//   AI     → aiReasoningEngine.jsx
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";

import {
  MERCHANT_REGISTRY, generateMerchantBatch,
  getRiskTier, RISK_TIER_STYLE, getSensorHealth, formatKES,
} from "./merchantDataModel";

import {
  evaluateAction, scanAllFailures, getMerchantSummary,
  scanMerchantBatch, RULE_METADATA,
} from "./failureRulesEngine";

import {
  analyzeWithClaude,
  generateInterventionSMS,
  generateAgentBriefing,
  generateFleetInsight,
  detectAnomalies,
  predictContactProbability
} from "./aiReasoningEngine";


// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const ALL_ACTION_KEYS = Object.keys(RULE_METADATA);

const SEV = {
  critical: { bd: "#ef4444", bg: "#1a0000", badge: "#ef4444", icon: "🔴", label: "CRITICAL", glow: "rgba(239,68,68,0.35)" },
  high:     { bd: "#f97316", bg: "#1a0900", badge: "#f97316", icon: "🟠", label: "HIGH",     glow: "rgba(249,115,22,0.25)" },
  medium:   { bd: "#eab308", bg: "#1a1500", badge: "#eab308", icon: "🟡", label: "MEDIUM",   glow: "rgba(234,179,8,0.2)"  },
  low:      { bd: "#60a5fa", bg: "#001029", badge: "#60a5fa", icon: "🔵", label: "LOW",      glow: "rgba(96,165,250,0.15)" },
};

const DEMAND_DATA = [
  { month: "Oct-25", data: { "Settlement of Funds": 5570, "PIN/PUK Request": 3606, "SIM Swap": 3223, "Suspended/Frozen Account": 3340, "Statement Request": 3158, "Start Key Reset": 3036, "Change of KYC Details": 2555, "Failed/Delayed Notifications": 1608, "General Balance Enquiries": 1478, "G2 Dormant Operator": 1451, "Pin Unlock": 1089, "Application Request": 1185 }},
  { month: "Nov-25", data: { "Settlement of Funds": 4818, "PIN/PUK Request": 3724, "SIM Swap": 3695, "Suspended/Frozen Account": 3160, "Statement Request": 2690, "Start Key Reset": 3124, "Change of KYC Details": 2816, "Failed/Delayed Notifications": 1561, "General Balance Enquiries": 1563, "G2 Dormant Operator": 1263, "Pin Unlock": 1260, "Application Request": 1243 }},
  { month: "Dec-25", data: { "Settlement of Funds": 3756, "PIN/PUK Request": 4023, "SIM Swap": 3158, "Suspended/Frozen Account": 3451, "Statement Request": 2482, "Start Key Reset": 3143, "Change of KYC Details": 2786, "Failed/Delayed Notifications": 1844, "General Balance Enquiries": 1398, "G2 Dormant Operator": 1064, "Pin Unlock": 1439, "Application Request": 1055 }},
];

const ACTION_TO_DEMAND_KEY = {
  SETTLE_FUNDS: "Settlement of Funds", PIN_PUK: "PIN/PUK Request",
  SIM_SWAP: "SIM Swap", ACCOUNT_STATUS: "Suspended/Frozen Account",
  STATEMENT: "Statement Request", START_KEY: "Start Key Reset",
  KYC_CHANGE: "Change of KYC Details", NOTIFICATIONS: "Failed/Delayed Notifications",
  BALANCE: "General Balance Enquiries", DORMANT_OP: "G2 Dormant Operator",
  PIN_UNLOCK: "Pin Unlock", APPLICATION: "Application Request",
};

function ts() { return new Date().toLocaleTimeString("en-KE", { hour12: false }); }
function uid() { return Math.random().toString(36).slice(2, 8); }

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UI ATOMS
// ─────────────────────────────────────────────────────────────────────────────
function Spinner({ size = 16, color = "#00a651" }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: `2px solid ${color}33`,
      borderTop: `2px solid ${color}`,
      animation: "spin 0.7s linear infinite",
      display: "inline-block",
    }} />
  );
}

function AIBadge() {
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
      background: "linear-gradient(90deg,#6366f1,#8b5cf6)",
      color: "white", padding: "2px 7px", borderRadius: 4,
    }}>✦ AI</span>
  );
}

function SectionHeader({ icon, title, badge, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11 }}>{icon}</span>
        <span style={{ fontSize: 14, color: "white", fontWeight: 700, letterSpacing: 1 }}>{title}</span>
        {badge && badge}
      </div>
      {right && right}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TWIN LOOP VISUALISER
// ─────────────────────────────────────────────────────────────────────────────
function TwinLoopVisualiser({ loopState, lastEvent, anomalies }) {
  const steps = [
    { key: "mirror",    icon: "📡", label: "Mirror",    desc: "Read physical sensor state into twin" },
    { key: "analyze",   icon: "🧠", label: "Analyze",   desc: "Apply 12 rules + AI reasoning" },
    { key: "update",    icon: "🔄", label: "Update",    desc: "Sync twin with evaluation results" },
    { key: "summarize", icon: "💡", label: "Summarize", desc: "Emit alert, insight, intervention" },
  ];

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14 }}>
      <SectionHeader icon="⚙️" title="TWIN LOOP — CONTINUOUS AUTONOMOUS CYCLE" />

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
        {steps.map((step, i) => {
          const active = loopState[step.key];
          return (
            <div key={step.key} style={{ flex: 1, display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{
                flex: 1, textAlign: "center", padding: "10px 6px", borderRadius: 8,
                background: active ? "linear-gradient(135deg,#00a651,#006b35)" : "#161b22",
                border: `1px solid ${active ? "#00a651" : "#21262d"}`,
                boxShadow: active ? "0 0 18px rgba(0,166,81,0.5)" : "none",
                transition: "all 0.3s",
              }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{step.icon}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: active ? "white" : "white" }}>{step.label}</div>
                <div style={{ fontSize: 7, color: active ? "rgba(255,255,255,0.65)" : "#374151", marginTop: 2, lineHeight: 1.3 }}>{step.desc}</div>
              </div>
              {i < steps.length - 1 && (
                <div style={{ color: loopState[step.key] ? "#00a651" : "#21262d", fontSize: 14, transition: "color 0.3s" }}>→</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Anomaly alert */}
      {anomalies.length > 0 && (
        <div style={{ background: "#1a0000", border: "1px solid #ef444455", borderRadius: 6, padding: "7px 10px", marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#ef4444", fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>⚡ ANOMALY DETECTED</div>
          {anomalies.map((a, i) => (
            <div key={i} style={{ fontSize: 9, color: "#fca5a5" }}>{a.message} (Z={a.zScore})</div>
          ))}
        </div>
      )}

      {/* Last reasoning trace */}
      {lastEvent && (
        <div style={{ background: "#080b10", borderRadius: 7, padding: "8px 10px", border: "1px solid #1e2730" }}>
          <div style={{ fontSize: 10, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>LAST REASONING TRACE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div>
              <div style={{ fontSize: 7, color: "#374151", marginBottom: 2 }}>MERCHANT</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{lastEvent.merchantName}</div>
              <div style={{ fontSize: 10, color: "white" }}>{lastEvent.phone}</div>
            </div>
            <div>
              <div style={{ fontSize: 7, color: "#374151", marginBottom: 2 }}>ACTION EVALUATED</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{lastEvent.actionLabel}</div>
              <div style={{ fontSize: 7, color: "white", fontFamily: "monospace" }}>{lastEvent.ussdPath}</div>
            </div>
            <div>
              <div style={{ fontSize: 7, color: "#374151", marginBottom: 2 }}>RESULT</div>
              <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 14 }}>{lastEvent.success ? "✅" : "❌"}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: lastEvent.success ? "#4ade80" : SEV[lastEvent.severity]?.badge }}>
                  {lastEvent.success ? "PASS" : lastEvent.code}
                </span>
                {lastEvent.severity && (
                  <span style={{ fontSize: 7, background: SEV[lastEvent.severity]?.badge + "22", color: SEV[lastEvent.severity]?.badge, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>
                    {SEV[lastEvent.severity]?.label}
                  </span>
                )}
                {lastEvent.aiAnalyzed && <AIBadge />}
                {lastEvent.escalated && <span style={{ fontSize: 10, color: "#7dd3fc" }}>🎯 ESCALATED</span>}
              </div>
            </div>
          </div>
          {lastEvent.aiSummary && (
            <div style={{ marginTop: 6, fontSize: 10, color: "#94a3b8", borderTop: "1px solid #1e2730", paddingTop: 5, lineHeight: 1.5, fontStyle: "italic" }}>
              ✦ AI: {lastEvent.aiSummary}
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
      <SectionHeader icon="🏪" title={`FLEET OVERVIEW — ${merchants.length} MERCHANTS`} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 10 }}>
        {[
          { label: "Healthy", value: fleet.healthyMerchants, color: "#4ade80" },
          { label: "Failing", value: fleet.merchantsWithAnyFailure, color: "#f97316" },
          { label: "Critical", value: fleet.merchantsWithCritical, color: "#ef4444" },
          { label: "Calls at Risk", value: fleet.totalCallsAtRisk.toLocaleString(), color: "#eab308" },
        ].map(k => (
          <div key={k.label} style={{ background: k.color + "11", border: `1px solid ${k.color}22`, borderRadius: 7, padding: "7px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 7, color: "white", marginTop: 1 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
        {batchResult.merchantResults.map(({ merchant, summary }) => {
          const tier = getRiskTier(merchant);
          const ts = RISK_TIER_STYLE[tier];
          const pred = predictContactProbability(merchant);
          const isSelected = merchant.id === selectedId;
          const { green, amber, red } = getSensorHealth(merchant);

          return (
            <button key={merchant.id} onClick={() => onSelectMerchant(merchant)}
              style={{
                background: isSelected ? "rgba(0,166,81,0.08)" : "rgba(255,255,255,0.02)",
                border: isSelected ? "1px solid rgba(0,166,81,0.4)" : `1px solid ${ts.bd}22`,
                borderRadius: 7, padding: "7px 10px", cursor: "pointer", textAlign: "left",
              }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                  <span style={{ fontSize: 14 }}>{merchant.avatar}</span>
                  <div>
                    <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600 }}>{merchant.business_name}</div>
                    <div style={{ color: "white", fontSize: 7 }}>PB {merchant.paybill} · {merchant.phone_number}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  {/* AI contact prediction score */}
                  <div style={{ textAlign: "center", background: pred.color + "15", borderRadius: 4, padding: "2px 6px" }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: pred.color }}>{pred.score}</div>
                    <div style={{ fontSize: 6, color: pred.color }}>CALL PROB</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: ts.color }}>{tier}</span>
                  <span style={{ fontSize: 7, color: "white" }}>{summary.passing}/{summary.total}✓</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 1, height: 3, borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
                <div style={{ flex: green.length, background: "#4ade80" }} />
                <div style={{ flex: amber.length, background: "#fbbf24" }} />
                <div style={{ flex: red.length, background: "#f87171" }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERT FEED
// ─────────────────────────────────────────────────────────────────────────────
function AlertFeed({ alerts, onSelectMerchant }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? alerts : alerts.filter(a => a.severity === filter);

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column" }}>
      <SectionHeader icon="🚨" title={`PRE-FAILURE ALERTS — ${alerts.length}`}
        right={
          <div style={{ display: "flex", gap: 3 }}>
            {["all","critical","high","medium","low"].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                background: filter === f ? (SEV[f]?.badge || "#374151") + "22" : "transparent",
                border: `1px solid ${filter === f ? (SEV[f]?.badge || "#374151") : "#21262d"}`,
                color: filter === f ? (SEV[f]?.badge || "#e2e8f0") : "white",
                borderRadius: 4, padding: "2px 6px", fontSize: 10, cursor: "pointer", fontWeight: 600,
              }}>{f.toUpperCase()}</button>
            ))}
          </div>
        }
      />

      <div style={{ flex: 1, overflowY: "auto", maxHeight: 340, display: "flex", flexDirection: "column", gap: 5 }}>
        {filtered.map((alert, i) => {
          const s = SEV[alert.severity];
          return (
            <div key={i} onClick={() => onSelectMerchant(alert.merchant)}
              style={{ background: s.bg, border: `1px solid ${s.bd}44`, borderLeft: `3px solid ${s.bd}`, borderRadius: 6, padding: "8px 10px", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 13 }}>{alert.merchant.avatar}</span>
                  <div>
                    <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600 }}>{alert.merchant.business_name}</div>
                    <div style={{ color: "white", fontSize: 7 }}>PB {alert.merchant.paybill}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 7, background: s.badge + "22", color: s.badge, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>{s.icon} {s.label}</span>
                  <div style={{ fontSize: 6, color: "#374151", fontFamily: "monospace", marginTop: 1 }}>[{alert.code}]</div>
                </div>
              </div>
              <div style={{ fontSize: 9, color: "#cbd5e1", lineHeight: 1.4, marginBottom: 3 }}>{alert.inline}</div>
              <div style={{ fontSize: 7, color: "#374151" }}>💡 {alert.fix?.slice(0, 70)}...</div>
              {(alert.severity === "critical" || alert.severity === "high") && (
                <div style={{ marginTop: 4, fontSize: 7, color: "#7dd3fc", background: "rgba(99,179,237,0.06)", borderRadius: 3, padding: "2px 6px" }}>
                  🎯 {alert.escalation}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div style={{ color: "#374151", fontSize: 11, textAlign: "center", padding: 20 }}>No alerts for this filter</div>}
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
      <SectionHeader icon="📋" title={`ACTIVITY LOG — ${events.length} EVENTS`} />

      <div style={{ flex: 1, overflowY: "auto", maxHeight: 340, display: "flex", flexDirection: "column", gap: 2 }}>
        {events.length === 0 && <div style={{ color: "#374151", fontSize: 11, textAlign: "center", marginTop: 30 }}>Start the twin loop or fire a manual action</div>}
        {[...events].reverse().map((ev, i) => {
          const s = ev.severity ? SEV[ev.severity] : null;
          return (
            <div key={ev.id} onClick={() => onSelectMerchant(ev.merchant)}
              style={{ borderLeft: `3px solid ${s ? s.bd : "#00a651"}`, background: "rgba(255,255,255,0.015)", borderRadius: "0 5px 5px 0", padding: "5px 8px", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  <span style={{ fontSize: 14 }}>{ev.success ? "✅" : ev.success === "warn" ? "⚠️" : "❌"}</span>
                  <span style={{ fontSize: 9, fontWeight: 600, color: s ? s.badge : "#4ade80" }}>{ev.merchant.business_name}</span>
                  <span style={{ fontSize: 7, color: "white" }}>·</span>
                  <span style={{ fontSize: 10, color: "#6b7280" }}>{ev.actionLabel}</span>
                  {ev.aiAnalyzed && <AIBadge />}
                </div>
                <span style={{ fontSize: 7, color: "#374151", fontFamily: "monospace" }}>{ev.timestamp}</span>
              </div>
              {!ev.success && ev.code && (
                <div style={{ fontSize: 7, color: "white", fontFamily: "monospace", marginTop: 1 }}>
                  [{ev.code}] {s && <span style={{ color: s.badge }}>{s.label}</span>}
                  {ev.escalated && <span style={{ marginLeft: 5, color: "#7dd3fc" }}>🎯 ESCALATED</span>}
                </div>
              )}
              {ev.aiSummary && (
                <div style={{ fontSize: 7, color: "#6b7280", marginTop: 1, fontStyle: "italic" }}>✦ {ev.aiSummary?.slice(0, 80)}...</div>
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
  DEMAND_DATA.forEach(({ data }) => Object.entries(data).forEach(([k, v]) => { totals[k] = (totals[k] || 0) + v; }));
  const maxDemand = Math.max(...Object.values(totals));

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
    return { key, label: RULE_METADATA[key].label, demand, failRate, riskScore };
  }).sort((a, b) => b.riskScore - a.riskScore);

  const maxRisk = Math.max(...rows.map(r => r.riskScore), 1);

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14 }}>
      <SectionHeader icon="📊" title="DEMAND × FAILURE RATE HEATMAP" />

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[...DEMAND_DATA, { month: "Q4 Total", data: totals }].map(({ month, data }) => {
          const total = Object.values(data).reduce((a, b) => a + b, 0);
          return (
            <div key={month} style={{ flex: 1, background: "#161b22", borderRadius: 5, padding: "5px 7px", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#00a651" }}>{total.toLocaleString()}</div>
              <div style={{ fontSize: 7, color: "white" }}>{month}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {rows.map(row => {
          const intensity = row.riskScore / maxRisk;
          const r = Math.round(239 * intensity);
          const g = Math.round(68 + (166 - 68) * (1 - intensity));
          const cellColor = `rgba(${r},${g},68,${0.15 + intensity * 0.6})`;
          return (
            <div key={row.key} style={{ display: "grid", gridTemplateColumns: "155px 1fr 58px 58px 65px", gap: 5, alignItems: "center" }}>
              <div style={{ fontSize: 10, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                #{RULE_METADATA[row.key].demand_rank} {row.label}
              </div>
              <div style={{ background: "#161b22", borderRadius: 3, height: 12, overflow: "hidden" }}>
                <div style={{ height: "100%", background: cellColor, width: `${intensity * 100}%`, borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 7, color: "#6b7280", textAlign: "right", fontFamily: "monospace" }}>{row.demand.toLocaleString()}</div>
              <div style={{ fontSize: 7, textAlign: "right", fontFamily: "monospace", color: row.failRate > 60 ? "#ef4444" : row.failRate > 30 ? "#f97316" : "white" }}>
                {row.failRate.toFixed(0)}% fail
              </div>
              <div style={{ background: cellColor, borderRadius: 3, padding: "2px 4px", textAlign: "center" }}>
                <span style={{ fontSize: 6, fontWeight: 700, color: "white" }}>
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
// AI DEEP-DIVE PANEL — the main new component
// ─────────────────────────────────────────────────────────────────────────────
function AIDeepDive({ merchant, lastResult, lastActionKey }) {
  const [activeTab, setActiveTab] = useState("analysis");
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiSMS, setAiSMS] = useState(null);
  const [aiBriefing, setAiBriefing] = useState(null);
  const [aiFleet, setAiFleet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const failures = scanAllFailures(merchant);
  const summary = getMerchantSummary(merchant);
  const tier = getRiskTier(merchant);
  const ts = RISK_TIER_STYLE[tier];
  const pred = predictContactProbability(merchant);
  const { red, amber, green, score } = getSensorHealth(merchant);

  // Auto-run AI analysis when merchant or last result changes
  useEffect(() => {
    if (lastResult && !lastResult.success) {
      runAnalysis();
    }
  }, [merchant.id, lastActionKey]);

  const runAnalysis = async () => {
    setLoading(true); setError(null); setAiAnalysis(null);
    try {
      const out = await analyzeWithClaude(merchant, failures, lastActionKey, lastResult);
      setAiAnalysis(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const runSMS = async () => {
    if (failures.length === 0) return;
    setLoading(true); setError(null); setAiSMS(null);
    try {
      const out = await generateInterventionSMS(merchant, failures[0]);
      setAiSMS(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const runBriefing = async () => {
    setLoading(true); setError(null); setAiBriefing(null);
    try {
      const out = await generateAgentBriefing(merchant, failures);
      setAiBriefing(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: "analysis", label: "🧠 AI Analysis" },
    { id: "prediction", label: "📈 Prediction" },
    { id: "sms", label: "💬 SMS Draft" },
    { id: "briefing", label: "📋 Agent Brief" },
    { id: "rules", label: "⚙️ All Rules" },
  ];

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column" }}>
      <SectionHeader icon="🔬" title="MERCHANT DEEP-DIVE" badge={<AIBadge />} />

      {/* Merchant header */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", background: "#080b10", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
        <div style={{ fontSize: 26 }}>{merchant.avatar}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{merchant.business_name}</div>
          <div style={{ fontSize: 10, color: "white" }}>{merchant.first_name} {merchant.last_name} · PB {merchant.paybill} · {merchant.phone_number}</div>
          <div style={{ fontSize: 10, color: "white" }}>{merchant.bank} · {merchant.county}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{formatKES(merchant.balance)}</div>
          <div style={{ fontSize: 10, color: ts.color, fontWeight: 700 }}>{ts.label}</div>
          <div style={{ fontSize: 7, color: "white" }}>{summary.passing}/{summary.total} pass</div>
        </div>
      </div>

      {/* Health bar */}
      <div style={{ background: "#080b10", borderRadius: 6, padding: "7px 10px", marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: "white" }}>Sensor Health</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: score > 0.7 ? "#4ade80" : score > 0.4 ? "#fbbf24" : "#f87171" }}>{Math.round(score * 100)}%</span>
        </div>
        <div style={{ display: "flex", gap: 1, height: 5, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ flex: green.length, background: "#4ade80" }} />
          <div style={{ flex: amber.length, background: "#fbbf24" }} />
          <div style={{ flex: red.length, background: "#f87171" }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
          {[["#4ade80", green.length, "OK"], ["#fbbf24", amber.length, "WARN"], ["#f87171", red.length, "FAIL"]].map(([c, n, l]) => (
            <span key={l} style={{ fontSize: 7, color: c }}>● {n} {l}</span>
          ))}
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 10, overflowX: "auto" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            background: activeTab === t.id ? "rgba(0,166,81,0.12)" : "transparent",
            border: `1px solid ${activeTab === t.id ? "rgba(0,166,81,0.4)" : "#21262d"}`,
            color: activeTab === t.id ? "#e2e8f0" : "white",
            borderRadius: 5, padding: "4px 10px", fontSize: 9, cursor: "pointer", whiteSpace: "nowrap", fontWeight: 600,
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* ── AI ANALYSIS TAB */}
        {activeTab === "analysis" && (
          <div>
            <button onClick={runAnalysis} disabled={loading} style={{
              width: "100%", marginBottom: 10,
              background: loading ? "#161b22" : "linear-gradient(90deg,#6366f1,#8b5cf6)",
              color: "white", border: "none", borderRadius: 7, padding: "9px",
              fontWeight: 700, fontSize: 11, cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              {loading ? <><Spinner size={13} color="white" /> Analyzing with Claude...</> : "✦ Run AI Analysis"}
            </button>

            {error && (
              <div style={{ background: "#1a0000", border: "1px solid #ef444455", borderRadius: 6, padding: "8px 10px", marginBottom: 8, fontSize: 14, color: "#fca5a5" }}>
                ⚠️ {error}
              </div>
            )}

            {aiAnalysis?.success && aiAnalysis.data && (() => {
              const d = aiAnalysis.data;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Risk score */}
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{
                      background: d.risk_score >= 70 ? "#1a0000" : d.risk_score >= 40 ? "#1a0900" : "#001408",
                      border: `1px solid ${d.risk_score >= 70 ? "#ef4444" : d.risk_score >= 40 ? "#f97316" : "#00a651"}44`,
                      borderRadius: 8, padding: "10px 14px", textAlign: "center", flexShrink: 0,
                    }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: d.risk_score >= 70 ? "#ef4444" : d.risk_score >= 40 ? "#f97316" : "#4ade80" }}>
                        {d.risk_score}
                      </div>
                      <div style={{ fontSize: 7, color: "white" }}>AI RISK</div>
                    </div>
                    <div style={{ flex: 1, background: "#080b10", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: 7, color: "white", fontWeight: 700, marginBottom: 3 }}>COMPOUND ANALYSIS</div>
                      <div style={{ fontSize: 9, color: "#cbd5e1", lineHeight: 1.55 }}>{d.compound_analysis}</div>
                    </div>
                  </div>

                  {/* Root cause + prediction */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <div style={{ background: "#1a0000", border: "1px solid #ef444433", borderRadius: 6, padding: "8px 10px" }}>
                      <div style={{ fontSize: 7, color: "#ef4444", fontWeight: 700, marginBottom: 3 }}>PRIMARY ROOT CAUSE</div>
                      <div style={{ fontSize: 9, color: "#fca5a5", lineHeight: 1.5 }}>{d.primary_root_cause}</div>
                    </div>
                    <div style={{ background: "#1a0900", border: "1px solid #f9731633", borderRadius: 6, padding: "8px 10px" }}>
                      <div style={{ fontSize: 7, color: "#f97316", fontWeight: 700, marginBottom: 3 }}>PREDICTED NEXT FAILURE</div>
                      <div style={{ fontSize: 9, color: "#fdba74", lineHeight: 1.5 }}>{d.predicted_next_failure}</div>
                    </div>
                  </div>

                  {/* Interventions */}
                  <div style={{ background: "rgba(234,179,8,0.05)", border: "1px solid rgba(234,179,8,0.15)", borderRadius: 6, padding: "9px 11px" }}>
                    <div style={{ fontSize: 7, color: "#eab308", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>AI INTERVENTION RECOMMENDATIONS</div>
                    {d.interventions?.map((rec, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 5, paddingBottom: 5, borderBottom: i < d.interventions.length - 1 ? "1px solid rgba(234,179,8,0.08)" : "none" }}>
                        <div style={{ background: "#eab30822", color: "#eab308", borderRadius: 3, padding: "2px 6px", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>P{rec.priority}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 9, color: "#e2e8f0", lineHeight: 1.4 }}>{rec.action}</div>
                          <div style={{ display: "flex", gap: 5, marginTop: 3 }}>
                            <span style={{ fontSize: 7, background: "#161b22", color: "#6b7280", padding: "1px 5px", borderRadius: 3 }}>{rec.channel}</span>
                            <span style={{ fontSize: 7, background: "#161b22", color: "#6b7280", padding: "1px 5px", borderRadius: 3 }}>{rec.timeframe}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Escalation + calls */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <div style={{ background: d.escalate_immediately ? "#1a0000" : "#001408", border: `1px solid ${d.escalate_immediately ? "#ef444433" : "#00a65133"}`, borderRadius: 6, padding: "8px 10px" }}>
                      <div style={{ fontSize: 7, color: d.escalate_immediately ? "#ef4444" : "#4ade80", fontWeight: 700, marginBottom: 3 }}>
                        {d.escalate_immediately ? "🎯 ESCALATION REQUIRED" : "✅ NO ESCALATION"}
                      </div>
                      <div style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.4 }}>{d.escalation_reason}</div>
                    </div>
                    <div style={{ background: "#001429", border: "1px solid #00a65133", borderRadius: 6, padding: "8px 10px" }}>
                      <div style={{ fontSize: 7, color: "#00a651", fontWeight: 700, marginBottom: 3 }}>CALLS PREVENTED IF FIXED</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: "#4ade80" }}>~{d.calls_prevented_if_resolved?.toLocaleString()}</div>
                      <div style={{ fontSize: 7, color: "#374151" }}>estimated contact center contacts</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {!aiAnalysis && !loading && !error && (
              <div style={{ color: "#374151", fontSize: 14, textAlign: "center", padding: 20 }}>
                Click "Run AI Analysis" to have Claude reason across all sensor failures for this merchant
              </div>
            )}
          </div>
        )}

        {/* ── PREDICTION TAB */}
        {activeTab === "prediction" && (
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", background: "#080b10", borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 36, fontWeight: 800, color: pred.color }}>{pred.score}</div>
                <div style={{ fontSize: 9, color: pred.color, fontWeight: 700 }}>{pred.tier}</div>
                <div style={{ fontSize: 7, color: "#374151", marginTop: 2 }}>CALL PROBABILITY</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.5, marginBottom: 6 }}>
                  {pred.score >= 70
                    ? "Very high likelihood this merchant will contact the call center within 7 days if no proactive action is taken."
                    : pred.score >= 50
                    ? "High likelihood of contact center call. Proactive outreach recommended."
                    : pred.score >= 30
                    ? "Moderate risk. Monitor and prepare intervention if sensor state worsens."
                    : "Low contact probability. Merchant is in healthy state."}
                </div>
                {/* Score bar */}
                <div style={{ background: "#161b22", borderRadius: 4, height: 8, overflow: "hidden", marginBottom: 4 }}>
                  <div style={{ width: `${pred.score}%`, height: "100%", background: `linear-gradient(90deg, #4ade80, ${pred.color})`, borderRadius: 4, transition: "width 0.5s" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 7, color: "#4ade80" }}>0 — LOW RISK</span>
                  <span style={{ fontSize: 7, color: "#ef4444" }}>100 — CRITICAL</span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 10, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>SCORING FACTORS</div>
            {pred.factors.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "#080b10", borderRadius: 5, padding: "5px 8px", marginBottom: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: pred.color, flexShrink: 0 }} />
                <div style={{ fontSize: 9, color: "#94a3b8" }}>{f}</div>
              </div>
            ))}
            {pred.factors.length === 0 && (
              <div style={{ color: "#4ade80", fontSize: 14, textAlign: "center", padding: 16 }}>✅ No risk factors — merchant is healthy</div>
            )}
          </div>
        )}

        {/* ── SMS TAB */}
        {activeTab === "sms" && (
          <div>
            <button onClick={runSMS} disabled={loading || failures.length === 0} style={{
              width: "100%", marginBottom: 10,
              background: loading ? "#161b22" : failures.length === 0 ? "#161b22" : "linear-gradient(90deg,#6366f1,#8b5cf6)",
              color: "white", border: "none", borderRadius: 7, padding: "9px",
              fontWeight: 700, fontSize: 11, cursor: (loading || failures.length === 0) ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              {loading ? <><Spinner size={13} color="white" /> Generating SMS...</> : "✦ Generate Intervention SMS"}
            </button>

            {failures.length === 0 && (
              <div style={{ color: "#4ade80", fontSize: 14, textAlign: "center", padding: 16 }}>No failures to generate SMS for — merchant is healthy</div>
            )}

            {failures.length > 0 && !aiSMS && !loading && (
              <div style={{ background: "#080b10", borderRadius: 6, padding: "8px 10px", marginBottom: 8 }}>
                <div style={{ fontSize: 7, color: "white", marginBottom: 3 }}>SMS WILL ADDRESS TOP FAILURE</div>
                <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>{failures[0].actionLabel}</div>
                <div style={{ fontSize: 10, color: SEV[failures[0].severity]?.badge }}>{SEV[failures[0].severity]?.icon} {failures[0].code} — {failures[0].inline}</div>
              </div>
            )}

            {error && <div style={{ background: "#1a0000", border: "1px solid #ef444455", borderRadius: 6, padding: "8px 10px", fontSize: 14, color: "#fca5a5", marginBottom: 8 }}>⚠️ {error}</div>}

            {aiSMS?.success && aiSMS.data && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "white" }}>Urgency:</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: aiSMS.data.urgency === "critical" ? "#ef4444" : aiSMS.data.urgency === "high" ? "#f97316" : "#eab308" }}>
                    {aiSMS.data.urgency?.toUpperCase()}
                  </span>
                </div>
                {[
                  { lang: "🇬🇧 English", key: "english", color: "#60a5fa" },
                  { lang: "🇰🇪 Kiswahili", key: "kiswahili", color: "#4ade80" },
                ].map(({ lang, key, color }) => (
                  <div key={key} style={{ background: "#080b10", border: `1px solid ${color}22`, borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 7, color, fontWeight: 700, marginBottom: 5 }}>{lang}</div>
                    <div style={{ fontSize: 14, color: "#e2e8f0", lineHeight: 1.6, fontFamily: "monospace" }}>"{aiSMS.data[key]}"</div>
                    <div style={{ fontSize: 7, color: "#374151", marginTop: 5 }}>
                      {aiSMS.data[key]?.length || 0}/160 characters
                      <span style={{ marginLeft: 8, color: (aiSMS.data[key]?.length || 0) > 160 ? "#ef4444" : "#4ade80" }}>
                        {(aiSMS.data[key]?.length || 0) <= 160 ? "✓ Within limit" : "⚠ Exceeds SMS limit"}
                      </span>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 7, color: "#374151", textAlign: "center" }}>
                  To: {merchant.phone_number} · {merchant.first_name} {merchant.last_name}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── AGENT BRIEFING TAB */}
        {activeTab === "briefing" && (
          <div>
            <button onClick={runBriefing} disabled={loading} style={{
              width: "100%", marginBottom: 10,
              background: loading ? "#161b22" : "linear-gradient(90deg,#6366f1,#8b5cf6)",
              color: "white", border: "none", borderRadius: 7, padding: "9px",
              fontWeight: 700, fontSize: 11, cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              {loading ? <><Spinner size={13} color="white" /> Generating Briefing...</> : "✦ Generate Agent Briefing Note"}
            </button>

            {error && <div style={{ background: "#1a0000", border: "1px solid #ef444455", borderRadius: 6, padding: "8px 10px", fontSize: 14, color: "#fca5a5", marginBottom: 8 }}>⚠️ {error}</div>}

            {aiBriefing?.success && aiBriefing.data && (() => {
              const d = aiBriefing.data;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <div style={{ background: "#080b10", borderRadius: 6, padding: "8px 10px", borderLeft: "3px solid #6366f1" }}>
                    <div style={{ fontSize: 7, color: "#6366f1", fontWeight: 700, marginBottom: 3 }}>HEADLINE</div>
                    <div style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 600 }}>{d.headline}</div>
                  </div>
                  <div style={{ background: "#001408", border: "1px solid #00a65133", borderRadius: 6, padding: "8px 10px" }}>
                    <div style={{ fontSize: 7, color: "#00a651", fontWeight: 700, marginBottom: 3 }}>OPEN WITH</div>
                    <div style={{ fontSize: 9, color: "#86efac", fontStyle: "italic", lineHeight: 1.5 }}>"{d.open_with}"</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <div style={{ background: "#080b10", borderRadius: 6, padding: "8px 10px" }}>
                      <div style={{ fontSize: 7, color: "#ef4444", fontWeight: 700, marginBottom: 4 }}>KEY ISSUES</div>
                      {d.key_issues?.map((issue, i) => <div key={i} style={{ fontSize: 10, color: "#fca5a5", marginBottom: 2 }}>• {issue}</div>)}
                    </div>
                    <div style={{ background: "#080b10", borderRadius: 6, padding: "8px 10px" }}>
                      <div style={{ fontSize: 7, color: "#4ade80", fontWeight: 700, marginBottom: 4 }}>RESOLUTION STEPS</div>
                      {d.resolution_steps?.map((step, i) => <div key={i} style={{ fontSize: 10, color: "#86efac", marginBottom: 2 }}>{i + 1}. {step}</div>)}
                    </div>
                  </div>
                  <div style={{ background: "#1a1500", border: "1px solid #eab30833", borderRadius: 6, padding: "8px 10px" }}>
                    <div style={{ fontSize: 7, color: "#eab308", fontWeight: 700, marginBottom: 3 }}>⚠️ THINGS TO AVOID</div>
                    {d.things_to_avoid?.map((t, i) => <div key={i} style={{ fontSize: 10, color: "#fde68a", marginBottom: 2 }}>• {t}</div>)}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ flex: 1, background: "#080b10", borderRadius: 6, padding: "7px 10px" }}>
                      <div style={{ fontSize: 7, color: "white", marginBottom: 2 }}>ESCALATION THRESHOLD</div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>{d.escalation_threshold}</div>
                    </div>
                    <div style={{ background: "#080b10", borderRadius: 6, padding: "7px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 7, color: "white", marginBottom: 2 }}>EST. HANDLE TIME</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0" }}>{d.estimated_handle_time}</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {!aiBriefing && !loading && !error && (
              <div style={{ color: "#374151", fontSize: 14, textAlign: "center", padding: 20 }}>
                Generate a CRM briefing note for the agent who will call or visit this merchant
              </div>
            )}
          </div>
        )}

        {/* ── ALL RULES TAB */}
        {activeTab === "rules" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {ALL_ACTION_KEYS.map(key => {
              const result = evaluateAction(merchant, key);
              const meta = RULE_METADATA[key];
              const s = !result.success ? SEV[result.severity] : null;
              return (
                <div key={key} style={{ background: !result.success ? s.bg : "rgba(74,222,128,0.03)", border: `1px solid ${!result.success ? s.bd + "44" : "#1e2730"}`, borderRadius: 5, padding: "6px 8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                      <span style={{ fontSize: 14 }}>{result.success === true ? "✅" : result.success === "warn" ? "⚠️" : "❌"}</span>
                      <span style={{ fontSize: 9, color: !result.success ? s.badge : "#4ade80", fontWeight: 600 }}>#{meta.demand_rank} {meta.label}</span>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {s && <span style={{ fontSize: 7, background: s.badge + "22", color: s.badge, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>{s.label}</span>}
                      {result.code && result.code !== "OK" && <span style={{ fontSize: 7, color: "#374151", fontFamily: "monospace" }}>[{result.code}]</span>}
                    </div>
                  </div>
                  {!result.success && <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2, lineHeight: 1.4 }}>{result.inline}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FLEET INSIGHT PANEL
// ─────────────────────────────────────────────────────────────────────────────
function FleetInsightPanel({ merchants }) {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setLoading(true); setError(null); setInsight(null);
    try {
      const batchResult = scanMerchantBatch(merchants);
      const out = await generateFleetInsight(batchResult);
      setInsight(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14 }}>
      <SectionHeader icon="🌐" title="AI FLEET INTELLIGENCE" badge={<AIBadge />} />

      <button onClick={run} disabled={loading} style={{
        width: "100%", marginBottom: 10,
        background: loading ? "#161b22" : "linear-gradient(90deg,#6366f1,#8b5cf6)",
        color: "white", border: "none", borderRadius: 7, padding: "9px",
        fontWeight: 700, fontSize: 11, cursor: loading ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      }}>
        {loading ? <><Spinner size={13} color="white" /> Claude analyzing fleet...</> : "✦ Generate Fleet Intelligence Report"}
      </button>

      {error && <div style={{ background: "#1a0000", border: "1px solid #ef444455", borderRadius: 6, padding: "8px 10px", fontSize: 14, color: "#fca5a5", marginBottom: 8 }}>⚠️ {error}</div>}

      {insight?.success && insight.data && (() => {
        const d = insight.data;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ background: "#080b10", borderRadius: 6, padding: "9px 11px", borderLeft: "3px solid #6366f1" }}>
              <div style={{ fontSize: 7, color: "#6366f1", fontWeight: 700, marginBottom: 3 }}>EXECUTIVE SUMMARY</div>
              <div style={{ fontSize: 14, color: "#e2e8f0", lineHeight: 1.55 }}>{d.fleet_health_summary}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div style={{ background: "#1a0000", border: "1px solid #ef444433", borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 7, color: "#ef4444", fontWeight: 700, marginBottom: 3 }}>BIGGEST RISK</div>
                <div style={{ fontSize: 9, color: "#fca5a5", lineHeight: 1.4 }}>{d.biggest_risk}</div>
              </div>
              <div style={{ background: "#001408", border: "1px solid #00a65133", borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 7, color: "#00a651", fontWeight: 700, marginBottom: 3 }}>CALL REDUCTION ESTIMATE</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#4ade80" }}>{d.estimated_call_reduction}</div>
              </div>
            </div>
            <div style={{ background: "#080b10", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 7, color: "#eab308", fontWeight: 700, marginBottom: 3 }}>PATTERN DETECTED</div>
              <div style={{ fontSize: 9, color: "#fde68a", lineHeight: 1.4 }}>{d.pattern_detected}</div>
            </div>
            <div style={{ background: "#080b10", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 7, color: "#60a5fa", fontWeight: 700, marginBottom: 3 }}>RECOMMENDED CAMPAIGN</div>
              <div style={{ fontSize: 9, color: "#bae6fd", lineHeight: 1.4 }}>{d.recommended_campaign}</div>
            </div>
            <div style={{ background: "#080b10", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 7, color: "#f97316", fontWeight: 700, marginBottom: 3 }}>30-DAY FORECAST (IF NO ACTION)</div>
              <div style={{ fontSize: 9, color: "#fdba74", lineHeight: 1.4 }}>{d.thirty_day_forecast || d["30_day_forecast"]}</div>
            </div>
            {d.priority_merchants?.length > 0 && (
              <div style={{ background: "#080b10", borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ fontSize: 7, color: "white", fontWeight: 700, marginBottom: 4 }}>PRIORITY MERCHANTS FOR OUTREACH</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {d.priority_merchants.map((name, i) => (
                    <span key={i} style={{ fontSize: 10, background: "#ef444422", color: "#f87171", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>{name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {!insight && !loading && !error && (
        <div style={{ color: "#374151", fontSize: 14, textAlign: "center", padding: 16 }}>
          Claude will analyze the entire merchant fleet and generate a strategic intelligence report
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL TRIGGER
// ─────────────────────────────────────────────────────────────────────────────
function ManualTrigger({ merchants, onFire }) {
  const [selMerchant, setSelMerchant] = useState(merchants[0]?.id || "");
  const [selAction, setSelAction] = useState(ALL_ACTION_KEYS[0]);

  useEffect(() => { if (merchants.length > 0 && !merchants.find(m => m.id === selMerchant)) setSelMerchant(merchants[0].id); }, [merchants]);

  return (
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14 }}>
      <SectionHeader icon="🎮" title="MANUAL TRIGGER" />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select value={selMerchant} onChange={e => setSelMerchant(e.target.value)}
          style={{ flex: 2, minWidth: 150, background: "#161b22", border: "1px solid #21262d", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 14, outline: "none" }}>
          {merchants.map(m => <option key={m.id} value={m.id}>{m.business_name} ({m.paybill})</option>)}
        </select>
        <select value={selAction} onChange={e => setSelAction(e.target.value)}
          style={{ flex: 2, minWidth: 150, background: "#161b22", border: "1px solid #21262d", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 14, outline: "none" }}>
          {ALL_ACTION_KEYS.map(key => <option key={key} value={key}>#{RULE_METADATA[key].demand_rank} {RULE_METADATA[key].label}</option>)}
        </select>
        <button onClick={() => { const m = merchants.find(m => m.id === selMerchant); if (m) onFire(m, selAction); }}
          style={{ background: "#00a651", color: "white", border: "none", borderRadius: 6, padding: "7px 16px", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
          ▶ Fire
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function TwinDashboardV2() {
  const [merchants, setMerchants] = useState([...MERCHANT_REGISTRY]);
  const [selectedMerchant, setSelectedMerchant] = useState(MERCHANT_REGISTRY[0]);
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [autoRunning, setAutoRunning] = useState(false);
  const [loopState, setLoopState] = useState({ mirror: false, analyze: false, update: false, summarize: false });
  const [lastEvent, setLastEvent] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [lastActionKey, setLastActionKey] = useState(null);
  const [anomalies, setAnomalies] = useState([]);
  const [twinStats, setTwinStats] = useState({ total: 0, failures: 0, escalations: 0, aiCalls: 0 });
  const autoRef = useRef(null);

  // Refresh alerts when fleet changes
  useEffect(() => {
    const allAlerts = [];
    merchants.forEach(m => scanAllFailures(m).forEach(f => allAlerts.push({ ...f, merchant: m })));
    allAlerts.sort((a, b) => ({ critical: 4, high: 3, medium: 2, low: 1 }[b.severity] - ({ critical: 4, high: 3, medium: 2, low: 1 }[a.severity])));
    setAlerts(allAlerts);
  }, [merchants]);

  const fireCycle = useCallback(async (merchant, actionKey, withAI = false) => {
    const meta = RULE_METADATA[actionKey];
    const result = evaluateAction(merchant, actionKey);

    // Animate loop
    setLoopState({ mirror: true, analyze: false, update: false, summarize: false });
    setTimeout(() => setLoopState({ mirror: true, analyze: true, update: false, summarize: false }), 250);
    setTimeout(() => setLoopState({ mirror: true, analyze: true, update: true, summarize: false }), 500);
    setTimeout(() => setLoopState({ mirror: true, analyze: true, update: true, summarize: true }), 750);
    setTimeout(() => setLoopState({ mirror: false, analyze: false, update: false, summarize: false }), 1400);

    setLastResult(result);
    setLastActionKey(actionKey);
    setSelectedMerchant(merchant);

    const ev = {
      id: uid(), merchant,
      merchantName: merchant.business_name,
      phone: merchant.phone_number,
      actionKey, actionLabel: meta.label,
      ussdPath: meta.ussd_path,
      success: result.success,
      code: result.code,
      severity: result.severity,
      escalated: result.severity === "critical",
      timestamp: ts(),
      aiAnalyzed: false,
      aiSummary: null,
    };

    setEvents(prev => [...prev, ev].slice(-200));
    setTwinStats(prev => ({ ...prev, total: prev.total + 1, failures: prev.failures + (!result.success ? 1 : 0), escalations: prev.escalations + (result.severity === "critical" ? 1 : 0) }));

    // Detect anomalies on every 10th event
    setEvents(prev => {
      if (prev.length % 10 === 0) {
        setAnomalies(detectAnomalies(prev));
      }
      return prev;
    });

    setLastEvent(ev);
  }, []);

  // Auto-simulation
  useEffect(() => {
    if (autoRunning) {
      autoRef.current = setInterval(() => {
        const merchant = merchants[Math.floor(Math.random() * merchants.length)];
        const action = ALL_ACTION_KEYS[Math.floor(Math.random() * ALL_ACTION_KEYS.length)];
        fireCycle(merchant, action);
      }, 1800);
    } else {
      clearInterval(autoRef.current);
    }
    return () => clearInterval(autoRef.current);
  }, [autoRunning, merchants, fireCycle]);

  const addGenerated = (n) => {
    const batch = generateMerchantBatch(n);
    setMerchants(prev => [...prev, ...batch]);
  };

  return (
    <div style={{ fontFamily: "'IBM Plex Sans','Segoe UI',sans-serif", background: "#060a0f", color: "#e2e8f0", minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* CSS animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* HEADER */}
      <div style={{ background: "#080b10", borderBottom: "1px solid #1e2730", padding: "9px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 8, padding: "6px 9px", fontSize: 14 }}>✦</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 13 }}>
              Merchant Digital Twin <span style={{ color: "#374151" }}>·</span> <span style={{ color: "#6366f1" }}>Step 4 V2 — AI Reasoning</span>
            </div>
            <div style={{ fontSize: 10, color: "#374151" }}>
              Claude-powered compound failure analysis · SMS generator · Agent briefing · Fleet intelligence · Anomaly detection · Contact prediction
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          {[
            { label: "Cycles", v: twinStats.total, c: "#6b7280" },
            { label: "Failures", v: twinStats.failures, c: "#f97316" },
            { label: "Escalations", v: twinStats.escalations, c: "#ef4444" },
            { label: "Merchants", v: merchants.length, c: "#6366f1" },
          ].map(k => (
            <div key={k.label} style={{ textAlign: "center", background: "#161b22", borderRadius: 6, padding: "3px 9px" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: k.c }}>{k.v}</div>
              <div style={{ fontSize: 7, color: "#374151" }}>{k.label}</div>
            </div>
          ))}
          <button onClick={() => setAutoRunning(p => !p)} style={{
            background: autoRunning ? "#ef4444" : "#00a651",
            color: "white", border: "none", borderRadius: 7,
            padding: "7px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer",
            boxShadow: autoRunning ? "0 0 14px rgba(239,68,68,0.4)" : "0 0 14px rgba(0,166,81,0.4)",
          }}>
            {autoRunning ? "⏹ Pause" : "▶ Auto Run"}
          </button>
          <button onClick={() => addGenerated(5)} style={{ background: "#161b22", color: "#e2e8f0", border: "1px solid #21262d", borderRadius: 7, padding: "7px 11px", fontSize: 14, cursor: "pointer" }}>+ 5 Merchants</button>
          <button onClick={() => { setMerchants([...MERCHANT_REGISTRY]); setSelectedMerchant(MERCHANT_REGISTRY[0]); }} style={{ background: "#161b22", color: "#6b7280", border: "1px solid #21262d", borderRadius: 7, padding: "7px 11px", fontSize: 14, cursor: "pointer" }}>Reset</button>
          <button onClick={() => setEvents([])} style={{ background: "#161b22", color: "#6b7280", border: "1px solid #21262d", borderRadius: 7, padding: "7px 11px", fontSize: 14, cursor: "pointer" }}>Clear Log</button>
        </div>
      </div>

      {/* MAIN GRID — 3 columns */}
      <div style={{ flex: 1, padding: 12, overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, alignItems: "start" }}>

        {/* Col 1: Twin loop + Fleet overview */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <TwinLoopVisualiser loopState={loopState} lastEvent={lastEvent} anomalies={anomalies} />
          <ManualTrigger merchants={merchants} onFire={fireCycle} />
          <FleetOverview merchants={merchants} onSelectMerchant={setSelectedMerchant} selectedId={selectedMerchant.id} />
        </div>

        {/* Col 2: Alert feed + Activity log + Demand heatmap */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <AlertFeed alerts={alerts} onSelectMerchant={setSelectedMerchant} />
          <ActivityLog events={events} onSelectMerchant={setSelectedMerchant} />
          <DemandHeatmap merchants={merchants} />
        </div>

        {/* Col 3: AI deep-dive + Fleet insight */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <AIDeepDive merchant={selectedMerchant} lastResult={lastResult} lastActionKey={lastActionKey} />
          <FleetInsightPanel merchants={merchants} />
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ background: "#080b10", borderTop: "1px solid #1e2730", padding: "5px 18px", display: "flex", justifyContent: "space-between", fontSize: 10, color: "#1e2730" }}>
        <span>Step 4 V2 — merchantDataModel.js + failureRulesEngine.js + aiReasoningEngine.js + twinDashboardV2.jsx</span>
        <span>Claude {new Date().toLocaleString("en-KE")}</span>
      </div>
    </div>
  );
}