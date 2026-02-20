// merchantDataModelViewer.jsx
// Visual explorer for Step 1 — merchantDataModel.js

import { useState } from "react";
import {
  MERCHANT_REGISTRY,
  MERCHANT_SCHEMA,
  SENSOR_FIELDS,
  generateMerchant,
  generateMerchantBatch,
  getRiskTier,
  RISK_TIER_STYLE,
  getSensorHealth,
  formatKES,
  applySimSwap,
  applyPinAttempt,
  applyPinReset,
  applyAccountSuspend,
  applyAccountReactivate,
  applyKycRenewal,
  applyTransaction,
  advanceDays,
} from "./merchantDataModel";

const MUTATIONS = [
  { key: "applySimSwap",          label: "SIM Swap",         fn: applySimSwap,          icon: "📱" },
  { key: "applyPinAttempt",       label: "Failed PIN",       fn: applyPinAttempt,        icon: "🔐" },
  { key: "applyPinReset",         label: "Reset PIN",        fn: applyPinReset,          icon: "✅" },
  { key: "applyAccountSuspend",   label: "Suspend Account",  fn: applyAccountSuspend,    icon: "🚫" },
  { key: "applyAccountReactivate",label: "Reactivate",       fn: applyAccountReactivate, icon: "♻️" },
  { key: "applyKycRenewal",       label: "KYC Renewal",      fn: applyKycRenewal,        icon: "📋" },
  { key: "applyTransaction",      label: "+KES 5,000",       fn: (m) => applyTransaction(m, 5000), icon: "💸" },
  { key: "advanceDays30",         label: "Advance 30 Days",  fn: (m) => advanceDays(m, 30), icon: "📅" },
  { key: "advanceDays90",         label: "Advance 90 Days",  fn: (m) => advanceDays(m, 90), icon: "⏩" },
];

function SensorBadge({ value, good, warn }) {
  const v = String(value).toLowerCase();
  const isGood = v === String(good).toLowerCase();
  const isWarn = warn && v === String(warn).toLowerCase();
  const color = isGood ? "#4ade80" : isWarn ? "#fbbf24" : "#f87171";
  return (
    <span style={{ color, fontWeight: 700, fontSize: 10, textTransform: "uppercase", fontFamily: "monospace" }}>
      {String(value)}
    </span>
  );
}

export default function MerchantDataModelViewer() {
  const [registry, setRegistry] = useState([...MERCHANT_REGISTRY]);
  const [selected, setSelected] = useState(MERCHANT_REGISTRY[0]);
  const [activeTab, setActiveTab] = useState("registry"); // registry | schema | generator | mutations
  const [mutationLog, setMutationLog] = useState([]);
  const [genCount, setGenCount] = useState(3);
  const [generated, setGenerated] = useState([]);

  const applyMutation = (mutDef) => {
    const updated = mutDef.fn(selected);
    setSelected(updated);
    setRegistry(prev => prev.map(m => m.id === selected.id ? updated : m));
    setMutationLog(prev => [{
      ts: new Date().toLocaleTimeString("en-KE", { hour12: false }),
      label: mutDef.label,
      merchantName: selected.business_name,
      mutation: mutDef.key,
    }, ...prev].slice(0, 20));
  };

  const runGenerator = () => {
    const batch = generateMerchantBatch(genCount);
    setGenerated(batch);
  };

  const tabs = [
    { id: "registry",  label: "📋 Registry",   desc: "5 curated merchants" },
    { id: "schema",    label: "🗂️ Schema",      desc: "All fields defined" },
    { id: "mutations", label: "⚡ Mutations",   desc: "State change functions" },
    { id: "generator", label: "🎲 Generator",   desc: "Random merchant factory" },
  ];

  return (
    <div style={{ background: "#060a0f", color: "#e2e8f0", minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#080b10", borderBottom: "1px solid #1e2730", padding: "10px 20px" }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>
          🗄️ Step 1 — <span style={{ color: "#00a651" }}>Merchant Data Model</span>
          <span style={{ fontSize: 10, color: "#374151", fontWeight: 400, marginLeft: 10 }}>merchantDataModel.js</span>
        </div>
        <div style={{ fontSize: 9, color: "#374151" }}>
          Physical layer · Schema · Registry · Generator · Mutations · Utilities
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ background: "#0a0e14", borderBottom: "1px solid #1e2730", display: "flex", padding: "0 20px" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            background: "none", border: "none",
            borderBottom: activeTab === t.id ? "2px solid #00a651" : "2px solid transparent",
            color: activeTab === t.id ? "#e2e8f0" : "#4b5563",
            padding: "8px 14px", cursor: "pointer", fontSize: 11, fontWeight: 600,
          }}>
            {t.label}
            <span style={{ fontSize: 8, color: "#374151", marginLeft: 5 }}>{t.desc}</span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>

        {/* ── REGISTRY TAB */}
        {activeTab === "registry" && (
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 14 }}>
            {/* Merchant list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ fontSize: 9, color: "#4b5563", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>MERCHANT REGISTRY</div>
              {registry.map(m => {
                const tier = getRiskTier(m);
                const ts = RISK_TIER_STYLE[tier];
                return (
                  <button key={m.id} onClick={() => setSelected(m)} style={{
                    background: selected.id === m.id ? "rgba(0,166,81,0.1)" : "rgba(255,255,255,0.02)",
                    border: selected.id === m.id ? "1px solid rgba(0,166,81,0.5)" : "1px solid #1e2730",
                    borderRadius: 7, padding: "9px 11px", cursor: "pointer", textAlign: "left",
                  }}>
                    <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                      <span style={{ fontSize: 18 }}>{m.avatar}</span>
                      <div>
                        <div style={{ color: "#e2e8f0", fontSize: 10, fontWeight: 600 }}>{m.business_name}</div>
                        <div style={{ fontSize: 8, color: "#4b5563" }}>PB {m.paybill}</div>
                        <div style={{ fontSize: 8, color: ts.color, fontWeight: 700 }}>{tier}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Full merchant detail */}
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {/* Identity */}
                <div style={{ background: "#0d1117", border: "1px solid #1e2730", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>IDENTITY</div>
                  {[
                    ["Name", `${selected.first_name} ${selected.middle_name} ${selected.last_name}`],
                    ["DOB", selected.date_of_birth],
                    ["Gender", selected.gender],
                    ["ID Type", selected.document_type],
                    ["ID Number", selected.document_number],
                    ["Nationality", selected.nationality],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 9, color: "#4b5563" }}>{k}</span>
                      <span style={{ fontSize: 9, color: "#94a3b8", fontFamily: "monospace" }}>{v}</span>
                    </div>
                  ))}
                </div>

                {/* Business */}
                <div style={{ background: "#0d1117", border: "1px solid #1e2730", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>BUSINESS</div>
                  {[
                    ["Name", selected.business_name],
                    ["Category", selected.business_category],
                    ["Paybill", selected.paybill],
                    ["KRA PIN", selected.kra_pin],
                    ["Certificate", selected.certificate_number],
                    ["Product", selected.product],
                    ["Balance", formatKES(selected.balance)],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 9, color: "#4b5563" }}>{k}</span>
                      <span style={{ fontSize: 9, color: "#94a3b8", fontFamily: "monospace" }}>{v}</span>
                    </div>
                  ))}
                </div>

                {/* Sensor fields — the "live" data the twin reads */}
                <div style={{ background: "#0d1117", border: "1px solid #00a65122", borderRadius: 8, padding: 12, gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 9, color: "#00a651", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
                    📡 SENSOR FIELDS (live state monitored by twin)
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                    {[
                      { k: "account_status",        v: selected.account_status,        good: "active" },
                      { k: "kyc_status",            v: selected.kyc_status,            good: "verified", warn: "pending" },
                      { k: "kyc_age_days",          v: selected.kyc_age_days + "d",    good_fn: () => selected.kyc_age_days < 365 },
                      { k: "sim_status",            v: selected.sim_status,            good: "active", warn: "swapped" },
                      { k: "sim_swap_days_ago",     v: selected.sim_swap_days_ago ?? "null", good: "null" },
                      { k: "pin_attempts",          v: `${selected.pin_attempts}/3`,   good_fn: () => selected.pin_attempts === 0 },
                      { k: "pin_locked",            v: String(selected.pin_locked),    good: "false" },
                      { k: "start_key_status",      v: selected.start_key_status,      good: "valid" },
                      { k: "balance",               v: formatKES(selected.balance),    good_fn: () => selected.balance > 0 },
                      { k: "dormant_days",          v: selected.dormant_days + "d",    good_fn: () => selected.dormant_days < 30 },
                      { k: "notifications_enabled", v: String(selected.notifications_enabled), good: "true" },
                      { k: "settlement_on_hold",    v: String(selected.settlement_on_hold),    good: "false" },
                      { k: "operator_dormant_days", v: selected.operator_dormant_days + "d",   good_fn: () => selected.operator_dormant_days < 60 },
                    ].map(({ k, v, good, warn, good_fn }) => {
                      const isGood = good_fn ? good_fn() : String(v).toLowerCase() === String(good).toLowerCase();
                      const isWarn = warn && String(v).toLowerCase() === String(warn).toLowerCase();
                      const color = isGood ? "#4ade80" : isWarn ? "#fbbf24" : "#f87171";
                      return (
                        <div key={k} style={{ background: "#080b10", borderRadius: 5, padding: "6px 8px" }}>
                          <div style={{ fontSize: 10, color: "#374151", marginBottom: 2, fontFamily: "monospace" }}>{k}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color, textTransform: "uppercase" }}>{v}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Bank */}
                <div style={{ background: "#0d1117", border: "1px solid #1e2730", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>BANK DETAILS</div>
                  {[
                    ["Bank", selected.bank],
                    ["Branch", selected.bank_branch],
                    ["Account Name", selected.bank_account_name],
                    ["Account No.", selected.bank_account],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 9, color: "#4b5563" }}>{k}</span>
                      <span style={{ fontSize: 9, color: "#94a3b8", fontFamily: "monospace" }}>{v}</span>
                    </div>
                  ))}
                </div>

                {/* Contact */}
                <div style={{ background: "#0d1117", border: "1px solid #1e2730", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>CONTACT</div>
                  {[
                    ["Phone", selected.phone_number],
                    ["Email", selected.email],
                    ["County", selected.county],
                    ["Address", selected.physical_address],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 9, color: "#4b5563" }}>{k}</span>
                      <span style={{ fontSize: 9, color: "#94a3b8", fontFamily: "monospace" }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SCHEMA TAB */}
        {activeTab === "schema" && (
          <div>
            <div style={{ fontSize: 9, color: "#374151", marginBottom: 12 }}>
              Full MERCHANT_SCHEMA definition — every field, type, description, and whether it is a live sensor monitored by the twin.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              {Object.entries(MERCHANT_SCHEMA).map(([field, def]) => (
                <div key={field} style={{
                  background: def.sensor ? "rgba(0,166,81,0.04)" : "#0d1117",
                  border: `1px solid ${def.sensor ? "#00a65133" : "#1e2730"}`,
                  borderRadius: 6, padding: "7px 10px",
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8,
                }}>
                  <div>
                    <div style={{ fontSize: 9, fontFamily: "monospace", color: def.sensor ? "#4ade80" : "#94a3b8", fontWeight: 600 }}>{field}</div>
                    <div style={{ fontSize: 8, color: "#4b5563", marginTop: 2, lineHeight: 1.4 }}>{def.description}</div>
                    {def.values && (
                      <div style={{ fontSize: 7, color: "#374151", marginTop: 2 }}>
                        values: {def.values.join(" | ")}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end", flexShrink: 0 }}>
                    <span style={{ fontSize: 7, background: "#161b22", color: "#6b7280", padding: "1px 5px", borderRadius: 3, fontFamily: "monospace" }}>{def.type}</span>
                    {def.sensor && (
                      <span style={{ fontSize: 7, background: "rgba(0,166,81,0.15)", color: "#00a651", padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>📡 SENSOR</span>
                    )}
                    {def.nullable && (
                      <span style={{ fontSize: 7, background: "#1e2730", color: "#374151", padding: "1px 5px", borderRadius: 3 }}>nullable</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── MUTATIONS TAB */}
        {activeTab === "mutations" && (
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14 }}>
            <div>
              <div style={{ fontSize: 9, color: "#4b5563", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>
                SELECTED MERCHANT
              </div>
              <div style={{ background: "#0d1117", border: "1px solid #1e2730", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                <div style={{ fontSize: 13 }}>{selected.avatar}</div>
                <div style={{ fontWeight: 700, fontSize: 11, marginTop: 4 }}>{selected.business_name}</div>
                <div style={{ fontSize: 8, color: "#4b5563" }}>PB {selected.paybill}</div>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                  {[
                    ["account_status", selected.account_status, "active"],
                    ["kyc_status", selected.kyc_status, "verified"],
                    ["pin_attempts", `${selected.pin_attempts}/3`, "0/3"],
                    ["pin_locked", String(selected.pin_locked), "false"],
                    ["sim_status", selected.sim_status, "active"],
                    ["balance", formatKES(selected.balance), null],
                    ["dormant_days", `${selected.dormant_days}d`, "0d"],
                  ].map(([k, v, good]) => {
                    const color = good === null ? "#94a3b8" : v === good ? "#4ade80" : "#f87171";
                    return (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 8, color: "#374151", fontFamily: "monospace" }}>{k}</span>
                        <span style={{ fontSize: 8, color, fontWeight: 700 }}>{v}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ fontSize: 9, color: "#4b5563", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>APPLY MUTATION</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {MUTATIONS.map(mut => (
                  <button key={mut.key} onClick={() => applyMutation(mut)} style={{
                    background: "#161b22", border: "1px solid #21262d", color: "#e2e8f0",
                    borderRadius: 6, padding: "8px 10px", cursor: "pointer", textAlign: "left",
                    display: "flex", gap: 6, alignItems: "center", fontSize: 10,
                    transition: "border-color 0.15s",
                  }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#00a651"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#21262d"}>
                    <span>{mut.icon}</span> {mut.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mutation log */}
            <div>
              <div style={{ fontSize: 9, color: "#4b5563", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>MUTATION LOG</div>
              {mutationLog.length === 0 && (
                <div style={{ color: "#374151", fontSize: 11, textAlign: "center", marginTop: 40 }}>
                  Apply a mutation to see state changes here
                </div>
              )}
              {mutationLog.map((log, i) => (
                <div key={i} style={{ background: "#0d1117", border: "1px solid #1e2730", borderRadius: 6, padding: "8px 10px", marginBottom: 5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: "#00a651", fontWeight: 700 }}>{log.label}</span>
                    <span style={{ fontSize: 8, color: "#374151", fontFamily: "monospace" }}>{log.ts}</span>
                  </div>
                  <div style={{ fontSize: 9, color: "#4b5563" }}>{log.merchantName}</div>
                  <div style={{ fontSize: 8, color: "#374151", fontFamily: "monospace", marginTop: 2 }}>{log.mutation}(merchant)</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── GENERATOR TAB */}
        {activeTab === "generator" && (
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: "#4b5563" }}>Generate</div>
              <input type="number" min={1} max={50} value={genCount} onChange={e => setGenCount(Number(e.target.value))}
                style={{ width: 60, background: "#161b22", border: "1px solid #21262d", color: "#e2e8f0", borderRadius: 5, padding: "5px 8px", fontSize: 11, outline: "none" }} />
              <div style={{ fontSize: 9, color: "#4b5563" }}>merchants with weighted random sensor states</div>
              <button onClick={runGenerator} style={{ background: "#00a651", color: "white", border: "none", borderRadius: 6, padding: "7px 16px", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
                Generate
              </button>
            </div>
            <div style={{ fontSize: 8, color: "#374151", marginBottom: 14, lineHeight: 1.6 }}>
              Weights reflect real call center failure distribution (Oct–Dec 2025):
              account_status: 65% active · 25% suspended · 10% frozen |
              kyc_status: 60% verified · 20% pending · 20% expired |
              sim_status: 75% active · 20% swapped |
              pin_attempts: 55% zero · 10% locked
            </div>
            {generated.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                {generated.map(m => {
                  const tier = getRiskTier(m);
                  const ts = RISK_TIER_STYLE[tier];
                  const { red, amber, green } = getSensorHealth(m);
                  return (
                    <div key={m.id} style={{ background: "#0d1117", border: `1px solid ${ts.bd}33`, borderRadius: 8, padding: 12 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: 20 }}>{m.avatar}</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 11 }}>{m.business_name}</div>
                          <div style={{ fontSize: 8, color: "#4b5563" }}>{m.phone_number} · PB {m.paybill}</div>
                          <div style={{ fontSize: 8, color: ts.color, fontWeight: 700 }}>{ts.label}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 2, height: 4, borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
                        <div style={{ flex: green.length, background: "#4ade80" }} />
                        <div style={{ flex: amber.length, background: "#fbbf24" }} />
                        <div style={{ flex: red.length, background: "#f87171" }} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                        {[
                          ["Account", m.account_status, "active"],
                          ["KYC", m.kyc_status, "verified"],
                          ["SIM", m.sim_status, "active"],
                          ["PIN locked", String(m.pin_locked), "false"],
                          ["Start Key", m.start_key_status, "valid"],
                          ["Dormant", `${m.dormant_days}d`, "0d"],
                        ].map(([k, v, good]) => (
                          <div key={k} style={{ display: "flex", justifyContent: "space-between", background: "#080b10", borderRadius: 3, padding: "2px 5px" }}>
                            <span style={{ fontSize: 7, color: "#374151" }}>{k}</span>
                            <span style={{ fontSize: 7, fontWeight: 700, color: v === good ? "#4ade80" : "#f87171", textTransform: "uppercase" }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}