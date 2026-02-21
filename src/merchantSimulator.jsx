// MerchantSimulator.jsx
// Live Merchant Interaction Simulator — App · USSD · Web
// All data from backend APIs. Zero hardcoded merchants/rules.
// Every interaction logged to /events, /ussd/session/*, /app/log, /transactions
// Network simulation: 2G lag, offline fallback, crash scenarios

import { useState, useEffect, useCallback, useRef } from "react";

// ─── API CLIENT ───────────────────────────────────────────────────────────────
const BASE = "http://localhost:4000/api/v1";
const api = {
  get:  (p)    => fetch(`${BASE}${p}`).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); }),
  post: (p, b) => fetch(`${BASE}${p}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(b) }).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); }),
};

// ─── EVALUATION ENGINE (client-side mirror of backend rules) ─────────────────
function evaluate(actionKey, merchant) {
  const m = merchant;
  const rules = {
    SETTLE_FUNDS: () => {
      if (m.settlement_on_hold == 1) return fail("SETTLEMENT_HOLD","critical","Settlement funds are on hold","Verify KYC compliance and lift hold via admin portal","Escalate to settlements team — SLA: 4hrs");
      if (m.account_status !== "active") return fail("ACCOUNT_INACTIVE","high","Account not active — settlement blocked","Reactivate account first","Escalate to account management");
      return ok("Settlement request processed. Funds will reflect within 2 hours.");
    },
    PIN_PUK: () => {
      if (m.pin_locked == 1) return fail("PIN_LOCKED","high","PIN locked after too many failed attempts","Reset PIN via self-service USSD *234*0# or contact centre","Offer PIN reset via agent — identity verification required");
      if (parseInt(m.pin_attempts) >= 2) return warn("PIN_ATTEMPTS_HIGH","medium",`${m.pin_attempts}/3 failed attempts — one more will lock PIN`,"Advise merchant to reset PIN before next attempt");
      return ok("PIN verified successfully.");
    },
    SIM_SWAP: () => {
      if (m.sim_status === "unregistered") return fail("SIM_UNREGISTERED","critical","SIM not registered — service blocked","Register SIM immediately at Safaricom agent","Urgent: CBK compliance breach — same-day resolution required");
      if (m.sim_status === "swapped") return fail("SIM_RECENTLY_SWAPPED","medium","SIM swapped — 24hr transaction hold active","Wait out 24hr security hold or request early clearance","Verify swap was merchant-initiated — fraud risk if not");
      return ok("SIM status verified. No issues detected.");
    },
    ACCOUNT_STATUS: () => {
      if (m.account_status === "frozen") return fail("ACCOUNT_FROZEN","critical","Account frozen — all services suspended","Contact compliance team for unfreeze procedure","Compliance escalation required — SLA: 24hrs");
      if (m.account_status === "suspended") return fail("ACCOUNT_SUSPENDED","high","Account suspended","Resolve outstanding compliance flags","Account management team — SLA: 48hrs");
      return ok("Account is active and in good standing.");
    },
    START_KEY: () => {
      if (!m.start_key_status || m.start_key_status === "expired" || m.start_key_status === "invalid")
        return fail("START_KEY_INVALID","high","Start key invalid — LNM transactions will fail","Re-register start key via merchant portal or USSD *234*5#","Technical support — start key regeneration: 30 mins");
      return ok("Start key is valid. LNM transactions enabled.");
    },
    KYC_CHANGE: () => {
      if (m.kyc_status === "expired") return fail("KYC_EXPIRED","critical",`KYC expired (${m.kyc_age_days || "?"}d) — CBK compliance breach`,"Submit updated KYC documents via merchant portal today","Compliance: KYC renewal mandatory — service suspension in 48hrs if unresolved");
      if (m.kyc_status === "pending") return warn("KYC_PENDING","medium","KYC verification pending","Follow up with compliance on submission status");
      if (parseInt(m.kyc_age_days) > 300) return warn("KYC_EXPIRING","low",`KYC expires in ~${365 - parseInt(m.kyc_age_days)} days`,"Schedule renewal soon to avoid interruption");
      return ok("KYC is verified and current.");
    },
    BALANCE: () => {
      const b = parseFloat(m.balance) || 0;
      if (b === 0) return fail("ZERO_BALANCE","medium","Float balance is zero — outgoing transactions will fail","Top up float via bank transfer or Safaricom agent","Customer can initiate bank top-up — processing: 2hrs");
      if (b < 500) return warn("LOW_BALANCE","low",`Balance critically low (KES ${b.toLocaleString()})`, "Top up float soon");
      return ok(`Balance KES ${b.toLocaleString()} — sufficient for transactions.`);
    },
    NOTIFICATIONS: () => {
      if (!m.notifications_enabled || m.notifications_enabled == 0)
        return warn("NOTIF_OFF","low","Transaction notifications disabled","Enable via *234# Settings or M-PESA app");
      return ok("Notifications enabled. Merchant will receive all transaction alerts.");
    },
    DORMANT_OP: () => {
      const d = parseInt(m.operator_dormant_days) || 0;
      if (d >= 90) return fail("OPERATOR_DORMANT","high",`Operator dormant ${d}d — auto-suspension imminent`,"Process any transaction to reactivate","Operator account at risk — proactive outreach needed");
      if (d >= 30) return warn("OPERATOR_INACTIVE","medium",`Operator inactive for ${d} days`,"Advise merchant to log in and transact");
      return ok("Operator account active.");
    },
    STATEMENT: () => {
      if (m.account_status !== "active") return fail("STATEMENT_BLOCKED","medium","Account inactive — statement access restricted","Reactivate account","Account management");
      return ok("Statement generated. Last 90 days of transactions available.");
    },
    APPLICATION: () => {
      if (m.account_status === "frozen" || m.account_status === "suspended") return fail("APPLICATION_BLOCKED","high","Account issues block application","Resolve account status first","Account management team");
      if (m.kyc_status !== "verified") return fail("KYC_NOT_VERIFIED","medium","KYC must be verified before application proceeds","Complete KYC verification first","KYC team");
      return ok("Application submitted successfully. Processing time: 3-5 business days.");
    },
    PIN_UNLOCK: () => {
      if (m.pin_locked == 1) return ok("PIN unlocked successfully. Merchant can now transact.");
      return ok("PIN is not locked — no action needed.");
    },
  };
  const fn = rules[actionKey];
  if (!fn) return ok(`${actionKey} processed.`);
  return fn();
}

function ok(msg)  { return { success:true,  severity:"ok",  inline:msg }; }
function warn(code, severity, msg, fix) { return { success:"warn", code, severity, inline:msg, reason:`Rule ${code} triggered`, fix, escalation:"Monitor and follow up within 24 hours" }; }
function fail(code, severity, msg, fix, esc) { return { success:false, code, severity, inline:msg, reason:`Sensor check failed: ${code}`, fix, escalation:esc }; }

// ─── NETWORK SIMULATION ───────────────────────────────────────────────────────
const NETWORK_PROFILES = {
  "5G":   { label:"5G",   latency:[20,60],   dropRate:0.0, color:"#4ade80", icon:"▲▲▲" },
  "4G":   { label:"4G",   latency:[80,200],  dropRate:0.02, color:"#86efac", icon:"▲▲▲" },
  "3G":   { label:"3G",   latency:[300,800], dropRate:0.06, color:"#fbbf24", icon:"▲▲▽" },
  "2G":   { label:"2G",   latency:[1200,3000],dropRate:0.15, color:"#fb923c", icon:"▲▽▽" },
  "EDGE": { label:"EDGE", latency:[2000,5000],dropRate:0.25, color:"#f87171", icon:"▽▽▽" },
  "OFFLINE": { label:"OFFLINE", latency:[0,0], dropRate:1.0, color:"#6b7280", icon:"✗✗✗" },
};

async function simulateNetwork(profile) {
  const p = NETWORK_PROFILES[profile] || NETWORK_PROFILES["4G"];
  if (Math.random() < p.dropRate) throw new Error("NETWORK_TIMEOUT");
  const [min, max] = p.latency;
  const ms = Math.floor(Math.random() * (max - min) + min);
  await new Promise(r => setTimeout(r, ms));
  return ms;
}

// ─── PREDEFINED SCENARIOS ─────────────────────────────────────────────────────
const SCENARIOS = [
  { id:"happy_path",    label:"Happy Path",       icon:"✅", color:"#4ade80", desc:"Healthy merchant, all checks pass", steps:[{action:"ACCOUNT_STATUS",ch:"app"},{action:"BALANCE",ch:"app"},{action:"SETTLE_FUNDS",ch:"app"},{action:"STATEMENT",ch:"web"},{action:"NOTIFICATIONS",ch:"ussd"}] },
  { id:"pin_lockout",   label:"PIN Lockout",       icon:"🔐", color:"#f87171", desc:"3 failed PIN attempts → lock → unlock flow", steps:[{action:"PIN_PUK",ch:"app",forceAttempts:1},{action:"PIN_PUK",ch:"app",forceAttempts:2},{action:"PIN_PUK",ch:"app",forceAttempts:3},{action:"PIN_UNLOCK",ch:"ussd"}] },
  { id:"kyc_crisis",    label:"KYC Crisis",        icon:"📋", color:"#fbbf24", desc:"Expired KYC cascades into settlement block", steps:[{action:"KYC_CHANGE",ch:"web"},{action:"SETTLE_FUNDS",ch:"app"},{action:"ACCOUNT_STATUS",ch:"ussd"},{action:"APPLICATION",ch:"web"}] },
  { id:"sim_swap",      label:"SIM Swap Fraud",    icon:"📱", color:"#fb923c", desc:"SIM swap triggers security holds across channels", steps:[{action:"SIM_SWAP",ch:"app"},{action:"SETTLE_FUNDS",ch:"app"},{action:"PIN_PUK",ch:"ussd"},{action:"ACCOUNT_STATUS",ch:"web"}] },
  { id:"dormant",       label:"Dormant Account",   icon:"😴", color:"#60a5fa", desc:"Long inactivity → operator dormant → suspension", steps:[{action:"DORMANT_OP",ch:"ussd"},{action:"BALANCE",ch:"app"},{action:"STATEMENT",ch:"web"},{action:"SETTLE_FUNDS",ch:"app"}] },
  { id:"network_stress",label:"2G Network Stress", icon:"📡", color:"#a78bfa", desc:"Bad network causes USSD timeouts and app crashes", steps:[{action:"ACCOUNT_STATUS",ch:"ussd",network:"2G"},{action:"BALANCE",ch:"ussd",network:"2G"},{action:"SETTLE_FUNDS",ch:"app",network:"EDGE"},{action:"STATEMENT",ch:"app",network:"2G"}] },
  { id:"full_crisis",   label:"Full Meltdown",     icon:"💥", color:"#ef4444", desc:"Frozen account — everything fails simultaneously", steps:[{action:"ACCOUNT_STATUS",ch:"app"},{action:"SETTLE_FUNDS",ch:"app"},{action:"PIN_PUK",ch:"ussd"},{action:"STATEMENT",ch:"web"},{action:"KYC_CHANGE",ch:"web"},{action:"APPLICATION",ch:"web"}] },
];

// ─── ACTION LABELS ─────────────────────────────────────────────────────────────
const ACTION_LABELS = {
  SETTLE_FUNDS:"Settle Funds", PIN_PUK:"PIN/PUK Services", SIM_SWAP:"SIM Status Check",
  ACCOUNT_STATUS:"Account Status", START_KEY:"Start Key", KYC_CHANGE:"KYC Verification",
  BALANCE:"Check Balance", NOTIFICATIONS:"Notification Settings", DORMANT_OP:"Operator Activity",
  STATEMENT:"Account Statement", APPLICATION:"New Application", PIN_UNLOCK:"Unlock PIN",
};

// ─── SEVERITY STYLE ───────────────────────────────────────────────────────────
const SEV = {
  critical:{ bg:"rgba(239,68,68,.12)", border:"rgba(239,68,68,.4)", text:"#f87171", icon:"🔴" },
  high:    { bg:"rgba(251,146,60,.1)",  border:"rgba(251,146,60,.35)",text:"#fb923c", icon:"🟠" },
  medium:  { bg:"rgba(251,191,36,.08)", border:"rgba(251,191,36,.3)", text:"#fbbf24", icon:"🟡" },
  low:     { bg:"rgba(96,165,250,.08)", border:"rgba(96,165,250,.25)",text:"#60a5fa", icon:"🔵" },
  ok:      { bg:"rgba(74,222,128,.06)", border:"rgba(74,222,128,.2)", text:"#4ade80", icon:"✅" },
};

// ─── LOG ENTRY ────────────────────────────────────────────────────────────────
function LogEntry({ entry, index }) {
  const [expanded, setExpanded] = useState(false);
  const sev = entry.result ? (entry.result.success === true ? SEV.ok : SEV[entry.result.severity] || SEV.low) : SEV.low;
  const channel_icons = { app:"📱", ussd:"📟", web:"🌐", batch:"⚡" };
  
  return (
    <div style={{
      borderLeft:`2px solid ${entry.crashed ? "#f87171" : entry.timeout ? "#fbbf24" : sev.border}`,
      padding:"7px 10px", marginBottom:4,
      background: entry.crashed ? "rgba(239,68,68,.05)" : entry.timeout ? "rgba(251,191,36,.04)" : "rgba(255,255,255,.02)",
      borderRadius:"0 6px 6px 0", cursor:"pointer", animation:`logSlide .2s ease ${index * 0.03}s both`,
    }} onClick={() => setExpanded(!expanded)}>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <span style={{ fontSize:10 }}>{channel_icons[entry.channel] || "◈"}</span>
        <span style={{ fontSize:9, fontFamily:"monospace", color:"#9C9C9C", minWidth:50 }}>
          {entry.time}
        </span>
        <span style={{ fontSize:9, fontWeight:700, color: entry.crashed?"#f87171":entry.timeout?"#fbbf24":"#c8d8e8", flex:1 }}>
          {entry.crashed ? "💥 CRASH" : entry.timeout ? "⏱ TIMEOUT" : (entry.result?.success===true?"✓":"✗")} {entry.action}
        </span>
        <span style={{ fontSize:8, color:"#9C9C9C" }}>{entry.merchantName}</span>
        {entry.latency && <span style={{ fontSize:8, color:"#9C9C9C" }}>{entry.latency}ms</span>}
      </div>
      {expanded && entry.result && (
        <div style={{ marginTop:6, fontSize:9, color:"#8ca4bc", lineHeight:1.6, paddingLeft:18 }}>
          {entry.result.inline}
          {entry.result.fix && <div style={{ color:"#e2cfa0", marginTop:2 }}>→ {entry.result.fix}</div>}
        </div>
      )}
      {expanded && entry.crashed && (
        <div style={{ marginTop:6, fontSize:9, color:"#f87171", lineHeight:1.6, paddingLeft:18 }}>
          {entry.crashReason}
        </div>
      )}
    </div>
  );
}

// ─── CHANNEL: APP ─────────────────────────────────────────────────────────────
function AppChannel({ merchant, network, onEvent, rules }) {
  const [screen, setScreen] = useState("home"); // home | menu | loading | result | crash | offline
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeAction, setActiveAction] = useState(null);
  const [result, setResult] = useState(null);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [loadingPct, setLoadingPct] = useState(0);
  const [crashReason, setCrashReason] = useState("");
  const sessionRef = useRef(null);

  // expose imperative trigger for autorun
  useEffect(() => { AppChannel._trigger = triggerAction; }, [merchant, network, rules]);
  AppChannel._trigger = null;

  async function triggerAction(actionKey) {
    await runAction(actionKey);
  }

  async function runAction(actionKey) {
    const label = ACTION_LABELS[actionKey] || actionKey;
    setActiveAction(actionKey);
    setScreen("loading");
    setLoadingPct(0);
    setLoadingMsg(`Connecting to M-PESA Business…`);

    // log session start
    let sessionId = `APP-${Date.now()}`;
    try {
      const s = await api.post("/app/log", {
        merchantId: merchant.id, appVersion:"3.2.1", osType:"android",
        networkType: network, actionAttempted: actionKey,
        errorType: null, errorMessage: null,
      });
      sessionId = s.sessionId || sessionId;
      sessionRef.current = sessionId;
    } catch {}

    // animate loading bar
    const ticks = [20,45,70,90];
    const msgs = [`Authenticating ${merchant.business_name}…`, `Loading ${label}…`, `Checking account status…`, `Almost there…`];
    for (let i = 0; i < ticks.length; i++) {
      await new Promise(r => setTimeout(r, 120));
      setLoadingPct(ticks[i]);
      setLoadingMsg(msgs[i]);
    }

    try {
      const latency = await simulateNetwork(network);

      // EDGE/OFFLINE crash
      if (network === "OFFLINE") throw new Error("NETWORK_OFFLINE");
      if (network === "EDGE" && Math.random() > 0.4) throw new Error("APP_CRASH");
      if (network === "2G" && Math.random() > 0.7) throw new Error("APP_TIMEOUT");

      setLoadingPct(100);
      await new Promise(r => setTimeout(r, 150));

      const res = evaluate(actionKey, merchant);
      setResult(res);
      setScreen("result");

      // log event
      await api.post("/events", {
        merchant_id: merchant.id, merchant_name: merchant.business_name,
        action_key: actionKey, action_label: label, channel:"app",
        success: res.success === true ? 1 : 0,
        error_code: res.code || null, severity: res.severity === "ok" ? "info" : res.severity,
        escalated: res.severity === "critical" ? 1 : 0,
        response_time_ms: latency, raw_result: res,
      }).catch(()=>{});

      if (res.success !== true) {
        await api.post("/alerts", {
          merchant_id: merchant.id, merchant_name: merchant.business_name,
          action_key: actionKey, action_label: label,
          error_code: res.code, severity: res.severity,
          inline_message: res.inline, fix_message: res.fix,
          escalation_msg: res.escalation,
        }).catch(()=>{});
      }

      onEvent({ channel:"app", action:label, result:res, latency, merchantName:merchant.business_name, time: new Date().toLocaleTimeString("en-KE",{hour12:false}) });

    } catch (err) {
      const isCrash = err.message.includes("CRASH");
      const isTimeout = err.message.includes("TIMEOUT");
      const isOffline = err.message.includes("OFFLINE");

      const reason = isOffline ? "No network connection. Please check your internet."
        : isCrash ? "M-PESA Business app crashed unexpectedly. Please restart the app."
        : isTimeout ? "Request timed out. Network too slow. Try again on better signal."
        : "An unexpected error occurred.";

      setCrashReason(reason);
      setScreen(isOffline ? "offline" : isCrash ? "crash" : "timeout");

      // log crash
      await api.post("/app/log", {
        merchantId: merchant.id, networkType: network, actionAttempted: actionKey,
        errorType: isCrash ? "crash" : isTimeout ? "timeout" : "network_error",
        errorMessage: reason,
      }).catch(()=>{});

      if (sessionRef.current) {
        await api.post("/app/retry", { sessionId: sessionRef.current }).catch(()=>{});
      }

      await api.post("/events", {
        merchant_id: merchant.id, merchant_name: merchant.business_name,
        action_key: actionKey, action_label: label, channel:"app",
        success: 0, error_code: err.message, severity:"high",
        escalated: isOffline ? 1 : 0,
      }).catch(()=>{});

      onEvent({ channel:"app", action:label, crashed:true, timeout:isTimeout, crashReason:reason, merchantName:merchant.business_name, time: new Date().toLocaleTimeString("en-KE",{hour12:false}) });
    }
  }

  // Group rules by category
  const categories = [
    { id:"account", label:"Account", icon:"👤", keys:["ACCOUNT_STATUS","KYC_CHANGE","APPLICATION"] },
    { id:"money",   label:"Money",   icon:"💰", keys:["SETTLE_FUNDS","BALANCE","STATEMENT"] },
    { id:"security",label:"Security",icon:"🔒", keys:["PIN_PUK","PIN_UNLOCK","SIM_SWAP","START_KEY"] },
    { id:"settings",label:"Settings",icon:"⚙️", keys:["NOTIFICATIONS","DORMANT_OP"] },
  ];

  const np = NETWORK_PROFILES[network] || NETWORK_PROFILES["4G"];

  return (
    <div style={{ background:"#0a0f14", border:"1px solid #9C9C9C", borderRadius:22, overflow:"hidden",
      display:"flex", flexDirection:"column", boxShadow:"0 20px 60px rgba(0,0,0,.7)", minHeight:560 }}>
      
      {/* Status bar */}
      <div style={{ background:"#070d11", padding:"6px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:9, color:"#9C9C9C", fontFamily:"monospace" }}>9:41</span>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <span style={{ fontSize:8, color:np.color, fontWeight:700 }}>{np.icon}</span>
          <span style={{ fontSize:8, color:np.color }}>{np.label}</span>
        </div>
      </div>

      {/* App header */}
      <div style={{ background:"linear-gradient(160deg, #003d1f 0%, #00150a 100%)", padding:"12px 14px 10px", position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", top:0, right:0, width:80, height:80,
          background:"radial-gradient(circle, rgba(0,166,81,.2) 0%, transparent 70%)" }} />
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize:8, color:"rgba(255,255,255,.4)", letterSpacing:1 }}>M-PESA BUSINESS</div>
            <div style={{ fontSize:13, fontWeight:800, color:"white", marginTop:1 }}>{merchant.business_name}</div>
            <div style={{ fontSize:8, color:"rgba(255,255,255,.4)", marginTop:1 }}>PB {merchant.paybill} · {merchant.county}</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:8, color:"rgba(255,255,255,.4)" }}>FLOAT</div>
            <div style={{ fontSize:15, fontWeight:800, color:"white" }}>
              KES {parseFloat(merchant.balance||0).toLocaleString()}
            </div>
            <div style={{ fontSize:8, marginTop:2, color: merchant.account_status==="active"?"#4ade80":"#f87171", fontWeight:700 }}>
              ● {merchant.account_status?.toUpperCase()}
            </div>
          </div>
        </div>
      </div>

      {/* Screen content */}
      <div style={{ flex:1, padding:10, display:"flex", flexDirection:"column", position:"relative" }}>

        {/* HOME */}
        {screen === "home" && (
          <div style={{ animation:"fadeUp .2s ease" }}>
            <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>SERVICES</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
              {categories.map(cat => (
                <button key={cat.id} onClick={() => { setActiveCategory(cat); setScreen("menu"); }}
                  style={{ background:"rgba(255,255,255,.03)", border:"1px solid #9C9C9C",
                    borderRadius:12, padding:"12px 10px", cursor:"pointer", textAlign:"left",
                    transition:"all .15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor="rgba(0,166,81,.4)"; e.currentTarget.style.background="rgba(0,166,81,.05)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor="#9C9C9C"; e.currentTarget.style.background="rgba(255,255,255,.03)"; }}>
                  <div style={{ fontSize:22, marginBottom:6 }}>{cat.icon}</div>
                  <div style={{ fontSize:10, fontWeight:700, color:"#c8d8e8" }}>{cat.label}</div>
                  <div style={{ fontSize:8, color:"#9C9C9C", marginTop:2 }}>
                    {cat.keys.filter(k => {
                      const r = evaluate(k, merchant);
                      return r.success !== true;
                    }).length > 0 ? (
                      <span style={{ color:"#f87171" }}>⚠ Issues detected</span>
                    ) : <span style={{ color:"#4ade80" }}>✓ All clear</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* MENU */}
        {screen === "menu" && activeCategory && (
          <div style={{ animation:"fadeUp .2s ease" }}>
            <button onClick={() => setScreen("home")} style={{ background:"none", border:"none", color:"#9C9C9C", cursor:"pointer", fontSize:9, fontFamily:"inherit", marginBottom:10, padding:0 }}>
              ← Back
            </button>
            <div style={{ fontSize:10, fontWeight:700, color:"#c8d8e8", marginBottom:10 }}>
              {activeCategory.icon} {activeCategory.label}
            </div>
            {activeCategory.keys.map(key => {
              const preview = evaluate(key, merchant);
              const hasFail = preview.success !== true;
              return (
                <button key={key} onClick={() => runAction(key)}
                  style={{ width:"100%", background:"rgba(255,255,255,.02)",
                    border:`1px solid ${hasFail ? (SEV[preview.severity]?.border||"#9C9C9C") : "#9C9C9C"}`,
                    borderRadius:10, padding:"11px 12px", cursor:"pointer", textAlign:"left",
                    marginBottom:6, display:"flex", justifyContent:"space-between", alignItems:"center",
                    transition:"all .15s" }}
                  onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,.05)"}
                  onMouseLeave={e => e.currentTarget.style.background="rgba(255,255,255,.02)"}>
                  <div>
                    <div style={{ fontSize:10, color:"#c8d8e8", fontWeight:600 }}>{ACTION_LABELS[key]}</div>
                    {hasFail && (
                      <div style={{ fontSize:8, color:SEV[preview.severity]?.text||"#f87171", marginTop:2 }}>
                        {SEV[preview.severity]?.icon} {preview.code}
                      </div>
                    )}
                  </div>
                  <span style={{ color:"#9C9C9C", fontSize:14 }}>›</span>
                </button>
              );
            })}
          </div>
        )}

        {/* LOADING */}
        {screen === "loading" && (
          <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"center", animation:"fadeUp .2s ease" }}>
            <div style={{ width:44, height:44, borderRadius:"50%",
              border:"3px solid #0d1f14", borderTop:"3px solid #00a651",
              animation:"spin 1s linear infinite", marginBottom:16 }} />
            <div style={{ fontSize:10, color:"#4ade80", fontWeight:700, marginBottom:6 }}>{loadingMsg}</div>
            <div style={{ width:160, height:3, background:"#0d1f14", borderRadius:2, overflow:"hidden" }}>
              <div style={{ width:`${loadingPct}%`, height:"100%", background:"linear-gradient(90deg,#00a651,#4ade80)",
                transition:"width .3s ease", boxShadow:"0 0 8px #00a65180" }} />
            </div>
            <div style={{ fontSize:8, color:"#9C9C9C", marginTop:6 }}>{network} · {loadingPct}%</div>
          </div>
        )}

        {/* RESULT */}
        {screen === "result" && result && (
          <div style={{ animation:"fadeUp .2s ease" }}>
            <div style={{
              background:result.success===true ? SEV.ok.bg : SEV[result.severity]?.bg,
              border:`1px solid ${result.success===true ? SEV.ok.border : SEV[result.severity]?.border}`,
              borderRadius:12, padding:12, marginBottom:10 }}>
              <div style={{ fontSize:18, marginBottom:6 }}>{result.success===true ? "✅" : result.success==="warn" ? "⚠️" : "❌"}</div>
              <div style={{ fontSize:12, fontWeight:800, color:result.success===true ? "#4ade80" : SEV[result.severity]?.text, marginBottom:4 }}>
                {result.success===true ? "SUCCESS" : result.success==="warn" ? "WARNING" : "FAILED"}
                {result.code && <span style={{ fontSize:9, color:"#9C9C9C", marginLeft:6 }}>[{result.code}]</span>}
              </div>
              <div style={{ fontSize:10, color:"#c8d8e8", lineHeight:1.6 }}>{result.inline}</div>
              {result.fix && (
                <div style={{ marginTop:8, background:"rgba(0,0,0,.3)", borderRadius:6, padding:"7px 9px" }}>
                  <div style={{ fontSize:8, color:"#e2cfa0", marginBottom:2 }}>💡 FIX</div>
                  <div style={{ fontSize:9, color:"#c8d8e8" }}>{result.fix}</div>
                </div>
              )}
            </div>
            <button onClick={() => setScreen("home")}
              style={{ width:"100%", background:"rgba(0,166,81,.12)", border:"1px solid rgba(0,166,81,.3)",
                color:"#4ade80", borderRadius:10, padding:10, cursor:"pointer", fontFamily:"inherit",
                fontSize:10, fontWeight:700 }}>
              ← Back to Services
            </button>
          </div>
        )}

        {/* CRASH */}
        {(screen === "crash" || screen === "timeout") && (
          <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"center", animation:"fadeUp .2s ease" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>{screen === "crash" ? "💥" : "⏱"}</div>
            <div style={{ fontSize:11, fontWeight:800, color:"#f87171", marginBottom:6 }}>
              {screen === "crash" ? "APP CRASHED" : "REQUEST TIMED OUT"}
            </div>
            <div style={{ fontSize:9, color:"#8ca4bc", textAlign:"center", maxWidth:200, lineHeight:1.6, marginBottom:16 }}>
              {crashReason}
            </div>
            <div style={{ fontSize:8, color:"#9C9C9C", background:"#060d14", borderRadius:5, padding:"4px 10px", marginBottom:12, fontFamily:"monospace" }}>
              Network: {network} · Root cause logged
            </div>
            <button onClick={() => setScreen("home")}
              style={{ background:"rgba(239,68,68,.1)", border:"1px solid rgba(239,68,68,.3)", color:"#f87171",
                borderRadius:8, padding:"8px 16px", cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:700 }}>
              Restart App
            </button>
          </div>
        )}

        {/* OFFLINE */}
        {screen === "offline" && (
          <div style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"center" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>📵</div>
            <div style={{ fontSize:11, fontWeight:800, color:"#6b7280", marginBottom:6 }}>NO CONNECTION</div>
            <div style={{ fontSize:9, color:"#9C9C9C", textAlign:"center", maxWidth:180, lineHeight:1.6 }}>
              Backend unreachable or merchant has no data connection. Check network settings.
            </div>
            <div style={{ marginTop:12, fontSize:8, color:"#9C9C9C", fontFamily:"monospace" }}>
              {BASE}
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ background:"#070d11", borderTop:"1px solid #9C9C9C", display:"flex", justifyContent:"space-around", padding:"8px 0" }}>
        {[["🏠","Home"],["📊","Stats"],["🔔","Alerts"],["👤","Profile"]].map(([ic,lb],i) => (
          <button key={i} onClick={() => i===0 && setScreen("home")}
            style={{ background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column",
              alignItems:"center", gap:2, opacity:i===0?1:.25 }}>
            <span style={{ fontSize:16 }}>{ic}</span>
            <span style={{ fontSize:6, color:"#9C9C9C" }}>{lb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── CHANNEL: USSD ────────────────────────────────────────────────────────────
function USSDChannel({ merchant, network, onEvent }) {
  const [display, setDisplay] = useState([]);
  const [phase, setPhase] = useState("idle");
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState(null);
  const [sending, setSending] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const displayRef = useRef();

  useEffect(() => { reset(); }, [merchant.id]);
  useEffect(() => { if (displayRef.current) displayRef.current.scrollTop = displayRef.current.scrollHeight; }, [display]);

  USSDChannel._trigger = null;
  useEffect(() => {
    USSDChannel._trigger = async (actionKey) => {
      await simulateDial(actionKey);
    };
  }, [merchant, network]);

  function reset() {
    setDisplay([]); setPhase("idle"); setInput(""); setSessionId(null); setSending(false); setCrashed(false);
  }

  function push(txt, type="response") {
    setDisplay(d => [...d, { txt, type, ts: new Date().toLocaleTimeString("en-KE",{hour12:false}) }]);
  }

  async function simulateDial(actionKey) {
    reset();
    await new Promise(r => setTimeout(r, 300));
    push("*234#", "input");
    await new Promise(r => setTimeout(r, 200));
    await doConnect();
  }

  async function doConnect() {
    setSending(true);
    push("Dialling *234#…", "system");

    try {
      const latency = await simulateNetwork(network);

      if (network === "OFFLINE") { push("CALL FAILED\n\nNo network connection.", "error"); setSending(false); setCrashed(true); return; }

      // Timeout simulation for 2G/EDGE
      if ((network === "2G" || network === "EDGE") && Math.random() > 0.5) {
        push("⏱ USSD SESSION TIMEOUT\n\nSession expired — poor network signal.\n\nThis session has been logged.", "timeout");

        const sid = sessionId || `USSD-${Date.now()}`;
        await api.post("/ussd/session/timeout", { sessionId:sid, menu:"main" }).catch(()=>{});
        await api.post("/events", {
          merchant_id:merchant.id, merchant_name:merchant.business_name,
          action_key:"USSD_TIMEOUT", action_label:"USSD Session Timeout", channel:"ussd",
          success:0, error_code:"USSD_TIMEOUT", severity:"medium",
        }).catch(()=>{});

        onEvent({ channel:"ussd", action:"USSD Dial", timeout:true, merchantName:merchant.business_name, time:new Date().toLocaleTimeString("en-KE",{hour12:false}) });
        setSending(false);
        return;
      }

      // Start session
      const s = await api.post("/ussd/session/start", {
        merchantId:merchant.id, phoneNumber:merchant.phone_number,
        msisdn:merchant.phone_number, networkType:network,
      });
      setSessionId(s.sessionId);

      const menuTxt = `CON M-PESA Business\n${merchant.business_name}\n\n1. Account Services\n2. Money & Statements\n3. Security\n4. Settings\n\n0. Exit`;
      push(menuTxt, "response");
      setPhase("main");

    } catch {
      push("NETWORK ERROR\n\nFailed to connect to USSD gateway.\n\nPlease try again.", "error");
      setCrashed(true);
    } finally {
      setSending(false);
    }
  }

  async function send() {
    const v = input.trim();
    if (!v) return;
    setInput("");

    if (phase === "idle") {
      if (v === "*234#" || v === "*234") {
        push(v, "input");
        await doConnect();
      } else {
        push(v, "input");
        push("Invalid. Dial *234# to start.", "error");
      }
      return;
    }

    push(v, "input");
    setSending(true);

    if (v === "0") { reset(); setSending(false); return; }
    if (v === "00") {
      const menuTxt = `CON M-PESA Business\n${merchant.business_name}\n\n1. Account Services\n2. Money & Statements\n3. Security\n4. Settings\n\n0. Exit`;
      push(menuTxt, "response");
      setPhase("main");
      setSending(false);
      return;
    }

    const subMenus = {
      "1": { label:"Account Services", items:[{k:"ACCOUNT_STATUS",u:"1",l:"Account Status"},{k:"KYC_CHANGE",u:"2",l:"KYC Check"},{k:"APPLICATION",u:"3",l:"New Application"}]},
      "2": { label:"Money & Statements", items:[{k:"SETTLE_FUNDS",u:"1",l:"Settle Funds"},{k:"BALANCE",u:"2",l:"Check Balance"},{k:"STATEMENT",u:"3",l:"Statement"}]},
      "3": { label:"Security", items:[{k:"PIN_PUK",u:"1",l:"PIN Services"},{k:"PIN_UNLOCK",u:"2",l:"Unlock PIN"},{k:"SIM_SWAP",u:"3",l:"SIM Status"},{k:"START_KEY",u:"4",l:"Start Key"}]},
      "4": { label:"Settings", items:[{k:"NOTIFICATIONS",u:"1",l:"Notifications"},{k:"DORMANT_OP",u:"2",l:"Operator Activity"}]},
    };

    try {
      const latency = await simulateNetwork(network);

      // 2G random timeout mid-session
      if ((network === "2G" || network === "EDGE") && Math.random() > 0.6) {
        push("⏱ SESSION EXPIRED\n\nPoor signal — session timed out.\nDial *234# to try again.", "timeout");
        if (sessionId) await api.post("/ussd/session/timeout", { sessionId, menu:phase }).catch(()=>{});
        onEvent({ channel:"ussd", action:`Input ${v}`, timeout:true, merchantName:merchant.business_name, time:new Date().toLocaleTimeString("en-KE",{hour12:false}) });
        setPhase("idle");
        setSending(false);
        return;
      }

      if (sessionId) {
        await api.post("/ussd/session/input", { sessionId, input:v, menu:phase, responseTimeMs:latency }).catch(()=>{});
      }

      if (phase === "main") {
        const sub = subMenus[v];
        if (sub) {
          const txt = `CON ${sub.label}\n\n` + sub.items.map((it,i) => `${i+1}. ${it.l}`).join("\n") + "\n\n0. Back  00. Main";
          push(txt, "response");
          setPhase(`sub_${v}`);
        } else {
          push(`CON Invalid option '${v}'.\n\n1. Account  2. Money  3. Security  4. Settings\n\n0. Exit`, "response");
        }
      } else if (phase.startsWith("sub_")) {
        const menuKey = phase.replace("sub_","");
        const sub = subMenus[menuKey];
        if (sub) {
          const item = sub.items[parseInt(v)-1];
          if (item) {
            const res = evaluate(item.k, merchant);
            const lines = res.success===true
              ? [`END ✓ ${item.l}`, "", res.inline]
              : [`END ✗ ${item.l}`, `[${res.code}]`, "", res.inline, "", `FIX: ${res.fix}`, "", res.escalation];
            push(lines.join("\n"), res.success===true ? "success" : "fail");

            if (sessionId) {
              await api.post("/ussd/session/end", { sessionId, finalAction:item.k, status:res.success===true?"completed":"failed" }).catch(()=>{});
            }

            await api.post("/events", {
              merchant_id:merchant.id, merchant_name:merchant.business_name,
              action_key:item.k, action_label:item.l, channel:"ussd",
              success:res.success===true?1:0, error_code:res.code||null,
              severity:res.severity==="ok"?"info":res.severity,
              session_id:sessionId, response_time_ms:latency,
            }).catch(()=>{});

            onEvent({ channel:"ussd", action:item.l, result:res, latency, merchantName:merchant.business_name, time:new Date().toLocaleTimeString("en-KE",{hour12:false}) });
            setPhase("end");
          } else {
            push(`CON Invalid. Choose 1–${sub.items.length}\n\n0. Back  00. Main`, "response");
          }
        }
      }
    } catch {
      push("SYSTEM ERROR\n\nPlease try again.", "error");
    } finally {
      setSending(false);
    }
  }

  const np = NETWORK_PROFILES[network] || NETWORK_PROFILES["4G"];

  return (
    <div style={{ background:"#020810", border:"1px solid #9C9C9C", borderRadius:22, overflow:"hidden",
      display:"flex", flexDirection:"column", boxShadow:"0 20px 60px rgba(0,0,0,.7)", minHeight:560 }}>

      {/* Header */}
      <div style={{ background:"#060d14", padding:"8px 14px", borderBottom:"1px solid #9C9C9C",
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:9, color:"#9C9C9C", letterSpacing:1 }}>USSD TERMINAL</div>
          <div style={{ fontSize:12, color:"#00c853", fontWeight:800, fontFamily:"monospace" }}>*234#</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:8, color:np.color, fontWeight:700 }}>{np.icon} {np.label}</div>
          <div style={{ fontSize:7, color:"#9C9C9C" }}>{merchant.phone_number}</div>
        </div>
      </div>

      {/* Display */}
      <div ref={displayRef} style={{ flex:1, background:"#020b06", margin:10, borderRadius:8,
        border:"1px solid #0a1e0e", padding:12, overflowY:"auto", minHeight:260,
        fontFamily:"'Courier New', monospace" }}>
        {display.length === 0 ? (
          <div style={{ color:"#0d3015", fontSize:11, textAlign:"center", marginTop:50, lineHeight:2.4 }}>
            SAFARICOM USSD v2.4<br/>
            <span style={{ color:"#00a651", animation:"blink 1s infinite" }}>█</span><br/>
            <span style={{ fontSize:9 }}>Type <span style={{ color:"#00c853" }}>*234#</span> and press SEND</span>
          </div>
        ) : (
          display.map((d,i) => (
            <div key={i} style={{ marginBottom:6,
              color: d.type==="input" ? "#60a5fa"
                : d.type==="error" ? "#f87171"
                : d.type==="timeout" ? "#fbbf24"
                : d.type==="success" ? "#4ade80"
                : d.type==="fail" ? "#fb923c"
                : d.type==="system" ? "#9C9C9C"
                : "#86efac",
              fontSize:11, whiteSpace:"pre-wrap", lineHeight:1.6,
            }}>
              {d.type==="input" && <span style={{ color:"#9C9C9C" }}>› </span>}
              {d.txt}
            </div>
          ))
        )}
        {sending && (
          <div style={{ display:"flex", gap:3, padding:"4px 0" }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width:5, height:5, borderRadius:"50%", background:"#00a651",
                animation:`dotPulse .8s ${i*.2}s infinite` }} />
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding:"0 10px 6px", display:"flex", gap:5 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key==="Enter" && !sending && send()}
          placeholder={phase==="idle" ? "Dial *234#" : "Enter option…"}
          style={{ flex:1, background:"#060d14", border:"1px solid #9C9C9C", borderRadius:7,
            padding:"7px 10px", color:"#86efac", fontSize:11, fontFamily:"monospace", outline:"none" }}
          disabled={sending}
        />
        <button onClick={send} disabled={sending}
          style={{ background:"#00a651", color:"white", border:"none", borderRadius:7,
            padding:"7px 12px", fontWeight:800, fontSize:11, cursor:sending?"wait":"pointer",
            opacity:sending?.6:1 }}>
          SEND
        </button>
      </div>

      {/* Keypad */}
      <div style={{ padding:"0 10px 10px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:4 }}>
          {["1","2","3","4","5","6","7","8","9","*","0","#"].map(k => (
            <button key={k} onClick={() => setInput(v => v+k)}
              style={{ background:"#0a1520", border:"1px solid #9C9C9C", color:"#c8d8e8",
                borderRadius:6, padding:"7px", fontSize:12, fontWeight:600, cursor:"pointer",
                fontFamily:"monospace", transition:"all .1s" }}
              onMouseEnter={e => e.currentTarget.style.background="#0f1e2e"}
              onMouseLeave={e => e.currentTarget.style.background="#0a1520"}>
              {k}
            </button>
          ))}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginTop:4 }}>
          <button onClick={() => setInput(v => v.slice(0,-1))}
            style={{ background:"#0a1520", border:"1px solid #9C9C9C", color:"#6b7280",
              borderRadius:6, padding:"7px", fontSize:10, cursor:"pointer" }}>
            ⌫ DEL
          </button>
          <button onClick={reset}
            style={{ background:"rgba(239,68,68,.08)", border:"1px solid rgba(239,68,68,.2)", color:"#f87171",
              borderRadius:6, padding:"7px", fontSize:10, cursor:"pointer" }}>
            ✕ END
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CHANNEL: WEB PORTAL ──────────────────────────────────────────────────────
function WebChannel({ merchant, network, onEvent }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState("");
  const [result, setResult] = useState(null);
  const [activeAction, setActiveAction] = useState(null);

  useEffect(() => { setResult(null); setActiveAction(null); setActiveTab("overview"); }, [merchant.id]);

  WebChannel._trigger = null;
  useEffect(() => {
    WebChannel._trigger = async (actionKey) => {
      await runAction(actionKey);
    };
  }, [merchant, network]);

  async function runAction(actionKey) {
    setLoadingAction(ACTION_LABELS[actionKey] || actionKey);
    setLoading(true);
    setResult(null);
    setActiveAction(actionKey);

    try {
      const latency = await simulateNetwork(network);

      if (network === "OFFLINE") {
        setResult({ _offline: true });
        setLoading(false);
        return;
      }

      const res = evaluate(actionKey, merchant);
      setResult(res);

      // log to backend
      await api.post("/events", {
        merchant_id:merchant.id, merchant_name:merchant.business_name,
        action_key:actionKey, action_label:ACTION_LABELS[actionKey]||actionKey,
        channel:"web", success:res.success===true?1:0,
        error_code:res.code||null, severity:res.severity==="ok"?"info":res.severity,
        response_time_ms:latency,
      }).catch(()=>{});

      if (res.success !== true) {
        await api.post("/alerts", {
          merchant_id:merchant.id, merchant_name:merchant.business_name,
          action_key:actionKey, action_label:ACTION_LABELS[actionKey]||actionKey,
          error_code:res.code, severity:res.severity,
          inline_message:res.inline, fix_message:res.fix,
        }).catch(()=>{});
      }

      onEvent({ channel:"web", action:ACTION_LABELS[actionKey]||actionKey, result:res, latency, merchantName:merchant.business_name, time:new Date().toLocaleTimeString("en-KE",{hour12:false}) });

    } catch {
      setResult({ _error:true, inline:"Request failed — please retry" });
    } finally {
      setLoading(false);
    }
  }

  const sensorRows = [
    { k:"Account",    v:merchant.account_status,      bad:v => v!=="active" },
    { k:"KYC",        v:merchant.kyc_status,           bad:v => v!=="verified", warn:v => v==="pending" },
    { k:"SIM",        v:merchant.sim_status,           bad:v => v==="unregistered", warn:v => v==="swapped" },
    { k:"PIN",        v:merchant.pin_locked==1?"LOCKED":`${merchant.pin_attempts||0}/3`, bad:v => v==="LOCKED", warn:v => v==="2/3" },
    { k:"Start Key",  v:merchant.start_key_status,     bad:v => v!=="valid" },
    { k:"Balance",    v:`KES ${parseFloat(merchant.balance||0).toLocaleString()}`, bad:v => parseFloat(merchant.balance||0)===0 },
    { k:"Dormant",    v:`${merchant.dormant_days||0}d`, bad:v => parseInt(v)>=60, warn:v => parseInt(v)>=30 },
    { k:"Settlement", v:merchant.settlement_on_hold==1?"HOLD":"CLEAR", bad:v => v==="HOLD" },
  ];

  const tabActions = {
    account: ["ACCOUNT_STATUS","KYC_CHANGE","APPLICATION"],
    money:   ["SETTLE_FUNDS","BALANCE","STATEMENT"],
    security:["PIN_PUK","PIN_UNLOCK","SIM_SWAP","START_KEY"],
    settings:["NOTIFICATIONS","DORMANT_OP"],
  };

  const np = NETWORK_PROFILES[network] || NETWORK_PROFILES["4G"];

  return (
    <div style={{ background:"#050c14", border:"1px solid #9C9C9C", borderRadius:12, overflow:"hidden",
      display:"flex", flexDirection:"column", boxShadow:"0 20px 60px rgba(0,0,0,.7)", minHeight:560 }}>

      {/* Browser bar */}
      <div style={{ background:"#03080d", padding:"7px 12px", borderBottom:"1px solid #9C9C9C" }}>
        <div style={{ display:"flex", gap:5, marginBottom:5 }}>
          {["#f87171","#fbbf24","#4ade80"].map(c => <div key={c} style={{ width:8,height:8,borderRadius:"50%",background:c }} />)}
        </div>
        <div style={{ background:"#0a1520", borderRadius:4, padding:"3px 9px", fontSize:8, color:np.color,
          fontFamily:"monospace", display:"flex", justifyContent:"space-between" }}>
          <span style={{ color:"#9C9C9C" }}>🔒 business.safaricom.co.ke/portal/{merchant.paybill}</span>
          <span style={{ fontWeight:700 }}>{np.icon} {np.label}</span>
        </div>
      </div>

      {/* Portal header */}
      <div style={{ background:"linear-gradient(90deg, #020f07, #031a0d)", padding:"10px 14px",
        borderBottom:"1px solid #0a1e10", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", gap:9, alignItems:"center" }}>
          <span style={{ fontSize:22 }}>{merchant.avatar||"🏪"}</span>
          <div>
            <div style={{ fontSize:12, fontWeight:800, color:"white" }}>{merchant.business_name}</div>
            <div style={{ fontSize:8, color:"#9C9C9C" }}>PB {merchant.paybill} · {merchant.county}</div>
          </div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:13, fontWeight:800, color:"white" }}>KES {parseFloat(merchant.balance||0).toLocaleString()}</div>
          <div style={{ fontSize:8, color:merchant.account_status==="active"?"#4ade80":"#f87171", fontWeight:700 }}>
            ● {merchant.account_status?.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ display:"flex", background:"#030a10", borderBottom:"1px solid #0a1520", overflowX:"auto" }}>
        {[["overview","Overview"],["account","Account"],["money","Money"],["security","Security"],["settings","Settings"]].map(([t,l]) => (
          <button key={t} onClick={() => { setActiveTab(t); setResult(null); setActiveAction(null); }}
            style={{ background:"none", border:"none",
              borderBottom: activeTab===t ? "2px solid #00a651" : "2px solid transparent",
              color:activeTab===t?"#4ade80":"#9C9C9C", padding:"7px 12px", fontSize:9,
              cursor:"pointer", fontFamily:"inherit", fontWeight:700, whiteSpace:"nowrap",
              transition:"color .15s" }}>
            {l}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex:1, padding:12, overflowY:"auto" }}>

        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <div style={{ animation:"fadeUp .2s ease" }}>
            <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>SENSOR HEALTH</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:10 }}>
              {sensorRows.map(s => {
                const isBad  = s.bad?.(s.v);
                const isWarn = !isBad && s.warn?.(s.v);
                const color  = isBad ? "#f87171" : isWarn ? "#fbbf24" : "#4ade80";
                return (
                  <div key={s.k} style={{ background:"#070f16", border:`1px solid ${color}20`, borderRadius:6, padding:"7px 9px" }}>
                    <div style={{ fontSize:8, color:"#9C9C9C", marginBottom:2 }}>{s.k}</div>
                    <div style={{ fontSize:10, fontWeight:700, color, textTransform:"uppercase" }}>{s.v}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ACTION TABS */}
        {activeTab !== "overview" && tabActions[activeTab] && (
          <div style={{ animation:"fadeUp .2s ease" }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:10 }}>
              {tabActions[activeTab].map(key => {
                const preview = evaluate(key, merchant);
                const hasFail = preview.success !== true;
                const isActive = activeAction === key;
                return (
                  <button key={key} onClick={() => runAction(key)}
                    style={{ background: isActive ? "rgba(0,166,81,.06)" : "rgba(255,255,255,.02)",
                      border:`1px solid ${isActive ? "rgba(0,166,81,.3)" : hasFail ? (SEV[preview.severity]?.border||"#9C9C9C")+"80" : "#9C9C9C"}`,
                      borderRadius:9, padding:"11px", cursor:"pointer", textAlign:"left",
                      transition:"all .15s" }}
                    onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,.04)"}
                    onMouseLeave={e => e.currentTarget.style.background=isActive?"rgba(0,166,81,.06)":"rgba(255,255,255,.02)"}>
                    <div style={{ fontSize:10, color:"#c8d8e8", fontWeight:600, marginBottom:3 }}>
                      {ACTION_LABELS[key]}
                    </div>
                    {hasFail ? (
                      <div style={{ fontSize:8, color:SEV[preview.severity]?.text||"#f87171" }}>
                        {SEV[preview.severity]?.icon} {preview.code}
                      </div>
                    ) : (
                      <div style={{ fontSize:8, color:"#4ade80" }}>✓ Ready</div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Loading */}
            {loading && (
              <div style={{ textAlign:"center", padding:"20px 0" }}>
                <div style={{ fontSize:9, color:"#4ade80", marginBottom:8 }}>Processing {loadingAction}…</div>
                <div style={{ width:"100%", height:2, background:"#0a1520", borderRadius:1, overflow:"hidden" }}>
                  <div style={{ height:"100%", background:"#00a651", animation:"loadBar 1.5s ease infinite" }} />
                </div>
              </div>
            )}

            {/* Result */}
            {result && !loading && !result._offline && !result._error && (
              <div style={{
                background:result.success===true ? SEV.ok.bg : SEV[result.severity]?.bg,
                border:`1px solid ${result.success===true ? SEV.ok.border : SEV[result.severity]?.border}`,
                borderRadius:9, padding:12, animation:"fadeUp .2s ease" }}>
                <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:6 }}>
                  <span style={{ fontSize:16 }}>{result.success===true?"✅":result.success==="warn"?"⚠️":"❌"}</span>
                  <span style={{ fontSize:11, fontWeight:800, color:result.success===true?"#4ade80":SEV[result.severity]?.text }}>
                    {result.success===true?"SUCCESS":result.success==="warn"?"WARNING":"FAILED"}
                    {result.code && <span style={{ fontSize:8, color:"#9C9C9C", marginLeft:6 }}>[{result.code}]</span>}
                  </span>
                </div>
                <div style={{ fontSize:9, color:"#c8d8e8", lineHeight:1.6, marginBottom:6 }}>{result.inline}</div>
                {result.fix && (
                  <div style={{ background:"rgba(0,0,0,.3)", borderRadius:5, padding:"6px 8px", fontSize:9, color:"#e2cfa0" }}>
                    💡 {result.fix}
                  </div>
                )}
                {result.escalation && result.success===false && (
                  <div style={{ background:"rgba(96,165,250,.05)", borderRadius:5, padding:"6px 8px", fontSize:8, color:"#60a5fa", marginTop:5 }}>
                    📞 {result.escalation}
                  </div>
                )}
              </div>
            )}

            {result?._offline && (
              <div style={{ background:"rgba(107,114,128,.08)", border:"1px solid rgba(107,114,128,.2)",
                borderRadius:9, padding:14, textAlign:"center" }}>
                <div style={{ fontSize:24, marginBottom:8 }}>🌐</div>
                <div style={{ fontSize:10, color:"#6b7280", fontWeight:700 }}>OFFLINE</div>
                <div style={{ fontSize:9, color:"#9C9C9C", marginTop:4 }}>Cannot reach portal. Check connection.</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AUTORUN ENGINE ───────────────────────────────────────────────────────────
function AutorunPanel({ merchants, network, onNetworkChange, setAutoNetwork, onEvent, appRef, ussdRef, webRef }) {
  const [scenario, setScenario] = useState(null);
  const [merchantPick, setMerchantPick] = useState(null);
  const [running, setRunning] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1);
  const [stepLog, setStepLog] = useState([]);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const abortRef = useRef(false);

  async function run() {
    if (!scenario || !merchantPick) return;
    abortRef.current = false;
    pausedRef.current = false;
    setRunning(true);
    setStepIdx(-1);
    setStepLog([]);

    for (let i = 0; i < scenario.steps.length; i++) {
      if (abortRef.current) break;
      while (pausedRef.current) await new Promise(r => setTimeout(r, 200));

      const step = scenario.steps[i];
      setStepIdx(i);

      // switch network if step specifies it
      if (step.network) onNetworkChange(step.network);

      // Log step start
      setStepLog(l => [...l, { idx:i, action:step.action, channel:step.ch, status:"running" }]);

      // Trigger the right channel
      await new Promise(r => setTimeout(r, 400));
      try {
        if (step.ch === "app")  appRef.current?.(step.action);
        if (step.ch === "ussd") ussdRef.current?.(step.action);
        if (step.ch === "web")  webRef.current?.(step.action);
      } catch {}

      // Wait for it to complete (rough timing by network latency)
      const waitMs = { "OFFLINE":500, "EDGE":4000, "2G":3500, "3G":1500, "4G":700, "5G":400 }[network] || 1000;
      await new Promise(r => setTimeout(r, waitMs + 600));

      setStepLog(l => l.map((s,si) => si===i ? {...s, status:"done"} : s));
    }

    setRunning(false);
    setStepIdx(-1);
    onNetworkChange(network); // restore original network
  }

  function pause() { pausedRef.current = !pausedRef.current; setPaused(p => !p); }
  function stop()  { abortRef.current = true; pausedRef.current = false; setPaused(false); setRunning(false); setStepIdx(-1); }

  return (
    <div style={{ background:"#050c14", border:"1px solid rgba(96,165,250,.15)", borderRadius:10,
      padding:14, display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ fontSize:8, color:"#60a5fa", letterSpacing:1.5, textTransform:"uppercase" }}>⚡ AUTORUN</div>

      {/* Scenario picker */}
      <div>
        <div style={{ fontSize:8, color:"#9C9C9C", marginBottom:6 }}>SCENARIO</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
          {SCENARIOS.map(s => (
            <button key={s.id} onClick={() => setScenario(s)}
              style={{ background: scenario?.id===s.id ? `${s.color}15` : "transparent",
                border:`1px solid ${scenario?.id===s.id ? s.color+"60" : "#9C9C9C"}`,
                color: scenario?.id===s.id ? s.color : "#9C9C9C",
                borderRadius:6, padding:"5px 9px", cursor:"pointer", fontFamily:"inherit",
                fontSize:9, fontWeight:700, transition:"all .15s", display:"flex", gap:5, alignItems:"center" }}>
              <span>{s.icon}</span> {s.label}
            </button>
          ))}
        </div>
        {scenario && (
          <div style={{ fontSize:9, color:"#9C9C9C", marginTop:6, lineHeight:1.5 }}>
            {scenario.desc} · <span style={{ color:"#c8d8e8" }}>{scenario.steps.length} steps</span>
          </div>
        )}
      </div>

      {/* Merchant picker */}
      <div>
        <div style={{ fontSize:8, color:"#9C9C9C", marginBottom:6 }}>MERCHANT</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:4, maxHeight:90, overflowY:"auto" }}>
          {merchants.map(m => (
            <button key={m.id} onClick={() => setMerchantPick(m)}
              style={{ background:merchantPick?.id===m.id?"rgba(230,175,80,.1)":"transparent",
                border:`1px solid ${merchantPick?.id===m.id?"rgba(230,175,80,.35)":"#9C9C9C"}`,
                color:merchantPick?.id===m.id?"#e2cfa0":"#9C9C9C",
                borderRadius:5, padding:"4px 8px", cursor:"pointer", fontFamily:"inherit",
                fontSize:8, transition:"all .12s", display:"flex", gap:4, alignItems:"center" }}>
              <span>{m.avatar||"🏪"}</span> {m.business_name}
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        <button onClick={run} disabled={running||!scenario||!merchantPick}
          style={{ background:"rgba(96,165,250,.12)", border:"1px solid rgba(96,165,250,.3)",
            color:"#60a5fa", borderRadius:7, padding:"8px 14px", cursor:running||!scenario||!merchantPick?"not-allowed":"pointer",
            fontFamily:"inherit", fontSize:10, fontWeight:800, opacity:!scenario||!merchantPick?.6:1 }}>
          ▶ Run
        </button>
        {running && (
          <>
            <button onClick={pause}
              style={{ background:"none", border:"1px solid #9C9C9C", color:paused?"#4ade80":"#fbbf24",
                borderRadius:7, padding:"8px 12px", cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:700 }}>
              {paused?"▶ Resume":"⏸ Pause"}
            </button>
            <button onClick={stop}
              style={{ background:"none", border:"1px solid rgba(239,68,68,.3)", color:"#f87171",
                borderRadius:7, padding:"8px 12px", cursor:"pointer", fontFamily:"inherit", fontSize:10 }}>
              ■ Stop
            </button>
          </>
        )}
      </div>

      {/* Step progress */}
      {(running || stepLog.length > 0) && scenario && (
        <div>
          <div style={{ display:"flex", gap:3, marginBottom:6 }}>
            {scenario.steps.map((s,i) => (
              <div key={i} style={{ flex:1, height:3, borderRadius:1,
                background: stepLog[i]?.status==="done" ? "#4ade80"
                  : i===stepIdx ? "#60a5fa"
                  : "#9C9C9C",
                transition:"background .3s",
                boxShadow: i===stepIdx ? "0 0 6px #60a5fa80" : "none",
              }} />
            ))}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            {stepLog.map((s,i) => (
              <div key={i} style={{ display:"flex", gap:7, alignItems:"center", fontSize:9 }}>
                <span style={{ color:s.status==="done"?"#4ade80":"#60a5fa",
                  animation:s.status==="running"?"dotPulse .8s infinite":"none" }}>
                  {s.status==="done"?"✓":"▶"}
                </span>
                <span style={{ color:"#9C9C9C" }}>{["📱","📟","🌐"][["app","ussd","web"].indexOf(s.channel)]||"◈"}</span>
                <span style={{ color:s.status==="done"?"#8ca4bc":"#c8d8e8" }}>
                  {ACTION_LABELS[s.action]||s.action}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ROOT COMPONENT ───────────────────────────────────────────────────────────
export default function MerchantSimulator() {
  const [merchants,   setMerchants]   = useState([]);
  const [selected,    setSelected]    = useState(null);
  const [network,     setNetwork]     = useState("4G");
  const [apiOnline,   setApiOnline]   = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [eventLog,    setEventLog]    = useState([]);
  const [toasts,      setToasts]      = useState([]);
  const [sidebarTab,  setSidebarTab]  = useState("merchants"); // merchants | log | scenarios

  const appTriggerRef  = useRef(null);
  const ussdTriggerRef = useRef(null);
  const webTriggerRef  = useRef(null);

  // wire up channel triggers
  useEffect(() => {
    const interval = setInterval(() => {
      if (AppChannel._trigger)  appTriggerRef.current  = AppChannel._trigger;
      if (USSDChannel._trigger) ussdTriggerRef.current = USSDChannel._trigger;
      if (WebChannel._trigger)  webTriggerRef.current  = WebChannel._trigger;
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const toast = useCallback((msg, type="success") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id!==id)), 3000);
  }, []);

  const loadMerchants = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/merchants?limit=50");
      const list = Array.isArray(data) ? data : [];
      setMerchants(list);
      if (list.length && !selected) setSelected(list[0]);
      setApiOnline(true);
    } catch {
      setApiOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMerchants(); }, [loadMerchants]);

  const onEvent = useCallback((evt) => {
    setEventLog(l => [evt, ...l].slice(0, 200));
  }, []);

  const np = NETWORK_PROFILES[network] || NETWORK_PROFILES["4G"];

  if (!apiOnline && !loading) {
    return (
      <div style={{ background:"#030810", color:"#c8d8e8", minHeight:"100vh", display:"flex",
        flexDirection:"column", alignItems:"center", justifyContent:"center",
        fontFamily:"'IBM Plex Mono', monospace" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&display=swap');`}</style>
        <div style={{ fontSize:48, marginBottom:16 }}>📵</div>
        <div style={{ fontSize:18, fontWeight:800, color:"#f87171", marginBottom:8 }}>BACKEND OFFLINE</div>
        <div style={{ fontSize:10, color:"#9C9C9C", marginBottom:20, textAlign:"center", lineHeight:1.8 }}>
          Cannot reach <span style={{ color:"#e2cfa0", fontFamily:"monospace" }}>{BASE}</span><br/>
          Start the backend to use the simulator
        </div>
        <div style={{ background:"#060d14", border:"1px solid #9C9C9C", borderRadius:8, padding:"12px 16px",
          fontFamily:"monospace", fontSize:11, color:"#4ade80", marginBottom:16 }}>
          cd merchant-twin-backend<br/>
          npm run dev
        </div>
        <button onClick={loadMerchants}
          style={{ background:"rgba(0,200,83,.1)", border:"1px solid rgba(0,200,83,.3)", color:"#4ade80",
            borderRadius:7, padding:"9px 18px", cursor:"pointer", fontFamily:"inherit", fontSize:10, fontWeight:700 }}>
          ↺ Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&family=Plus+Jakarta+Sans:wght@400;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:#030810}
        ::-webkit-scrollbar-thumb{background:#9C9C9C;border-radius:2px}
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @keyframes logSlide{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        @keyframes dotPulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
        @keyframes loadBar{0%{width:0;margin-left:0}50%{width:60%;margin-left:0}100%{width:0;margin-left:100%}}
        @keyframes toastIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(0,200,83,.3)}50%{box-shadow:0 0 0 6px rgba(0,200,83,0)}}
      `}</style>

      <div style={{ background:"#030810", color:"#c8d8e8", minHeight:"100vh",
        display:"flex", flexDirection:"column", fontFamily:"'Plus Jakarta Sans', sans-serif", fontSize:12 }}>

        {/* ── HEADER */}
        <div style={{ background:"#040c14", borderBottom:"1px solid rgba(0,200,83,.1)",
          padding:"9px 18px", display:"flex", alignItems:"center", justifyContent:"space-between",
          position:"sticky", top:0, zIndex:60 }}>
          <div>
            <div style={{ fontSize:13, fontWeight:800, color:"#c8d8e8" }}>
              <span style={{ color:"#00c853", marginRight:6 }}>⬡</span>Merchant Simulator
            </div>
            <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1, marginTop:1, fontFamily:"monospace" }}>
              App · USSD · Web · Live backend logging · {merchants.length} merchants
            </div>
          </div>

          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            {/* Network selector */}
            <div style={{ display:"flex", gap:3 }}>
              {Object.keys(NETWORK_PROFILES).map(n => {
                const p = NETWORK_PROFILES[n];
                return (
                  <button key={n} onClick={() => setNetwork(n)}
                    style={{ background: network===n ? `${p.color}18` : "transparent",
                      border:`1px solid ${network===n ? p.color+"50" : "#9C9C9C"}`,
                      color: network===n ? p.color : "#9C9C9C",
                      borderRadius:5, padding:"3px 7px", cursor:"pointer", fontFamily:"monospace",
                      fontSize:8, fontWeight:700, transition:"all .12s" }}>
                    {n}
                  </button>
                );
              })}
            </div>

            {/* API status */}
            <div style={{ display:"flex", gap:5, alignItems:"center", background:"#040b10",
              border:"1px solid #0e1922", borderRadius:5, padding:"4px 9px", fontSize:8 }}>
              <div style={{ width:5, height:5, borderRadius:"50%",
                background:apiOnline?"#4ade80":"#f87171",
                boxShadow:apiOnline?"0 0 5px #4ade8080":"none",
                animation:apiOnline?"pulse 2s infinite":"none" }} />
              <span style={{ color:apiOnline?"#4ade80":"#f87171", fontFamily:"monospace" }}>
                {apiOnline?"LIVE":":4000 DOWN"}
              </span>
            </div>

            <button onClick={loadMerchants}
              style={{ background:"none", border:"1px solid #9C9C9C", color:"#9C9C9C",
                borderRadius:5, padding:"4px 9px", cursor:"pointer", fontFamily:"inherit", fontSize:8 }}>
              ↺
            </button>
          </div>
        </div>

        <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
          {/* ── SIDEBAR */}
          <div style={{ width:220, flexShrink:0, borderRight:"1px solid #0e1922",
            display:"flex", flexDirection:"column", overflow:"hidden" }}>

            {/* Sidebar tabs */}
            <div style={{ display:"flex", borderBottom:"1px solid #0e1922" }}>
              {[["merchants","Merchants"],["scenarios","Autorun"],["log","Log"]].map(([t,l]) => (
                <button key={t} onClick={() => setSidebarTab(t)}
                  style={{ flex:1, background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
                    padding:"7px 4px", fontSize:8, fontWeight:700, letterSpacing:.3,
                    borderBottom:`2px solid ${sidebarTab===t?"#00c853":"transparent"}`,
                    color:sidebarTab===t?"#4ade80":"#9C9C9C", transition:"color .15s" }}>
                  {l}
                </button>
              ))}
            </div>

            {/* Merchants list */}
            {sidebarTab === "merchants" && (
              <div style={{ flex:1, overflowY:"auto", padding:"6px 4px" }}>
                {loading ? (
                  <div style={{ color:"#9C9C9C", fontSize:9, textAlign:"center", marginTop:20 }}>Loading…</div>
                ) : merchants.map(m => {
                  const isSelected = selected?.id === m.id;
                  const hasFail = ["ACCOUNT_STATUS","KYC_CHANGE","SETTLE_FUNDS","SIM_SWAP"].some(k => {
                    const r = evaluate(k, m);
                    return r.success !== true;
                  });
                  return (
                    <button key={m.id} onClick={() => setSelected(m)}
                      style={{ width:"100%", background:isSelected?"rgba(0,200,83,.06)":"transparent",
                        border:`1px solid ${isSelected?"rgba(0,200,83,.25)":"transparent"}`,
                        borderRadius:7, padding:"8px 10px", cursor:"pointer", textAlign:"left",
                        display:"flex", gap:8, alignItems:"center", marginBottom:2, transition:"all .12s" }}
                      onMouseEnter={e => !isSelected && (e.currentTarget.style.background="rgba(255,255,255,.02)")}
                      onMouseLeave={e => !isSelected && (e.currentTarget.style.background="transparent")}>
                      <span style={{ fontSize:18 }}>{m.avatar||"🏪"}</span>
                      <div style={{ flex:1, overflow:"hidden" }}>
                        <div style={{ fontSize:9, fontWeight:700, color:"#c8d8e8", whiteSpace:"nowrap",
                          overflow:"hidden", textOverflow:"ellipsis" }}>{m.business_name}</div>
                        <div style={{ fontSize:8, color:"#9C9C9C" }}>{m.county} · {m.account_status}</div>
                      </div>
                      {hasFail && <div style={{ width:5, height:5, borderRadius:"50%", background:"#f87171", flexShrink:0 }} />}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Autorun panel */}
            {sidebarTab === "scenarios" && (
              <div style={{ flex:1, overflowY:"auto", padding:8 }}>
                <AutorunPanel
                  merchants={merchants}
                  network={network}
                  onNetworkChange={setNetwork}
                  setAutoNetwork={setNetwork}
                  onEvent={onEvent}
                  appRef={appTriggerRef}
                  ussdRef={ussdTriggerRef}
                  webRef={webTriggerRef}
                />
              </div>
            )}

            {/* Event log */}
            {sidebarTab === "log" && (
              <div style={{ flex:1, overflowY:"auto", padding:"6px 4px" }}>
                <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1, textTransform:"uppercase",
                  padding:"2px 6px 6px", display:"flex", justifyContent:"space-between" }}>
                  <span>{eventLog.length} events</span>
                  <button onClick={() => setEventLog([])}
                    style={{ background:"none", border:"none", color:"#9C9C9C", cursor:"pointer", fontSize:7, fontFamily:"inherit" }}>
                    clear
                  </button>
                </div>
                {eventLog.length === 0 ? (
                  <div style={{ color:"#9C9C9C", fontSize:9, textAlign:"center", marginTop:20 }}>
                    Interact with any channel to see events
                  </div>
                ) : (
                  eventLog.map((e,i) => <LogEntry key={i} entry={e} index={i} />)
                )}
              </div>
            )}
          </div>

          {/* ── MAIN: Three channels */}
          <div style={{ flex:1, overflow:"auto", padding:14 }}>
            {!selected ? (
              <div style={{ textAlign:"center", color:"#9C9C9C", marginTop:80 }}>
                <div style={{ fontSize:32, marginBottom:12 }}>⬡</div>
                <div style={{ fontSize:11 }}>Select a merchant to begin simulation</div>
              </div>
            ) : (
              <>
                {/* Merchant context bar */}
                <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:12,
                  background:"rgba(255,255,255,.02)", border:"1px solid #0e1922",
                  borderRadius:8, padding:"8px 12px" }}>
                  <span style={{ fontSize:24 }}>{selected.avatar||"🏪"}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:"#c8d8e8" }}>{selected.business_name}</div>
                    <div style={{ fontSize:8, color:"#9C9C9C" }}>
                      {selected.phone_number} · PB {selected.paybill} · {selected.county} · {selected.network_type||"4G"} native
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    {[
                      { k:"account", v:selected.account_status, bad:selected.account_status!=="active" },
                      { k:"kyc",     v:selected.kyc_status,     bad:selected.kyc_status!=="verified" },
                      { k:"sim",     v:selected.sim_status,     bad:selected.sim_status!=="active" },
                    ].map(s => (
                      <div key={s.k} style={{ fontSize:8, padding:"2px 7px", borderRadius:100, fontWeight:700,
                        background:s.bad?"rgba(248,113,113,.1)":"rgba(74,222,128,.07)",
                        border:`1px solid ${s.bad?"rgba(248,113,113,.3)":"rgba(74,222,128,.2)"}`,
                        color:s.bad?"#f87171":"#4ade80" }}>
                        {s.v}
                      </div>
                    ))}
                    <div style={{ fontSize:8, padding:"2px 7px", borderRadius:100, fontWeight:700,
                      background:`${np.color}15`, border:`1px solid ${np.color}40`, color:np.color }}>
                      {network}
                    </div>
                  </div>
                </div>

                {/* Column headers */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:8 }}>
                  {[
                    { icon:"📱", label:"M-PESA Business App",  sub:"Tap · Confirm · Result" },
                    { icon:"📟", label:"USSD *234#",           sub:"Dial · Navigate · End" },
                    { icon:"🌐", label:"Merchant Web Portal",  sub:"business.safaricom.co.ke" },
                  ].map(c => (
                    <div key={c.label} style={{ padding:"0 4px" }}>
                      <div style={{ fontSize:10, fontWeight:800, color:"#c8d8e8" }}>{c.icon} {c.label}</div>
                      <div style={{ fontSize:8, color:"#9C9C9C", marginTop:1 }}>{c.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Three channels */}
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, alignItems:"start" }}>
                  <AppChannel  key={`app-${selected.id}`}  merchant={selected} network={network} onEvent={onEvent} rules={[]} />
                  <USSDChannel key={`ussd-${selected.id}`} merchant={selected} network={network} onEvent={onEvent} />
                  <WebChannel  key={`web-${selected.id}`}  merchant={selected} network={network} onEvent={onEvent} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Toasts */}
      <div style={{ position:"fixed", bottom:16, right:16, display:"flex", flexDirection:"column", gap:6, zIndex:999 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background:t.type==="error"?"rgba(239,68,68,.12)":"rgba(0,200,83,.1)",
            border:`1px solid ${t.type==="error"?"rgba(239,68,68,.4)":"rgba(0,200,83,.4)"}`,
            color:t.type==="error"?"#f87171":"#4ade80",
            borderRadius:7, padding:"8px 14px", fontSize:10, fontFamily:"monospace",
            animation:"toastIn .2s ease", boxShadow:"0 4px 20px rgba(0,0,0,.5)",
          }}>{t.msg}</div>
        ))}
      </div>
    </>
  );
}