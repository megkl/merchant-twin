// failureRulesViewer.jsx
// Visual explorer for Step 2 — failureRulesEngine.js

import { useState } from "react";
import { MERCHANT_REGISTRY, generateMerchant, getRiskTier, RISK_TIER_STYLE, formatKES } from "./merchantDataModel";
import { evaluateAction, scanAllFailures, getMerchantSummary, scanMerchantBatch, RULE_METADATA, MENU_STRUCTURE } from "./failureRulesEngine";

const ALL_KEYS = Object.keys(RULE_METADATA);

const SEV = {
  critical: { bd: "#ef4444", bg: "#1a0000", badge: "#ef4444", icon: "🔴", label: "CRITICAL" },
  high:     { bd: "#f97316", bg: "#1a0900", badge: "#f97316", icon: "🟠", label: "HIGH" },
  medium:   { bd: "#eab308", bg: "#1a1500", badge: "#eab308", icon: "🟡", label: "MEDIUM" },
  low:      { bd: "#60a5fa", bg: "#001029", badge: "#60a5fa", icon: "🔵", label: "LOW" },
};

export default function FailureRulesViewer() {
  const [merchants, setMerchants] = useState([...MERCHANT_REGISTRY]);
  const [selected, setSelected] = useState(MERCHANT_REGISTRY[0]);
  const [activeTab, setActiveTab] = useState("evaluator"); // evaluator | rules | batch | scanner
  const [selectedAction, setSelectedAction] = useState("SETTLE_FUNDS");
  const [result, setResult] = useState(null);

  const fireRule = () => {
    setResult(evaluateAction(selected, selectedAction));
  };

  const allFailures = scanAllFailures(selected);
  const summary = getMerchantSummary(selected);
  const batchResult = scanMerchantBatch(merchants);

  const tabs = [
    { id: "evaluator", label: "▶ Evaluator",   desc: "Run a rule against a merchant" },
    { id: "scanner",   label: "🔍 Pre-Scanner", desc: "All failures for one merchant" },
    { id: "rules",     label: "📖 Rules Catalogue", desc: "All 12 rules with metadata" },
    { id: "batch",     label: "🏭 Batch Scanner", desc: "Fleet-level risk matrix" },
  ];

  return (
    <div style={{ background: "#060a0f", color: "#e2e8f0", minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "'IBM Plex Sans','Segoe UI',sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#080b10", borderBottom: "1px solid #1e2730", padding: "10px 20px" }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>
          ⚙️ Step 2 — <span style={{ color: "#00a651" }}>Failure Rules Engine</span>
          <span style={{ fontSize: 14, color: "#ccc", fontWeight: 400, marginLeft: 10 }}>failureRulesEngine.js</span>
        </div>
        <div style={{ fontSize: 9, color: "#ccc" }}>
          12 rules ranked by call center demand · Evaluator · Pre-scanner · Batch scanner
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ background: "#0a0e14", borderBottom: "1px solid #1e2730", display: "flex", padding: "0 20px" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            background: "none", border: "none",
            borderBottom: activeTab === t.id ? "2px solid #00a651" : "2px solid transparent",
            color: activeTab === t.id ? "#e2e8f0" : "white",
            padding: "8px 14px", cursor: "pointer", fontSize: 11, fontWeight: 600,
          }}>
            {t.label}
            <span style={{ fontSize: 10, color: "#ccc", marginLeft: 5 }}>{t.desc}</span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>

        {/* ── EVALUATOR TAB */}
        {activeTab === "evaluator" && (
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 14 }}>
            {/* Merchant selector */}
            <div>
              <div style={{ fontSize: 9, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>MERCHANT</div>
              {merchants.map(m => (
                <button key={m.id} onClick={() => { setSelected(m); setResult(null); }} style={{
                  width: "100%", background: selected.id === m.id ? "rgba(0,166,81,0.1)" : "rgba(255,255,255,0.02)",
                  border: selected.id === m.id ? "1px solid rgba(0,166,81,0.5)" : "1px solid #1e2730",
                  borderRadius: 6, padding: "8px 10px", cursor: "pointer", textAlign: "left", marginBottom: 4,
                }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 14 }}>{m.avatar}</span>
                    <div>
                      <div style={{ color: "#e2e8f0", fontSize: 9, fontWeight: 600 }}>{m.business_name}</div>
                      <div style={{ fontSize: 7, color: RISK_TIER_STYLE[getRiskTier(m)].color, fontWeight: 700 }}>{getRiskTier(m)}</div>
                    </div>
                  </div>
                </button>
              ))}
              <button onClick={() => { const m = generateMerchant(); setMerchants(p => [...p, m]); setSelected(m); }} style={{
                width: "100%", background: "#161b22", border: "1px solid #ffffff", color: "#6b7280",
                borderRadius: 6, padding: "7px", fontSize: 9, cursor: "pointer", marginTop: 4,
              }}>+ Random Merchant</button>
            </div>

            {/* Action evaluator */}
            <div>
              <div style={{ fontSize: 9, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>EVALUATE ACTION</div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 5, marginBottom: 10 }}>
                {ALL_KEYS.map(key => {
                  const meta = RULE_METADATA[key];
                  const preCheck = evaluateAction(selected, key);
                  const active = selectedAction === key;
                  return (
                    <button key={key} onClick={() => { setSelectedAction(key); setResult(null); }} style={{
                      background: active ? "rgba(0,166,81,0.1)" : (!preCheck.success ? SEV[preCheck.severity]?.bg : "#0d1117"),
                      border: active ? "1px solid #00a651" : `1px solid ${!preCheck.success ? SEV[preCheck.severity]?.bd + "55" : "#1e2730"}`,
                      borderRadius: 6, padding: "7px 9px", cursor: "pointer", textAlign: "left",
                    }}>
                      <div style={{ fontSize: 10, color: "#ccc", marginBottom: 2 }}>#{meta.demand_rank}</div>
                      <div style={{ fontSize: 9, color: "#e2e8f0", fontWeight: 600, lineHeight: 1.3 }}>{meta.label}</div>
                      <div style={{ fontSize: 7, marginTop: 3 }}>
                        {!preCheck.success
                          ? <span style={{ color: SEV[preCheck.severity]?.badge }}>{SEV[preCheck.severity]?.icon} {preCheck.code}</span>
                          : <span style={{ color: "#4ade80" }}>✓ PASS</span>
                        }
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1, background: "#0d1117", border: "1px solid #1e2730", borderRadius: 6, padding: "8px 12px" }}>
                  <div style={{ fontSize: 10, color: "#ccc", marginBottom: 2 }}>SELECTED RULE</div>
                  <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 700 }}>#{RULE_METADATA[selectedAction].demand_rank} {RULE_METADATA[selectedAction].label}</div>
                  <div style={{ fontSize: 10, color: "white", marginTop: 2 }}>{RULE_METADATA[selectedAction].menu_path}</div>
                  <div style={{ fontSize: 10, color: "white" }}>{RULE_METADATA[selectedAction].ussd_path}</div>
                  <div style={{ fontSize: 10, color: "#ccc", marginTop: 3 }}>
                    {RULE_METADATA[selectedAction].demand_total.toLocaleString()} calls Oct–Dec 2025
                  </div>
                </div>
                <button onClick={fireRule} style={{ background: "#00a651", color: "white", border: "none", borderRadius: 6, padding: "0 24px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                  ▶ Evaluate
                </button>
              </div>

              {result && (
                <div style={{
                  border: `1px solid ${result.success === true ? "#00a651" : SEV[result.severity]?.bd}`,
                  borderLeft: `4px solid ${result.success === true ? "#00a651" : SEV[result.severity]?.bd}`,
                  background: result.success === true ? "#001408" : SEV[result.severity]?.bg,
                  borderRadius: 8, padding: "12px 14px",
                }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 16 }}>{result.success === true ? "✅" : result.success === "warn" ? "⚠️" : "❌"}</span>
                    <span style={{ fontWeight: 800, fontSize: 13, color: result.success === true ? "#4ade80" : SEV[result.severity]?.badge }}>
                      {result.success === true ? "SUCCESS" : result.success === "warn" ? "WARNING" : "FAILED"}
                    </span>
                    {result.code !== "OK" && <span style={{ fontSize: 14, fontFamily: "monospace", color: "white" }}>[{result.code}]</span>}
                    {result.severity && (
                      <span style={{ fontSize: 9, background: SEV[result.severity]?.badge + "22", color: SEV[result.severity]?.badge, padding: "2px 7px", borderRadius: 4, fontWeight: 700 }}>
                        {SEV[result.severity]?.label}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 14, color: "#e2e8f0", margin: "0 0 8px", lineHeight: 1.5 }}>{result.inline}</p>
                  {!result.success && (
                    <>
                      <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 5, padding: "8px 10px", marginBottom: 6 }}>
                        <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>WHY THIS HAPPENED</div>
                        <p style={{ fontSize: 11, color: "#cbd5e1", margin: 0, lineHeight: 1.5 }}>{result.reason}</p>
                      </div>
                      <div style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.18)", borderRadius: 5, padding: "8px 10px", marginBottom: 6 }}>
                        <div style={{ fontSize: 10, color: "#eab308", fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>💡 HOW TO FIX</div>
                        <p style={{ fontSize: 11, color: "#cbd5e1", margin: 0, lineHeight: 1.5 }}>{result.fix}</p>
                      </div>
                      <div style={{ background: "rgba(99,179,237,0.06)", border: "1px solid rgba(99,179,237,0.15)", borderRadius: 5, padding: "8px 10px" }}>
                        <div style={{ fontSize: 10, color: "#7dd3fc", fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>ESCALATION</div>
                        <p style={{ fontSize: 11, color: "#bae6fd", margin: 0 }}>{result.escalation}</p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PRE-SCANNER TAB */}
        {activeTab === "scanner" && (
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 14 }}>
            <div>
              <div style={{ fontSize: 9, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>MERCHANT</div>
              {merchants.map(m => (
                <button key={m.id} onClick={() => setSelected(m)} style={{
                  width: "100%", background: selected.id === m.id ? "rgba(0,166,81,0.1)" : "rgba(255,255,255,0.02)",
                  border: selected.id === m.id ? "1px solid rgba(0,166,81,0.5)" : "1px solid #1e2730",
                  borderRadius: 6, padding: "8px 10px", cursor: "pointer", textAlign: "left", marginBottom: 4,
                }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span>{m.avatar}</span>
                    <div>
                      <div style={{ fontSize: 9, color: "#e2e8f0", fontWeight: 600 }}>{m.business_name}</div>
                      <div style={{ fontSize: 7, color: RISK_TIER_STYLE[getRiskTier(m)].color }}>{getRiskTier(m)}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div>
              {/* Summary */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 12 }}>
                {[
                  { label: "Total Rules", v: summary.total, c: "#6b7280" },
                  { label: "Passing", v: summary.passing, c: "#4ade80" },
                  { label: "Failures", v: summary.failures, c: "#f87171" },
                  { label: "Calls at Risk", v: summary.callsAtRisk.toLocaleString(), c: "#eab308" },
                ].map(k => (
                  <div key={k.label} style={{ background: "#0d1117", border: "1px solid #1e2730", borderRadius: 7, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: k.c }}>{k.v}</div>
                    <div style={{ fontSize: 10, color: "white" }}>{k.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 9, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
                ALL FAILURES DETECTED (sorted by severity × demand)
              </div>
              {allFailures.length === 0 && (
                <div style={{ color: "#4ade80", fontSize: 14, textAlign: "center", padding: 30 }}>
                  ✅ No failures detected for this merchant
                </div>
              )}
              {allFailures.map((f, i) => {
                const s = SEV[f.severity];
                return (
                  <div key={i} style={{ background: s.bg, border: `1px solid ${s.bd}44`, borderLeft: `3px solid ${s.bd}`, borderRadius: 6, padding: "9px 11px", marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 10, background: s.badge + "22", color: s.badge, padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>{s.icon} {s.label}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>#{f.demand_rank} {f.actionLabel}</span>
                      </div>
                      <span style={{ fontSize: 10, fontFamily: "monospace", color: "white" }}>[{f.code}]</span>
                    </div>
                    <div style={{ fontSize: 9, color: "#cbd5e1", marginBottom: 3, lineHeight: 1.4 }}>{f.inline}</div>
                    <div style={{ fontSize: 10, color: "#6b7280" }}>
                      <span style={{ color: "#ccc" }}>Fix: </span>{f.fix}
                    </div>
                    <div style={{ fontSize: 7, color: "#ccc", marginTop: 3 }}>
                      {f.demand_total?.toLocaleString()} calls (Oct–Dec) · {f.ussd_path} · {f.menu_path}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── RULES CATALOGUE TAB */}
        {activeTab === "rules" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {ALL_KEYS.map(key => {
              const meta = RULE_METADATA[key];
              return (
                <div key={key} style={{ background: "#0d1117", border: "1px solid #1e2730", borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#ccc", marginBottom: 2 }}>Demand Rank #{meta.demand_rank}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0" }}>{meta.label}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#00a651" }}>{meta.demand_total.toLocaleString()}</div>
                      <div style={{ fontSize: 7, color: "#ccc" }}>calls Oct–Dec</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: "#6b7280", lineHeight: 1.5, marginBottom: 6 }}>{meta.description}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 7, background: "#161b22", color: "#6b7280", padding: "2px 6px", borderRadius: 3, fontFamily: "monospace" }}>{meta.ussd_path}</span>
                    <span style={{ fontSize: 7, background: "#161b22", color: "#6b7280", padding: "2px 6px", borderRadius: 3 }}>{meta.menu_path}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── BATCH SCANNER TAB */}
        {activeTab === "batch" && (
          <div>
            {/* Fleet KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, marginBottom: 14 }}>
              {[
                { label: "Total Merchants", v: batchResult.fleet.totalMerchants, c: "#6b7280" },
                { label: "Healthy", v: batchResult.fleet.healthyMerchants, c: "#4ade80" },
                { label: "With Failures", v: batchResult.fleet.merchantsWithAnyFailure, c: "#f97316" },
                { label: "Critical", v: batchResult.fleet.merchantsWithCritical, c: "#ef4444" },
                { label: "Calls at Risk", v: batchResult.fleet.totalCallsAtRisk.toLocaleString(), c: "#eab308" },
              ].map(k => (
                <div key={k.label} style={{ background: "#0d1117", border: `1px solid ${k.c}22`, borderRadius: 7, padding: "10px", textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: k.c }}>{k.v}</div>
                  <div style={{ fontSize: 10, color: "white" }}>{k.label}</div>
                </div>
              ))}
            </div>

            {/* Top failures */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>TOP FAILURE CODES ACROSS FLEET</div>
              <div style={{ display: "flex", gap: 6 }}>
                {batchResult.fleet.topFailures.map(f => (
                  <div key={f.code} style={{ background: "#0d1117", border: "1px solid #ef444433", borderRadius: 7, padding: "8px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#ef4444" }}>{f.count}</div>
                    <div style={{ fontSize: 10, color: "#f87171", fontFamily: "monospace" }}>{f.code}</div>
                    <div style={{ fontSize: 7, color: "#ccc" }}>{f.pct}% of fleet</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-merchant results */}
            <div style={{ fontSize: 9, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>PER-MERCHANT BREAKDOWN</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {batchResult.merchantResults.map(({ merchant, summary, failures }) => {
                const tier = getRiskTier(merchant);
                const ts = RISK_TIER_STYLE[tier];
                return (
                  <div key={merchant.id} style={{ background: "#0d1117", border: `1px solid ${ts.bd}33`, borderRadius: 7, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 16 }}>{merchant.avatar}</span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{merchant.business_name}</div>
                          <div style={{ fontSize: 10, color: "white" }}>PB {merchant.paybill} · {formatKES(merchant.balance)}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: ts.color }}>{ts.label}</span>
                        <span style={{ fontSize: 10, color: "white" }}>{summary.passing}/{summary.total} pass</span>
                        <span style={{ fontSize: 10, color: "#eab308" }}>{summary.callsAtRisk.toLocaleString()} calls at risk</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {failures.slice(0, 5).map(f => {
                        const s = SEV[f.severity];
                        return (
                          <span key={f.code} style={{ fontSize: 7, background: s.badge + "22", color: s.badge, padding: "2px 6px", borderRadius: 3, fontWeight: 700, fontFamily: "monospace" }}>
                            {s.icon} {f.code}
                          </span>
                        );
                      })}
                      {failures.length > 5 && <span style={{ fontSize: 7, color: "#ccc" }}>+{failures.length - 5} more</span>}
                      {failures.length === 0 && <span style={{ fontSize: 7, color: "#4ade80" }}>✓ All passing</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}