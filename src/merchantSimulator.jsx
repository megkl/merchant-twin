// ═══════════════════════════════════════════════════════════════════════════
// MERCHANT INTERACTION SIMULATOR  —  Step 3 of 4
// Safaricom LNM Merchant Digital Twin
//
// This file is now a pure UI layer. All data and logic live in:
//   Step 1 → merchantDataModel.js   (merchant schema, registry, generator, mutations)
//   Step 2 → failureRulesEngine.js  (12 rules, evaluator, pre-scanner, batch scanner)
//
// Three channels rendered side-by-side:
//   📱 M-PESA Business App    (tap-through mobile UI)
//   📟 USSD *234#             (exact Safaricom menu tree, keypad navigation)
//   🌐 Merchant Web Portal    (business.safaricom.co.ke)
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";

// ── Step 1: Data layer
import {
  MERCHANT_REGISTRY,
  generateMerchant,
  generateMerchantBatch,
  getRiskTier,
  RISK_TIER_STYLE,
  getSensorHealth,
  formatKES,
} from "./merchantDataModel.js";

// ── Step 2: Rules layer
import {
  evaluateAction,
  scanAllFailures,
  getMerchantSummary,
  MENU_STRUCTURE,
  RULE_METADATA,
} from "./failureRulesEngine.js";


// ─────────────────────────────────────────────────────────────────────────────
// SEVERITY CONFIG — visual treatment per severity level
// ─────────────────────────────────────────────────────────────────────────────
const SEV = {
  critical: { bd: "#ef4444", bg: "#1a0000", badge: "#ef4444", icon: "🔴", label: "CRITICAL" },
  high:     { bd: "#f97316", bg: "#1a0900", badge: "#f97316", icon: "🟠", label: "HIGH" },
  medium:   { bd: "#eab308", bg: "#1a1500", badge: "#eab308", icon: "🟡", label: "MEDIUM" },
  low:      { bd: "#60a5fa", bg: "#00102a", badge: "#60a5fa", icon: "🔵", label: "LOW" },
};


// ─────────────────────────────────────────────────────────────────────────────
// SHARED: FAILURE PANEL
// Used identically across all three channels to surface failure detail.
// ─────────────────────────────────────────────────────────────────────────────
function FailurePanel({ result, onBack }) {
  if (!result) return null;
  const s = result.success !== true ? SEV[result.severity] || SEV.low : null;

  return (
    <div style={{
      border: `1px solid ${s ? s.bd : "#00a651"}`,
      borderLeft: `4px solid ${s ? s.bd : "#00a651"}`,
      background: s ? s.bg : "#001408",
      borderRadius: 8, padding: "12px 13px",
    }}>
      {/* Status row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 14 }}>
            {result.success === true ? "✅" : result.success === "warn" ? "⚠️" : "❌"}
          </span>
          <span style={{ fontWeight: 800, fontSize: 14, color: result.success === true ? "#4ade80" : s?.badge }}>
            {result.success === true ? "SUCCESS" : result.success === "warn" ? "WARNING" : "FAILED"}
          </span>
          {result.code && result.code !== "OK" && (
            <span style={{ fontFamily: "monospace", fontSize: 9, color: "white" }}>[{result.code}]</span>
          )}
          {s && (
            <span style={{ fontSize: 9, background: s.badge + "22", color: s.badge, padding: "1px 6px", borderRadius: 3, fontWeight: 700 }}>
              {s.label}
            </span>
          )}
        </div>
        {onBack && (
          <button onClick={onBack} style={{ background: "none", border: "none", color: "white", cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
        )}
      </div>

      {/* Inline message */}
      <p style={{ fontSize: 14, color: "#e2e8f0", margin: "0 0 8px", lineHeight: 1.55 }}>
        {result.inline}
      </p>

      {/* Failure detail blocks */}
      {!result.success && (
        <>
          <div style={{ background: "rgba(0,0,0,0.35)", borderRadius: 6, padding: "8px 10px", marginBottom: 7 }}>
            <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>WHY THIS HAPPENED</div>
            <p style={{ fontSize: 11, color: "#cbd5e1", margin: 0, lineHeight: 1.5 }}>{result.reason}</p>
          </div>
          <div style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.18)", borderRadius: 6, padding: "8px 10px", marginBottom: 7 }}>
            <div style={{ fontSize: 10, color: "#eab308", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>💡 HOW TO FIX</div>
            <p style={{ fontSize: 11, color: "#cbd5e1", margin: 0, lineHeight: 1.5 }}>{result.fix}</p>
          </div>
          <div style={{ background: "rgba(99,179,237,0.06)", border: "1px solid rgba(99,179,237,0.15)", borderRadius: 6, padding: "8px 10px" }}>
            <div style={{ fontSize: 10, color: "#7dd3fc", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>ESCALATION</div>
            <p style={{ fontSize: 11, color: "#bae6fd", margin: 0 }}>{result.escalation}</p>
          </div>
        </>
      )}

      {/* Warning detail */}
      {result.success === "warn" && (
        <>
          <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 6, padding: "8px 10px", marginBottom: 7 }}>
            <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>WHY THIS HAPPENED</div>
            <p style={{ fontSize: 11, color: "#cbd5e1", margin: 0, lineHeight: 1.5 }}>{result.reason}</p>
          </div>
          <div style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.18)", borderRadius: 6, padding: "8px 10px" }}>
            <div style={{ fontSize: 10, color: "#eab308", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>💡 HOW TO FIX</div>
            <p style={{ fontSize: 11, color: "#cbd5e1", margin: 0, lineHeight: 1.5 }}>{result.fix}</p>
          </div>
        </>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL 1 — M-PESA BUSINESS APP
// ─────────────────────────────────────────────────────────────────────────────
function AppChannel({ merchant }) {
  const [screen, setScreen] = useState("home");
  const [activeMenu, setActiveMenu] = useState(null);
  const [activeItem, setActiveItem] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => { setScreen("home"); setActiveMenu(null); setActiveItem(null); setResult(null); }, [merchant.id]);

  const goBack = () => {
    if (screen === "result") { setScreen("menu"); setResult(null); }
    else if (screen === "confirm") setScreen("menu");
    else if (screen === "menu") { setScreen("home"); setActiveMenu(null); }
  };

  const confirm = () => {
    setResult(evaluateAction(merchant, activeItem.id));
    setScreen("result");
  };

  const tier = getRiskTier(merchant);
  const tierStyle = RISK_TIER_STYLE[tier];

  return (
    <div style={{ background: "#0d1117", borderRadius: 20, overflow: "hidden", border: "1px solid #21262d", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.6)" }}>
      {/* Notch */}
      <div style={{ background: "#080b10", height: 10, display: "flex", justifyContent: "center", alignItems: "center" }}>
        <div style={{ width: 44, height: 4, background: "#1e2730", borderRadius: 2 }} />
      </div>

      {/* Status bar */}
      <div style={{ background: "#00a651", padding: "5px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {screen !== "home" && (
            <button onClick={goBack} style={{ background: "none", border: "none", color: "white", cursor: "pointer", fontSize: 17, padding: "0 5px 0 0", lineHeight: 1 }}>‹</button>
          )}
          <span style={{ color: "white", fontSize: 14, fontWeight: 800, letterSpacing: 0.5 }}>M-PESA Business</span>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: merchant.account_status === "active" ? "#a7f3d0" : "#fca5a5" }} />
          <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 10 }}>{merchant.phone_number}</span>
        </div>
      </div>

      {/* Screen */}
      <div style={{ padding: 12, minHeight: 470, display: "flex", flexDirection: "column" }}>

        {/* HOME */}
        {screen === "home" && (
          <>
            {/* Balance card */}
            <div style={{ background: "linear-gradient(140deg, #005520, #009940)", borderRadius: 14, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 22 }}>{merchant.avatar}</div>
                <div>
                  <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>{merchant.business_name}</div>
                  <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 9 }}>PB {merchant.paybill} · {merchant.county}</div>
                </div>
              </div>
              <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 9 }}>Available Balance</div>
              <div style={{ color: "white", fontSize: 22, fontWeight: 800, letterSpacing: -0.5, marginBottom: 8 }}>{formatKES(merchant.balance)}</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 700, background: merchant.account_status === "active" ? "rgba(255,255,255,0.2)" : "rgba(239,68,68,0.5)", color: "white" }}>
                  {merchant.account_status.toUpperCase()}
                </span>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 700, background: merchant.kyc_status === "verified" ? "rgba(255,255,255,0.15)" : "rgba(234,179,8,0.5)", color: "white" }}>
                  KYC {merchant.kyc_status.toUpperCase()}
                </span>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, fontWeight: 700, background: tierStyle.bd + "44", color: tierStyle.color }}>
                  {tier}
                </span>
              </div>
            </div>

            <div style={{ fontSize: 9, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>SERVICES</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
              {MENU_STRUCTURE.map(m => (
                <button key={m.id} onClick={() => { setActiveMenu(m); setScreen("menu"); setResult(null); }}
                  style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 10, padding: "12px 10px", cursor: "pointer", textAlign: "left", transition: "border-color 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#00a651"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#21262d"}>
                  <div style={{ fontSize: 20, marginBottom: 5 }}>{m.icon}</div>
                  <div style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600 }}>{m.label}</div>
                  <div style={{ color: "white", fontSize: 10, marginTop: 2 }}>{m.items.length} services</div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* MENU */}
        {screen === "menu" && activeMenu && (
          <>
            <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 13, marginBottom: 12 }}>{activeMenu.icon} {activeMenu.label}</div>
            {activeMenu.items.map(item => {
              const preCheck = evaluateAction(merchant, item.id);
              return (
                <button key={item.id} onClick={() => { setActiveItem(item); setScreen("confirm"); }}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "#161b22", border: `1px solid ${!preCheck.success ? SEV[preCheck.severity]?.bd + "55" : "#21262d"}`, borderRadius: 8, padding: "12px 14px", marginBottom: 6, cursor: "pointer", transition: "all 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#00a651"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = !preCheck.success ? SEV[preCheck.severity]?.bd + "55" : "#21262d"}>
                  <div>
                    <span style={{ color: "#e2e8f0", fontSize: 14 }}>{item.label}</span>
                    {!preCheck.success && (
                      <div style={{ fontSize: 10, color: SEV[preCheck.severity]?.badge, marginTop: 2 }}>
                        {SEV[preCheck.severity]?.icon} Predicted failure · {preCheck.code}
                      </div>
                    )}
                  </div>
                  <span style={{ color: "white", fontSize: 16 }}>›</span>
                </button>
              );
            })}
          </>
        )}

        {/* CONFIRM */}
        {screen === "confirm" && activeItem && (
          <div style={{ textAlign: "center", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 14 }}>⚡</div>
            <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Confirm action for</div>
            <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{activeItem.label}</div>
            <div style={{ color: "white", fontSize: 14, marginBottom: 22 }}>{merchant.business_name}</div>
            <button onClick={confirm} style={{ width: "100%", background: "#00a651", color: "white", border: "none", borderRadius: 9, padding: "13px", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>
              Confirm
            </button>
            <button onClick={() => setScreen("menu")} style={{ width: "100%", background: "#1e2730", color: "#94a3b8", border: "none", borderRadius: 9, padding: "11px", fontSize: 14, cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        )}

        {/* RESULT */}
        {screen === "result" && result && (
          <FailurePanel result={result} onBack={() => { setScreen("home"); setResult(null); }} />
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ background: "#080b10", borderTop: "1px solid #1e2730", display: "flex", justifyContent: "space-around", padding: "8px 0" }}>
        {["🏠","📊","🔔","👤"].map((ic, i) => (
          <button key={i} onClick={() => i === 0 && setScreen("home")} style={{ background: "none", border: "none", fontSize: 17, cursor: "pointer", opacity: i === 0 ? 1 : 0.25 }}>{ic}</button>
        ))}
      </div>
      <div style={{ background: "#080b10", display: "flex", justifyContent: "center", paddingBottom: 8 }}>
        <div style={{ width: 50, height: 4, background: "#1e2730", borderRadius: 2 }} />
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL 2 — USSD *234#
// ─────────────────────────────────────────────────────────────────────────────
function USSDChannel({ merchant }) {
  const [msgs, setMsgs] = useState([]);
  const [phase, setPhase] = useState("idle");
  const [activeMenu, setActiveMenu] = useState(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => { setMsgs([]); setPhase("idle"); setActiveMenu(null); setInput(""); setResult(null); }, [merchant.id]);

  const mainMenuText = () =>
    `CON M-PESA Business\n${merchant.business_name}\nPaybill: ${merchant.paybill}\n\n` +
    MENU_STRUCTURE.map(m => `${m.ussd}. ${m.label}`).join("\n") +
    "\n\n0. Exit";

  const subMenuText = (menu) =>
    `CON ${menu.label}\n\n` +
    menu.items.map(i => `${i.ussd}. ${i.label}`).join("\n") +
    "\n\n0. Back  00. Main Menu";

  const resultText = (r, label) => {
    if (r.success === true) return `END ✓ ${label}\n\n${r.inline}`;
    if (r.success === "warn") return `END ⚠ ${label}\n\n${r.inline}\n\nFix: ${r.fix}`;
    return [
      `END ✗ ${label}`,
      `Error: [${r.code}]`,
      ``,
      r.inline,
      ``,
      `WHY: ${r.reason}`,
      ``,
      `FIX: ${r.fix}`,
      ``,
      r.escalation,
    ].join("\n");
  };

  const push = txt => setMsgs(h => [...h, txt]);

  const send = () => {
    const v = input.trim(); setInput("");
    if (phase === "idle") {
      if (v === "*234#" || v === "*234") { push(mainMenuText()); setPhase("main"); }
      else push("Invalid. Dial *234# to access M-PESA Business.");
      return;
    }
    if (v === "0") { setMsgs([]); setPhase("idle"); setActiveMenu(null); setResult(null); return; }
    if (v === "00") { push(mainMenuText()); setPhase("main"); setActiveMenu(null); return; }
    if (phase === "main") {
      const menu = MENU_STRUCTURE.find(x => x.ussd === v);
      if (menu) { push(subMenuText(menu)); setActiveMenu(menu); setPhase("sub"); }
      else push(`CON Invalid option '${v}'.\n\n` + MENU_STRUCTURE.map(m => `${m.ussd}. ${m.label}`).join("\n") + "\n\n0. Exit");
      return;
    }
    if (phase === "sub" && activeMenu) {
      const item = activeMenu.items.find(i => i.ussd === v);
      if (item) {
        const r = evaluateAction(merchant, item.id);
        setResult(r);
        push(resultText(r, item.label));
        setPhase("end");
      } else {
        push(`CON Invalid '${v}'.\n\n` + activeMenu.items.map(i => `${i.ussd}. ${i.label}`).join("\n") + "\n\n0. Back  00. Main");
      }
    }
  };

  return (
    <div style={{ background: "#0d1117", borderRadius: 20, overflow: "hidden", border: "1px solid #21262d", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.6)" }}>
      <div style={{ background: "#080b10", padding: "8px 14px", borderBottom: "1px solid #1e2730", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 9, color: "white", fontWeight: 700, letterSpacing: 1 }}>USSD SIMULATOR</span>
        <span style={{ fontSize: 14, color: "#00a651", fontWeight: 700 }}>*234#</span>
      </div>

      {/* Phone screen */}
      <div style={{ background: "#071007", margin: 12, borderRadius: 8, border: "1px solid #0d2010", minHeight: 300, fontFamily: "'Courier New', monospace", padding: 12, display: "flex", flexDirection: "column" }}>
        {msgs.length === 0 ? (
          <div style={{ color: "#1a4a20", fontSize: 11, textAlign: "center", marginTop: 60, lineHeight: 2.2 }}>
            Type <span style={{ color: "#00a651", fontWeight: 700 }}>*234#</span><br />then press SEND
          </div>
        ) : (
          <pre style={{ color: "#86efac", fontSize: 14, margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.65 }}>
            {msgs[msgs.length - 1]}
          </pre>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: "0 12px 8px", display: "flex", gap: 6 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
          placeholder={phase === "idle" ? "Dial *234#" : "Enter option..."}
          style={{ flex: 1, background: "#161b22", border: "1px solid #21262d", borderRadius: 6, padding: "8px 10px", color: "#e2e8f0", fontSize: 14, fontFamily: "monospace", outline: "none" }}
        />
        <button onClick={send} style={{ background: "#00a651", color: "white", border: "none", borderRadius: 6, padding: "8px 14px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>SEND</button>
      </div>

      {/* Keypad */}
      <div style={{ padding: "0 12px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4 }}>
          {["1","2","3","4","5","6","7","8","9","*","0","#"].map(k => (
            <button key={k} onClick={() => setInput(v => v + k)} style={{ background: "#161b22", border: "1px solid #21262d", color: "#e2e8f0", borderRadius: 5, padding: "8px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{k}</button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 4 }}>
          <button onClick={() => setInput(v => v.slice(0, -1))} style={{ background: "#1e2730", border: "1px solid #21262d", color: "#94a3b8", borderRadius: 5, padding: "8px", fontSize: 11, cursor: "pointer" }}>⌫ DEL</button>
          <button onClick={() => { setMsgs([]); setPhase("idle"); setActiveMenu(null); setResult(null); setInput(""); }} style={{ background: "#1e2730", border: "1px solid #21262d", color: "#ef4444", borderRadius: 5, padding: "8px", fontSize: 11, cursor: "pointer" }}>END</button>
        </div>
      </div>

      {result && phase === "end" && (
        <div style={{ padding: "0 12px 12px" }}>
          <FailurePanel result={result} onBack={null} />
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL 3 — WEB PORTAL
// ─────────────────────────────────────────────────────────────────────────────
function WebChannel({ merchant }) {
  const [tab, setTab] = useState(null);
  const [result, setResult] = useState(null);
  const [activeItem, setActiveItem] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setTab(null); setResult(null); setActiveItem(null); }, [merchant.id]);

  const run = item => {
    setLoading(true); setResult(null); setActiveItem(item);
    setTimeout(() => { setResult(evaluateAction(merchant, item.id)); setLoading(false); }, 500);
  };

  const { red, amber, green, score } = getSensorHealth(merchant);
  const tier = getRiskTier(merchant);
  const tierStyle = RISK_TIER_STYLE[tier];

  return (
    <div style={{ background: "#0d1117", borderRadius: 12, overflow: "hidden", border: "1px solid #21262d", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,0.6)" }}>
      {/* Browser chrome */}
      <div style={{ background: "#080b10", padding: "8px 12px", borderBottom: "1px solid #1e2730" }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
          {["#ef4444","#f97316","#4ade80"].map(c => <div key={c} style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />)}
        </div>
        <div style={{ background: "#161b22", borderRadius: 4, padding: "4px 10px", fontSize: 9, color: "white", fontFamily: "monospace" }}>
          🔒 business.safaricom.co.ke/portal/{merchant.paybill}
        </div>
      </div>

      {/* Portal header */}
      <div style={{ background: "linear-gradient(90deg, #001f0f, #004a20)", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 20 }}>{merchant.avatar}</span>
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>{merchant.business_name}</div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 9 }}>PB {merchant.paybill} · {merchant.county} · {merchant.bank}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "white", fontWeight: 800, fontSize: 14 }}>{formatKES(merchant.balance)}</div>
          <span style={{ fontSize: 10, color: tierStyle.color, fontWeight: 700 }}>{tierStyle.label}</span>
        </div>
      </div>

      {/* Nav tabs */}
      <div style={{ display: "flex", background: "#080b10", borderBottom: "1px solid #1e2730", overflowX: "auto" }}>
        {MENU_STRUCTURE.map(m => (
          <button key={m.id} onClick={() => { setTab(tab?.id === m.id ? null : m); setResult(null); setActiveItem(null); }}
            style={{ background: "none", border: "none", borderBottom: tab?.id === m.id ? "2px solid #00a651" : "2px solid transparent", color: tab?.id === m.id ? "#00a651" : "#6b7280", padding: "8px 12px", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ padding: 12, flex: 1, minHeight: 360 }}>
        {!tab ? (
          <>
            {/* Sensor health grid */}
            <div style={{ fontSize: 12, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>SENSOR HEALTH</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 10 }}>
              {[
                { k: "Account", v: merchant.account_status, ok: "active" },
                { k: "KYC", v: merchant.kyc_status, ok: "verified", warn: "pending" },
                { k: "PIN", v: merchant.pin_locked ? "LOCKED" : `${merchant.pin_attempts}/3`, ok_fn: () => !merchant.pin_locked },
                { k: "SIM", v: merchant.sim_status, ok: "active", warn: "swapped" },
                { k: "Start Key", v: merchant.start_key_status, ok: "valid" },
                { k: "Notif.", v: merchant.notifications_enabled ? "ON" : "OFF", ok: "ON" },
                { k: "Dormant", v: `${merchant.dormant_days}d`, ok_fn: () => merchant.dormant_days < 30, warn_fn: () => merchant.dormant_days < 60 },
                { k: "Operator", v: `${merchant.operator_dormant_days}d`, ok_fn: () => merchant.operator_dormant_days < 30, warn_fn: () => merchant.operator_dormant_days < 60 },
                { k: "Settlement", v: merchant.settlement_on_hold ? "ON HOLD" : "CLEAR", ok: "CLEAR" },
              ].map(c => {
                const val = c.v;
                const isGood = c.ok_fn ? c.ok_fn() : val.toLowerCase() === (c.ok || "").toLowerCase();
                const isWarn = c.warn_fn ? c.warn_fn() : val.toLowerCase() === (c.warn || "").toLowerCase();
                const col = isGood ? "#4ade80" : isWarn ? "#fbbf24" : "#f87171";
                return (
                  <div key={c.k} style={{ background: "#161b22", borderRadius: 6, padding: "7px 9px" }}>
                    <div style={{ fontSize: 12, color: "white", marginBottom: 2 }}>{c.k}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: col, textTransform: "uppercase" }}>{val}</div>
                  </div>
                );
              })}
            </div>

            {/* Health bar */}
            <div style={{ background: "#161b22", borderRadius: 7, padding: "8px 10px" }}>
              <div style={{ fontSize: 12, color: "white", marginBottom: 5 }}>
                Overall health: {green.length}/{green.length + amber.length + red.length} sensors OK
              </div>
              <div style={{ display: "flex", gap: 2, height: 5, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ flex: green.length, background: "#4ade80", borderRadius: "3px 0 0 3px" }} />
                <div style={{ flex: amber.length, background: "#fbbf24" }} />
                <div style={{ flex: red.length, background: "#f87171", borderRadius: "0 3px 3px 0" }} />
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
              {tab.items.map(item => {
                const preCheck = evaluateAction(merchant, item.id);
                const isActive = activeItem?.id === item.id;
                const borderCol = isActive && result
                  ? (result.success ? "#00a651" : SEV[result.severity]?.bd)
                  : !preCheck.success ? SEV[preCheck.severity]?.bd + "44"
                  : "#21262d";

                return (
                  <button key={item.id} onClick={() => run(item)}
                    style={{ background: isActive ? "rgba(255,255,255,0.03)" : "#161b22", border: `1px solid ${borderCol}`, borderRadius: 8, padding: "11px 12px", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = "#00a651"; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = borderCol; }}>
                    <div style={{ color: "#e2e8f0", fontSize: 11, fontWeight: 600, marginBottom: 3 }}>{item.label}</div>
                    {!preCheck.success && (
                      <div style={{ fontSize: 10, color: SEV[preCheck.severity]?.badge }}>
                        {SEV[preCheck.severity]?.icon} {preCheck.code}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {loading && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "white" }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>⏳</div>
                <div style={{ fontSize: 11 }}>Processing request...</div>
              </div>
            )}

            {result && !loading && (
              <FailurePanel result={result} onBack={() => { setResult(null); setActiveItem(null); }} />
            )}
          </>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// SIDEBAR — MERCHANT SELECTOR + GENERATOR
// ─────────────────────────────────────────────────────────────────────────────
function Sidebar({ merchants, selected, onSelect, onAddGenerated, onReset }) {
  return (
    <div style={{ width: 215, background: "#080b10", borderRight: "1px solid #1e2730", padding: 12, overflowY: "auto", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 9, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>SELECT MERCHANT</div>

      {merchants.map(m => {
        const summary = getMerchantSummary(m);
        const tier = getRiskTier(m);
        const tierStyle = RISK_TIER_STYLE[tier];
        const active = selected.id === m.id;

        return (
          <button key={m.id} onClick={() => onSelect(m)} style={{
            width: "100%", background: active ? "rgba(0,166,81,0.1)" : "rgba(255,255,255,0.02)",
            border: active ? "1px solid rgba(0,166,81,0.55)" : "1px solid #1e2730",
            borderRadius: 8, padding: "9px 11px", cursor: "pointer", textAlign: "left", transition: "all 0.1s",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                <span style={{ fontSize: 16 }}>{m.avatar}</span>
                <div>
                  <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{m.business_name}</div>
                  <div style={{ color: "white", fontSize: 10 }}>{m.phone_number}</div>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 7, fontWeight: 700, color: tierStyle.color }}>{tier}</div>
                {summary.failures > 0 && (
                  <div style={{ fontSize: 7, background: "rgba(239,68,68,0.15)", color: "#f87171", borderRadius: 3, padding: "1px 4px", marginTop: 1 }}>
                    ⚠ {summary.failures}
                  </div>
                )}
              </div>
            </div>
            {/* Mini health bar */}
            <div style={{ display: "flex", gap: 1, height: 3, borderRadius: 2, overflow: "hidden", marginTop: 6 }}>
              <div style={{ flex: summary.passing, background: "#4ade80" }} />
              <div style={{ flex: summary.warnings, background: "#fbbf24" }} />
              <div style={{ flex: summary.failures, background: "#f87171" }} />
            </div>
          </button>
        );
      })}

      {/* Generator controls */}
      <div style={{ marginTop: 8, borderTop: "1px solid #1e2730", paddingTop: 10 }}>
        <div style={{ fontSize: 9, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>STRESS TESTING</div>
        <button onClick={() => onAddGenerated(1)} style={{ width: "100%", background: "#161b22", border: "1px solid #21262d", color: "#e2e8f0", borderRadius: 6, padding: "7px", fontSize: 14, cursor: "pointer", marginBottom: 4 }}>
          + Generate 1 Merchant
        </button>
        <button onClick={() => onAddGenerated(5)} style={{ width: "100%", background: "#161b22", border: "1px solid #21262d", color: "#e2e8f0", borderRadius: 6, padding: "7px", fontSize: 14, cursor: "pointer", marginBottom: 4 }}>
          + Generate 5 Merchants
        </button>
        <button onClick={onReset} style={{ width: "100%", background: "#1e2730", border: "1px solid #21262d", color: "#94a3b8", borderRadius: 6, padding: "7px", fontSize: 14, cursor: "pointer" }}>
          Reset to Registry
        </button>
        <div style={{ fontSize: 10, color: "#374151", marginTop: 6, lineHeight: 1.4 }}>
          Generated merchants use weighted random sensors reflecting real call center failure distribution.
        </div>
      </div>

      {/* Selected merchant detail */}
      <div style={{ marginTop: 8, borderTop: "1px solid #1e2730", paddingTop: 10 }}>
        <div style={{ fontSize: 9, color: "white", fontWeight: 700, letterSpacing: 1, marginBottom: 7 }}>LIVE SENSORS</div>
        {[
          ["KYC", selected.kyc_status, selected.kyc_status === "verified" ? "#4ade80" : selected.kyc_status === "expired" ? "#f87171" : "#fbbf24"],
          ["SIM", selected.sim_status, selected.sim_status === "active" ? "#4ade80" : "#fbbf24"],
          ["PIN", selected.pin_locked ? "LOCKED" : `${selected.pin_attempts}/3`, selected.pin_locked ? "#f87171" : "#4ade80"],
          ["Start Key", selected.start_key_status, selected.start_key_status === "valid" ? "#4ade80" : "#f87171"],
          ["Dormant", `${selected.dormant_days}d`, selected.dormant_days >= 60 ? "#f87171" : selected.dormant_days >= 30 ? "#fbbf24" : "#4ade80"],
          ["Operator", `${selected.operator_dormant_days}d`, selected.operator_dormant_days >= 60 ? "#f87171" : "#4ade80"],
          ["Notif.", selected.notifications_enabled ? "ON" : "OFF", selected.notifications_enabled ? "#4ade80" : "#6b7280"],
          ["Settle Hold", selected.settlement_on_hold ? "YES" : "NO", selected.settlement_on_hold ? "#f87171" : "#4ade80"],
          ["KYC Age", `${selected.kyc_age_days}d`, selected.kyc_age_days >= 365 ? "#f87171" : "#4ade80"],
        ].map(([k, v, c]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 9, color: "white" }}>{k}</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: c, textTransform: "uppercase" }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// ROOT — MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function MerchantSimulator() {
  const [merchants, setMerchants] = useState([...MERCHANT_REGISTRY]);
  const [selected, setSelected] = useState(MERCHANT_REGISTRY[0]);

  const addGenerated = (n) => {
    const batch = generateMerchantBatch(n);
    setMerchants(prev => [...prev, ...batch]);
    setSelected(batch[0]);
  };

  const resetToRegistry = () => {
    setMerchants([...MERCHANT_REGISTRY]);
    setSelected(MERCHANT_REGISTRY[0]);
  };

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif", background: "#060a0f", color: "#e2e8f0", minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ background: "#080b10", borderBottom: "1px solid #1e2730", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ background: "linear-gradient(135deg, #00a651, #005520)", borderRadius: 8, padding: "7px 10px", fontSize: 15 }}>📡</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: -0.2 }}>
              Merchant Digital Twin
              <span style={{ color: "#374151", fontWeight: 400 }}> · </span>
              <span style={{ color: "#00a651" }}>Step 3: Interaction Simulator</span>
            </div>
            <div style={{ fontSize: 9, color: "#374151" }}>
              Imports from merchantDataModel.js (Step 1) + failureRulesEngine.js (Step 2) · {merchants.length} merchants loaded
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: 14, color: "white", background: "#161b22", borderRadius: 6, padding: "4px 10px" }}>
            Active: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{selected.business_name}</span>
          </div>
        </div>
      </div>

      {/* Architecture reminder */}
      <div style={{ background: "#0a0e14", borderBottom: "1px solid #1e2730", padding: "5px 20px", display: "flex", gap: 16, alignItems: "center" }}>
        {[
          { step: "Step 1", file: "merchantDataModel.js", desc: "Schema · Registry · Generator · Mutations", done: true },
          { step: "Step 2", file: "failureRulesEngine.js", desc: "12 Rules · Evaluator · Pre-scanner · Batch scanner", done: true },
          { step: "Step 3", file: "merchantSimulator.jsx", desc: "App · USSD · Web Portal", current: true },
          { step: "Step 4", file: "twinDashboard.jsx", desc: "Twin Loop · Mirror · Analyze · Update · Alert", done: false },
        ].map((s, i) => (
          <div key={s.step} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <span style={{ color: "#1e2730", fontSize: 14 }}>→</span>}
            <div style={{
              background: s.current ? "rgba(0,166,81,0.1)" : "transparent",
              border: s.current ? "1px solid rgba(0,166,81,0.3)" : "1px solid transparent",
              borderRadius: 5, padding: "2px 7px"
            }}>
              <div style={{ fontSize: 10, color: s.current ? "#00a651" : s.done ? "white" : "#1e2730", fontWeight: 700 }}>{s.step} {s.done ? "✓" : ""}</div>
              <div style={{ fontSize: 7, color: s.current ? "#6b7280" : s.done ? "#374151" : "#1e2730" }}>{s.file}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Main layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>
        <Sidebar
          merchants={merchants}
          selected={selected}
          onSelect={setSelected}
          onAddGenerated={addGenerated}
          onReset={resetToRegistry}
        />

        {/* Three channels */}
        <div style={{ flex: 1, padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Column labels */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            {[
              { label: "📱 M-PESA Business App", sub: "Tap through — failure hints shown before confirm" },
              { label: "📟 USSD *234#", sub: "Type *234# → navigate with 1, 2, 3 → 0 back → END" },
              { label: "🌐 Merchant Web Portal", sub: "business.safaricom.co.ke · click any action to execute" },
            ].map(({ label, sub }) => (
              <div key={label} style={{ paddingLeft: 4 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#e2e8f0" }}>{label}</div>
                <div style={{ fontSize: 9, color: "#374151" }}>{sub}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, alignItems: "start" }}>
            <AppChannel merchant={selected} />
            <USSDChannel merchant={selected} />
            <WebChannel merchant={selected} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ background: "#080b10", borderTop: "1px solid #1e2730", padding: "5px 20px", display: "flex", justifyContent: "space-between", fontSize: 9, color: "#1e2730" }}>
        <span>Step 3 / 4 complete · Next: Step 4 Twin Loop Dashboard (Mirror → Analyze → Update → Alert)</span>
        <span>merchantDataModel.js + failureRulesEngine.js + merchant-simulator.jsx</span>
      </div>
    </div>
  );
}
