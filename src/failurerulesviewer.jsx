// RulesEngine.jsx
// Rules Engine — 5 tabs: Catalog · Evaluator · Pre-Scanner · Batch Scanner · Provision
// Zero hardcoded data — all from http://localhost:4000/api/v1
// Mission: reduce call-centre demand through proactive automation

import { useState, useEffect, useCallback, useRef } from "react";

// ─── API CLIENT ───────────────────────────────────────────────────────────────
const BASE = "http://localhost:4000/api/v1";
const api = {
  get:    (p)    => fetch(`${BASE}${p}`).then(r => r.json()),
  post:   (p, b) => fetch(`${BASE}${p}`, { method:"POST",  headers:{"Content-Type":"application/json"}, body:JSON.stringify(b) }).then(r => r.json()),
  put:    (p, b) => fetch(`${BASE}${p}`, { method:"PUT",   headers:{"Content-Type":"application/json"}, body:JSON.stringify(b) }).then(r => r.json()),
  delete: (p)    => fetch(`${BASE}${p}`, { method:"DELETE" }).then(r => r.json()),
  upload: (p, f) => fetch(`${BASE}${p}`, { method:"POST", body:f }).then(r => r.json()),
};

// ─── RULE EVALUATION ENGINE (mirrors backend logic) ────────────────────────
// Evaluates a merchant object against each rule's action_key
// Returns { passed, errorCode, severity, inlineMessage, fixMessage }
function evaluateRule(actionKey, merchant) {
  const checks = {
    SETTLE_FUNDS: () => {
      if (merchant.settlement_on_hold == 1 || merchant.settlement_on_hold === true)
        return { passed:false, errorCode:"SETTLEMENT_HOLD", severity:"critical",
          inlineMessage:"Settlement funds are on hold — merchant cannot receive payouts",
          fixMessage:"Verify KYC compliance and lift hold via admin portal" };
      if (merchant.account_status !== "active")
        return { passed:false, errorCode:"ACCOUNT_INACTIVE", severity:"high",
          inlineMessage:"Account not active — settlement blocked",
          fixMessage:"Reactivate account before releasing funds" };
      return { passed:true };
    },
    PIN_PUK: () => {
      if (merchant.pin_locked == 1 || merchant.pin_locked === true)
        return { passed:false, errorCode:"PIN_LOCKED", severity:"high",
          inlineMessage:"PIN is locked after too many failed attempts",
          fixMessage:"Reset PIN via self-service USSD *234*0# or contact centre" };
      if (parseInt(merchant.pin_attempts) >= 2)
        return { passed:false, errorCode:"PIN_ATTEMPTS_HIGH", severity:"medium",
          inlineMessage:`${merchant.pin_attempts}/3 failed PIN attempts — approaching lockout`,
          fixMessage:"Advise merchant to reset PIN before next attempt" };
      return { passed:true };
    },
    SIM_SWAP: () => {
      if (merchant.sim_status === "unregistered")
        return { passed:false, errorCode:"SIM_UNREGISTERED", severity:"critical",
          inlineMessage:"SIM not registered — service will be blocked by CBK mandate",
          fixMessage:"Register SIM immediately at Safaricom agent" };
      if (merchant.sim_status === "swapped")
        return { passed:false, errorCode:"SIM_RECENTLY_SWAPPED", severity:"medium",
          inlineMessage:"SIM was recently swapped — 24h hold applies to transactions",
          fixMessage:"Wait out the 24h hold or escalate for early clearance" };
      return { passed:true };
    },
    ACCOUNT_STATUS: () => {
      if (merchant.account_status === "frozen")
        return { passed:false, errorCode:"ACCOUNT_FROZEN", severity:"critical",
          inlineMessage:"Account is frozen — all services suspended",
          fixMessage:"Contact compliance team to initiate unfreeze procedure" };
      if (merchant.account_status === "suspended")
        return { passed:false, errorCode:"ACCOUNT_SUSPENDED", severity:"high",
          inlineMessage:"Account is suspended",
          fixMessage:"Resolve outstanding compliance flags to reinstate" };
      return { passed:true };
    },
    START_KEY: () => {
      if (merchant.start_key_status === "expired" || merchant.start_key_status === "invalid")
        return { passed:false, errorCode:"START_KEY_INVALID", severity:"high",
          inlineMessage:`Start key is ${merchant.start_key_status} — LNM transactions will fail`,
          fixMessage:"Re-register start key via merchant portal or USSD" };
      return { passed:true };
    },
    STATEMENT: () => {
      if (merchant.account_status !== "active")
        return { passed:false, errorCode:"NO_STATEMENT_ACCESS", severity:"medium",
          inlineMessage:"Account inactive — statement access restricted",
          fixMessage:"Reactivate account to restore full statement access" };
      return { passed:true };
    },
    KYC_CHANGE: () => {
      if (merchant.kyc_status === "expired")
        return { passed:false, errorCode:"KYC_EXPIRED", severity:"critical",
          inlineMessage:`KYC expired (${merchant.kyc_age_days || "?"} days old) — CBK compliance breach`,
          fixMessage:"Submit updated KYC documents immediately via merchant portal" };
      if (merchant.kyc_status === "pending")
        return { passed:false, errorCode:"KYC_PENDING", severity:"medium",
          inlineMessage:"KYC verification pending",
          fixMessage:"Follow up with compliance team on pending KYC submission" };
      if (parseInt(merchant.kyc_age_days) > 300)
        return { passed:false, errorCode:"KYC_EXPIRING_SOON", severity:"low",
          inlineMessage:`KYC expires in ~${365 - parseInt(merchant.kyc_age_days)} days`,
          fixMessage:"Schedule KYC renewal to avoid service interruption" };
      return { passed:true };
    },
    NOTIFICATIONS: () => {
      if (!merchant.notifications_enabled || merchant.notifications_enabled == 0)
        return { passed:false, errorCode:"NOTIFICATIONS_OFF", severity:"low",
          inlineMessage:"Transaction notifications disabled — merchant won't receive alerts",
          fixMessage:"Enable notifications via *234# or M-PESA app settings" };
      return { passed:true };
    },
    BALANCE: () => {
      const bal = parseFloat(merchant.balance) || 0;
      if (bal === 0)
        return { passed:false, errorCode:"ZERO_BALANCE", severity:"medium",
          inlineMessage:"Float balance is zero — outgoing transactions will fail",
          fixMessage:"Top up float via bank transfer or Safaricom agent" };
      if (bal < 500)
        return { passed:false, errorCode:"LOW_BALANCE", severity:"low",
          inlineMessage:`Float balance critically low (KES ${bal.toLocaleString()})`,
          fixMessage:"Top up float soon to avoid service disruption" };
      return { passed:true };
    },
    DORMANT_OP: () => {
      const days = parseInt(merchant.operator_dormant_days) || 0;
      if (days >= 90)
        return { passed:false, errorCode:"OPERATOR_DORMANT", severity:"high",
          inlineMessage:`Operator account dormant for ${days} days — auto-suspension imminent`,
          fixMessage:"Process any transaction to reactivate operator account" };
      if (days >= 30)
        return { passed:false, errorCode:"OPERATOR_INACTIVE", severity:"medium",
          inlineMessage:`Operator inactive for ${days} days`,
          fixMessage:"Advise merchant to log in and process a test transaction" };
      return { passed:true };
    },
    PIN_UNLOCK: () => {
      if (merchant.pin_locked == 1 || merchant.pin_locked === true)
        return { passed:false, errorCode:"PIN_NEEDS_UNLOCK", severity:"high",
          inlineMessage:"PIN is locked — merchant cannot transact",
          fixMessage:"Unlock via USSD self-service or agent-assisted reset" };
      return { passed:true };
    },
    APPLICATION: () => {
      if (merchant.account_status === "frozen" || merchant.account_status === "suspended")
        return { passed:false, errorCode:"APPLICATION_BLOCKED", severity:"high",
          inlineMessage:"Account issues blocking application processing",
          fixMessage:"Resolve account status before resubmitting application" };
      if (merchant.kyc_status !== "verified")
        return { passed:false, errorCode:"KYC_NOT_VERIFIED", severity:"medium",
          inlineMessage:"KYC must be verified before application can proceed",
          fixMessage:"Complete KYC verification first" };
      return { passed:true };
    },
  };
  const fn = checks[actionKey];
  if (!fn) return { passed:true, errorCode:null, severity:"info", inlineMessage:"No evaluation logic for this rule", fixMessage:"" };
  return fn();
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const SEV_COLOR = { critical:"#f87171", high:"#fb923c", medium:"#fbbf24", low:"#a3e635", info:"#60a5fa" };
const SEV_BG    = { critical:"rgba(248,113,113,.1)", high:"rgba(251,146,60,.08)", medium:"rgba(251,191,36,.07)", low:"rgba(163,230,53,.07)", info:"rgba(96,165,250,.07)" };

function fmtDemand(n) {
  if (!n) return "—";
  return n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n);
}

function DemandBar({ value, max }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const color = pct > 70 ? "#f87171" : pct > 40 ? "#fb923c" : "#fbbf24";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      <div style={{ width:60, height:4, background:"#0a1520", borderRadius:2, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:color, transition:"width .4s", boxShadow:`0 0 6px ${color}80` }} />
      </div>
      <span style={{ fontSize:9, color, fontWeight:700, minWidth:30 }}>{fmtDemand(value)}</span>
    </div>
  );
}

function SevBadge({ severity }) {
  const c = SEV_COLOR[severity] || "#4b5563";
  return (
    <span style={{ background:`${c}18`, border:`1px solid ${c}40`, color:c, fontSize:7, fontWeight:800,
      padding:"2px 6px", borderRadius:100, letterSpacing:.8, textTransform:"uppercase" }}>
      {severity}
    </span>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <div onClick={() => !disabled && onChange(!checked)} style={{
      width:32, height:17, borderRadius:100, cursor:disabled?"not-allowed":"pointer",
      background:checked ? "rgba(0,200,83,.3)" : "#0a1520",
      border:`1px solid ${checked ? "rgba(0,200,83,.5)" : "#9C9C9C"}`,
      position:"relative", transition:"all .2s", flexShrink:0,
    }}>
      <div style={{
        width:11, height:11, borderRadius:"50%", position:"absolute", top:2,
        left:checked ? 17 : 2, transition:"left .2s",
        background:checked ? "#4ade80" : "#9C9C9C",
        boxShadow:checked ? "0 0 6px #4ade8080" : "none",
      }} />
    </div>
  );
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div style={{ position:"fixed", bottom:20, right:20, display:"flex", flexDirection:"column", gap:6, zIndex:999 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type==="error" ? "rgba(239,68,68,.12)" : "rgba(0,200,83,.1)",
          border:`1px solid ${t.type==="error" ? "rgba(239,68,68,.4)" : "rgba(0,200,83,.4)"}`,
          color: t.type==="error" ? "#f87171" : "#4ade80",
          borderRadius:7, padding:"8px 14px", fontSize:10,
          animation:"toastIn .2s ease", boxShadow:"0 4px 20px rgba(0,0,0,.5)",
          fontFamily:"inherit",
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1 — RULES CATALOG
// ═══════════════════════════════════════════════════════════════════════════════
function CatalogTab({ rules, loading, onRulesChanged, toast }) {
  const [editing, setEditing] = useState(null); // actionKey being edited
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  const maxDemand = Math.max(...rules.map(r => r.demand_total || 0), 1);
  const totalDemand = rules.reduce((s, r) => s + (r.demand_total || 0), 0);
  const enabledCount = rules.filter(r => r.enabled == 1 || r.enabled === true).length;

  const toggleEnabled = async (rule) => {
    const newVal = !(rule.enabled == 1 || rule.enabled === true);
    try {
      await api.put(`/rules/${rule.action_key}`, { enabled: newVal ? 1 : 0 });
      toast(`${rule.action_key} ${newVal ? "enabled" : "disabled"}`, "success");
      onRulesChanged();
    } catch (e) { toast(`Error: ${e.message}`, "error"); }
  };

  const startEdit = (rule) => {
    setEditing(rule.action_key);
    setEditForm({ demand_total: rule.demand_total, demand_rank: rule.demand_rank, label: rule.label, description: rule.description });
  };

  const saveEdit = async (actionKey) => {
    setSaving(true);
    try {
      await api.put(`/rules/${actionKey}`, editForm);
      toast(`Updated ${actionKey}`, "success");
      setEditing(null);
      onRulesChanged();
    } catch (e) { toast(`Error: ${e.message}`, "error"); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ padding:16 }}>
      {/* Stats row */}
      <div style={{ display:"flex", gap:10, marginBottom:16 }}>
        {[
          { label:"Total Rules",    v:rules.length,                 color:"#e2cfa0" },
          { label:"Enabled",        v:enabledCount,                 color:"#4ade80" },
          { label:"Total Demand",   v:fmtDemand(totalDemand)+" calls", color:"#f87171" },
          { label:"Automatable",    v:rules.filter(r=>r.automatable==1).length, color:"#60a5fa" },
        ].map(({label,v,color}) => (
          <div key={label} style={{ background:"#060d14", border:"1px solid #0e1922", borderRadius:7,
            padding:"10px 14px", flex:1 }}>
            <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.5, textTransform:"uppercase", marginBottom:4 }}>{label}</div>
            <div style={{ fontSize:16, fontWeight:800, color }}>{v}</div>
          </div>
        ))}
      </div>
      {loading ? (
        <div style={{ color:"#9C9C9C", textAlign:"center", padding:40, fontSize:11 }}>Loading rules…</div>
      ) : (
        <div>
          {/* Header row */}
          <div style={{ display:"grid", gridTemplateColumns:"32px 1fr 140px 90px 80px 90px 80px", gap:0,
            padding:"5px 10px", borderBottom:"1px solid #0e1922", marginBottom:4 }}>
            {["#","Rule / Action Key","Label","Demand","Rank","Enabled",""].map((h,i) => (
              <div key={i} style={{ fontSize:7, color:"#9C9C9C", letterSpacing:1.5, textTransform:"uppercase",
                textAlign: i >= 4 ? "center" : "left" }}>{h}</div>
            ))}
          </div>

          {rules.map((rule, idx) => {
            const isEditing = editing === rule.action_key;
            const enabled = rule.enabled == 1 || rule.enabled === true;
            return (
              <div key={rule.action_key} style={{
                display:"grid", gridTemplateColumns:"32px 1fr 140px 90px 80px 90px 80px",
                gap:0, padding:"9px 10px", borderBottom:"1px solid #060d14",
                background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,.01)",
                transition:"background .15s", alignItems:"center",
              }}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(230,175,80,.03)"}
                onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?"transparent":"rgba(255,255,255,.01)"}
              >
                {/* Rank number */}
                <div style={{ fontSize:9, color:"#9C9C9C", fontWeight:700 }}>
                  {rule.demand_rank || idx+1}
                </div>

                {/* Action key + description */}
                <div>
                  <div style={{ fontSize:10, fontWeight:700, color: enabled ? "#e2cfa0" : "#9C9C9C",
                    fontFamily:"monospace", letterSpacing:.3 }}>{rule.action_key}</div>
                  {isEditing ? (
                    <input value={editForm.description || ""} onChange={e=>setEditForm(f=>({...f,description:e.target.value}))}
                      style={{ background:"#040b10", border:"1px solid #9C9C9C", color:"#8ca4bc",
                        borderRadius:3, padding:"2px 6px", fontSize:9, width:"90%", fontFamily:"inherit", outline:"none", marginTop:3 }} />
                  ) : (
                    <div style={{ fontSize:9, color:"#9C9C9C", marginTop:1 }}>{rule.description || "—"}</div>
                  )}
                </div>

                {/* Label */}
                <div>
                  {isEditing ? (
                    <input value={editForm.label || ""} onChange={e=>setEditForm(f=>({...f,label:e.target.value}))}
                      style={{ background:"#040b10", border:"1px solid #9C9C9C", color:"#8ca4bc",
                        borderRadius:3, padding:"2px 6px", fontSize:9, width:"90%", fontFamily:"inherit", outline:"none" }} />
                  ) : (
                    <span style={{ fontSize:9, color:"#8ca4bc" }}>{rule.label || rule.action_key}</span>
                  )}
                </div>

                {/* Demand bar */}
                <div>
                  {isEditing ? (
                    <input type="number" value={editForm.demand_total || 0}
                      onChange={e=>setEditForm(f=>({...f,demand_total:parseInt(e.target.value)||0}))}
                      style={{ background:"#040b10", border:"1px solid #9C9C9C", color:"#fbbf24",
                        borderRadius:3, padding:"2px 6px", fontSize:9, width:70, fontFamily:"inherit", outline:"none" }} />
                  ) : (
                    <DemandBar value={rule.demand_total} max={maxDemand} />
                  )}
                </div>

                {/* Rank */}
                <div style={{ textAlign:"center" }}>
                  {isEditing ? (
                    <input type="number" value={editForm.demand_rank || 0}
                      onChange={e=>setEditForm(f=>({...f,demand_rank:parseInt(e.target.value)||0}))}
                      style={{ background:"#040b10", border:"1px solid #9C9C9C", color:"#8ca4bc",
                        borderRadius:3, padding:"2px 6px", fontSize:9, width:40, fontFamily:"inherit", outline:"none", textAlign:"center" }} />
                  ) : (
                    <span style={{ fontSize:9, color:"#9C9C9C" }}>#{rule.demand_rank || "—"}</span>
                  )}
                </div>

                {/* Toggle */}
                <div style={{ display:"flex", justifyContent:"center" }}>
                  <Toggle checked={enabled} onChange={() => toggleEnabled(rule)} />
                </div>

                {/* Edit / Save */}
                <div style={{ display:"flex", justifyContent:"center", gap:4 }}>
                  {isEditing ? (
                    <>
                      <button onClick={()=>saveEdit(rule.action_key)} disabled={saving}
                        style={{ background:"rgba(0,200,83,.12)", border:"1px solid rgba(0,200,83,.3)", color:"#4ade80",
                          borderRadius:4, padding:"3px 8px", cursor:"pointer", fontSize:8, fontFamily:"inherit" }}>
                        {saving?"…":"Save"}
                      </button>
                      <button onClick={()=>setEditing(null)}
                        style={{ background:"none", border:"1px solid #9C9C9C", color:"#9C9C9C",
                          borderRadius:4, padding:"3px 6px", cursor:"pointer", fontSize:8, fontFamily:"inherit" }}>
                        ✕
                      </button>
                    </>
                  ) : (
                    <button onClick={()=>startEdit(rule)}
                      style={{ background:"none", border:"1px solid #9C9C9C", color:"#9C9C9C",
                        borderRadius:4, padding:"3px 8px", cursor:"pointer", fontSize:8, fontFamily:"inherit",
                        transition:"all .15s" }}
                      onMouseEnter={e=>{e.currentTarget.style.color="#e2cfa0";e.currentTarget.style.borderColor="rgba(226,207,160,.3)"}}
                      onMouseLeave={e=>{e.currentTarget.style.color="#9C9C9C";e.currentTarget.style.borderColor="#9C9C9C"}}>
                      edit
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2 — EVALUATOR (single merchant × single rule)
// ═══════════════════════════════════════════════════════════════════════════════
function EvaluatorTab({ rules, toast }) {
  const [merchants, setMerchants] = useState([]);
  const [loadingM, setLoadingM] = useState(true);
  const [selectedMerchant, setSelectedMerchant] = useState(null);
  const [selectedRule, setSelectedRule] = useState(null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [runningAi, setRunningAi] = useState(false);
  const [autoActions, setAutoActions] = useState([]);

  useEffect(() => {
    api.get("/merchants?limit=200").then(d => {
      setMerchants(Array.isArray(d) ? d : []);
      setLoadingM(false);
    }).catch(()=>setLoadingM(false));
  }, []);

  const runEvaluation = async () => {
    if (!selectedMerchant || !selectedRule) return;
    setRunning(true);
    setResult(null);
    setAiResult(null);
    setAutoActions([]);

    const evalResult = evaluateRule(selectedRule.action_key, selectedMerchant);

    // Log to backend events table
    try {
      await api.post("/events", {
        merchant_id: selectedMerchant.id,
        merchant_name: selectedMerchant.business_name,
        action_key: selectedRule.action_key,
        action_label: selectedRule.label || selectedRule.action_key,
        channel: "twin",
        success: evalResult.passed ? 1 : 0,
        error_code: evalResult.errorCode || null,
        severity: evalResult.severity || "info",
        escalated: evalResult.severity === "critical" ? 1 : 0,
        raw_result: evalResult,
      });

      // If failed, also log an alert
      if (!evalResult.passed) {
        await api.post("/alerts", {
          merchant_id: selectedMerchant.id,
          merchant_name: selectedMerchant.business_name,
          action_key: selectedRule.action_key,
          action_label: selectedRule.label || selectedRule.action_key,
          error_code: evalResult.errorCode,
          severity: evalResult.severity,
          inline_message: evalResult.inlineMessage,
          fix_message: evalResult.fixMessage,
          escalation_msg: evalResult.severity === "critical" ? `Immediate action required: ${evalResult.errorCode}` : null,
        });
      }
    } catch (e) { console.warn("Event log failed:", e.message); }

    // Determine automatable actions
    const autos = [];
    if (!evalResult.passed) {
      if (selectedRule.action_key === "NOTIFICATIONS" && selectedMerchant.preferred_channel === "ussd")
        autos.push({ label:"Auto-enable via USSD", endpoint:"PUT /merchants/:id", automated:true });
      if (selectedRule.action_key === "BALANCE")
        autos.push({ label:"Send low-balance SMS alert", endpoint:"POST /ai/sms", automated:true });
      if (["KYC_CHANGE","ACCOUNT_STATUS"].includes(selectedRule.action_key))
        autos.push({ label:"Generate agent briefing + CRM ticket", endpoint:"POST /ai/briefing", automated:true });
      if (evalResult.severity === "critical")
        autos.push({ label:"Escalate to senior agent queue", endpoint:"POST /crm/tickets", automated:false });
    }
    setAutoActions(autos);
    setResult(evalResult);
    setRunning(false);
    toast(evalResult.passed ? `✓ ${selectedRule.action_key} passed` : `✗ ${selectedRule.action_key} failed — ${evalResult.errorCode}`, evalResult.passed ? "success" : "error");
  };

  const runAiAnalysis = async () => {
    if (!selectedMerchant || !selectedRule || !result) return;
    setRunningAi(true);
    try {
      const data = await api.post("/ai/analyze", {
        merchantId: selectedMerchant.id,
        actionKey: selectedRule.action_key,
        ruleResult: result,
      });
      setAiResult(data);
    } catch (e) { toast("AI analysis failed — check ANTHROPIC_API_KEY", "error"); }
    finally { setRunningAi(false); }
  };

  const enabledRules = rules.filter(r => r.enabled == 1 || r.enabled === true);

  return (
    <div style={{ display:"grid", gridTemplateColumns:"260px 1fr", gap:0, height:"100%", overflow:"hidden" }}>
      {/* Left: pickers */}
      <div style={{ borderRight:"1px solid #0e1922", padding:14, overflowY:"auto", display:"flex", flexDirection:"column", gap:12 }}>
        {/* Merchant picker */}
        <div>
          <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.5, textTransform:"uppercase", marginBottom:6 }}>
            1 · Select Merchant
          </div>
          {loadingM ? (
            <div style={{ fontSize:9, color:"#9C9C9C" }}>Loading…</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:3, maxHeight:220, overflowY:"auto" }}>
              {merchants.map(m => (
                <button key={m.id} onClick={()=>{ setSelectedMerchant(m); setResult(null); }}
                  style={{ background: selectedMerchant?.id===m.id ? "rgba(230,175,80,.08)" : "transparent",
                    border:`1px solid ${selectedMerchant?.id===m.id ? "rgba(230,175,80,.3)" : "transparent"}`,
                    borderRadius:5, padding:"7px 9px", cursor:"pointer", textAlign:"left",
                    display:"flex", gap:7, alignItems:"center", transition:"all .12s" }}
                  onMouseEnter={e=>!( selectedMerchant?.id===m.id)&&(e.currentTarget.style.borderColor="#9C9C9C")}
                  onMouseLeave={e=>!( selectedMerchant?.id===m.id)&&(e.currentTarget.style.borderColor="transparent")}>
                  <span style={{ fontSize:16 }}>{m.avatar||"🏪"}</span>
                  <div>
                    <div style={{ fontSize:9, fontWeight:700, color:"#c8d8e8" }}>{m.business_name}</div>
                    <div style={{ fontSize:8, color:"#9C9C9C" }}>{m.county} · {m.account_status}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Rule picker */}
        <div>
          <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.5, textTransform:"uppercase", marginBottom:6 }}>
            2 · Select Rule
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:3, maxHeight:220, overflowY:"auto" }}>
            {enabledRules.map(r => (
              <button key={r.action_key} onClick={()=>{ setSelectedRule(r); setResult(null); }}
                style={{ background: selectedRule?.action_key===r.action_key ? "rgba(230,175,80,.08)" : "transparent",
                  border:`1px solid ${selectedRule?.action_key===r.action_key ? "rgba(230,175,80,.3)" : "transparent"}`,
                  borderRadius:5, padding:"7px 9px", cursor:"pointer", textAlign:"left",
                  transition:"all .12s" }}
                onMouseEnter={e=>!(selectedRule?.action_key===r.action_key)&&(e.currentTarget.style.borderColor="#9C9C9C")}
                onMouseLeave={e=>!(selectedRule?.action_key===r.action_key)&&(e.currentTarget.style.borderColor="transparent")}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:9, fontFamily:"monospace", fontWeight:700, color:"#e2cfa0" }}>{r.action_key}</span>
                  <span style={{ fontSize:8, color:"#9C9C9C" }}>#{r.demand_rank}</span>
                </div>
                <div style={{ fontSize:8, color:"#9C9C9C", marginTop:2 }}>{fmtDemand(r.demand_total)} calls/qtr</div>
              </button>
            ))}
          </div>
        </div>

        {/* Run button */}
        <button onClick={runEvaluation} disabled={!selectedMerchant || !selectedRule || running}
          style={{ background: (!selectedMerchant||!selectedRule) ? "#060d14" : "rgba(230,175,80,.12)",
            border:`1px solid ${(!selectedMerchant||!selectedRule) ? "#0e1922" : "rgba(230,175,80,.35)"}`,
            color: (!selectedMerchant||!selectedRule) ? "#9C9C9C" : "#e2cfa0",
            borderRadius:6, padding:"10px", fontFamily:"inherit", fontSize:11, fontWeight:800,
            cursor: (!selectedMerchant||!selectedRule||running) ? "not-allowed" : "pointer",
            letterSpacing:.5, transition:"all .2s" }}>
          {running ? "Running…" : "▶ Run Evaluation"}
        </button>
      </div>

      {/* Right: results */}
      <div style={{ overflowY:"auto", padding:16 }}>
        {!result && !running && (
          <div style={{ textAlign:"center", color:"#9C9C9C", marginTop:60 }}>
            <div style={{ fontSize:28, marginBottom:10 }}>◈</div>
            <div style={{ fontSize:10 }}>Select a merchant and rule, then run evaluation</div>
            <div style={{ fontSize:8, marginTop:4, color:"#0e1922" }}>Results are logged to /events and /alerts</div>
          </div>
        )}

        {result && (
          <div style={{ animation:"fadeIn .25s ease" }}>
            {/* Result header */}
            <div style={{ background: result.passed ? "rgba(74,222,128,.06)" : SEV_BG[result.severity],
              border:`1px solid ${result.passed ? "rgba(74,222,128,.2)" : `${SEV_COLOR[result.severity]}40`}`,
              borderRadius:9, padding:14, marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div>
                  <div style={{ fontSize:20, marginBottom:4 }}>{result.passed ? "✓" : "✗"}</div>
                  <div style={{ fontSize:14, fontWeight:800, color: result.passed ? "#4ade80" : SEV_COLOR[result.severity] }}>
                    {result.passed ? "RULE PASSED" : result.errorCode}
                  </div>
                  <div style={{ fontSize:9, color:"#9C9C9C", marginTop:3 }}>
                    {selectedRule?.action_key} → {selectedMerchant?.business_name}
                  </div>
                </div>
                {!result.passed && <SevBadge severity={result.severity} />}
              </div>
              {!result.passed && (
                <div style={{ marginTop:10 }}>
                  <div style={{ fontSize:10, color:"#c8d8e8", lineHeight:1.6 }}>{result.inlineMessage}</div>
                  <div style={{ marginTop:8, background:"rgba(0,0,0,.3)", borderRadius:5, padding:"8px 10px" }}>
                    <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1, textTransform:"uppercase", marginBottom:3 }}>Recommended Fix</div>
                    <div style={{ fontSize:10, color:"#e2cfa0" }}>{result.fixMessage}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Logged to */}
            <div style={{ background:"#060d14", border:"1px solid #0e1922", borderRadius:7, padding:10, marginBottom:12,
              display:"flex", gap:16, fontSize:9, color:"#9C9C9C" }}>
              <div>
                <span style={{ color:"#4ade80" }}>✓</span> Logged to{" "}
                <span style={{ color:"#60a5fa", fontFamily:"monospace" }}>POST /events</span>
              </div>
              {!result.passed && (
                <div>
                  <span style={{ color:"#fbbf24" }}>⚠</span> Alert filed to{" "}
                  <span style={{ color:"#60a5fa", fontFamily:"monospace" }}>POST /alerts</span>
                </div>
              )}
            </div>

            {/* Automation opportunities */}
            {autoActions.length > 0 && (
              <div style={{ background:"rgba(96,165,250,.05)", border:"1px solid rgba(96,165,250,.15)",
                borderRadius:7, padding:12, marginBottom:12 }}>
                <div style={{ fontSize:8, color:"#60a5fa", letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>
                  ⚡ Automation Opportunities — Reduce Call Volume
                </div>
                {autoActions.map((a, i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"6px 0", borderBottom: i < autoActions.length-1 ? "1px solid #0e1922" : "none" }}>
                    <div>
                      <div style={{ fontSize:9, color:"#c8d8e8" }}>{a.label}</div>
                      <div style={{ fontSize:8, color:"#9C9C9C", fontFamily:"monospace" }}>{a.endpoint}</div>
                    </div>
                    <span style={{
                      fontSize:7, padding:"2px 7px", borderRadius:100, fontWeight:800, letterSpacing:.8,
                      background: a.automated ? "rgba(74,222,128,.1)" : "rgba(251,191,36,.08)",
                      border: `1px solid ${a.automated ? "rgba(74,222,128,.3)" : "rgba(251,191,36,.25)"}`,
                      color: a.automated ? "#4ade80" : "#fbbf24",
                    }}>{a.automated ? "AUTO" : "MANUAL"}</span>
                  </div>
                ))}
              </div>
            )}

            {/* AI Analysis */}
            {!result.passed && (
              <div>
                <button onClick={runAiAnalysis} disabled={runningAi}
                  style={{ background:"rgba(139,92,246,.08)", border:"1px solid rgba(139,92,246,.25)",
                    color:"#a78bfa", borderRadius:6, padding:"8px 14px", fontFamily:"inherit",
                    fontSize:10, fontWeight:700, cursor:runningAi?"wait":"pointer", marginBottom:12,
                    width:"100%", transition:"all .2s" }}>
                  {runningAi ? "Running AI Analysis…" : "🧠 Run AI Root-Cause Analysis"}
                </button>

                {aiResult?.success && (
                  <div style={{ background:"rgba(139,92,246,.05)", border:"1px solid rgba(139,92,246,.15)",
                    borderRadius:8, padding:14, animation:"fadeIn .3s ease" }}>
                    <div style={{ fontSize:8, color:"#a78bfa", letterSpacing:1.5, textTransform:"uppercase", marginBottom:10 }}>
                      🧠 Claude Analysis
                    </div>
                    <div style={{ fontSize:10, color:"#c8d8e8", lineHeight:1.7, marginBottom:10 }}>
                      {aiResult.data.compound_analysis}
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                      {[
                        { k:"Risk Score",     v:`${aiResult.data.risk_score}/100`, color: aiResult.data.risk_score > 70 ? "#f87171" : aiResult.data.risk_score > 40 ? "#fbbf24" : "#4ade80" },
                        { k:"Escalate",       v:aiResult.data.escalate_immediately ? "YES" : "NO", color: aiResult.data.escalate_immediately ? "#f87171" : "#4ade80" },
                        { k:"Next Failure",   v:aiResult.data.predicted_next_failure, color:"#fb923c" },
                        { k:"Calls Prevented",v:aiResult.data.calls_prevented_if_resolved, color:"#60a5fa" },
                      ].map(({k,v,color}) => (
                        <div key={k} style={{ background:"#040b10", borderRadius:5, padding:"8px 10px" }}>
                          <div style={{ fontSize:8, color:"#9C9C9C", marginBottom:3 }}>{k}</div>
                          <div style={{ fontSize:10, fontWeight:700, color }}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {aiResult.data.interventions?.length > 0 && (
                      <div style={{ marginTop:10 }}>
                        <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>Interventions</div>
                        {aiResult.data.interventions.map((iv, i) => (
                          <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start", padding:"5px 0",
                            borderBottom:"1px solid #060d14" }}>
                            <span style={{ fontSize:8, color:"#9C9C9C", minWidth:14 }}>P{iv.priority}</span>
                            <div>
                              <div style={{ fontSize:9, color:"#c8d8e8" }}>{iv.action}</div>
                              <div style={{ fontSize:8, color:"#9C9C9C" }}>{iv.channel} · {iv.timeframe}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3 — PRE-SCANNER (live alert feed from backend)
// ═══════════════════════════════════════════════════════════════════════════════
function PreScannerTab({ toast }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [resolving, setResolving] = useState(null);
  const [autoResolving, setAutoResolving] = useState(false);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = filter !== "all" ? `?severity=${filter}` : "";
      const data = await api.get(`/alerts${params}`);
      setAlerts(Array.isArray(data) ? data : []);
    } catch { setAlerts([]); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  const resolveAlert = async (id, merchantName, errorCode) => {
    setResolving(id);
    try {
      await api.post(`/alerts/${id}/resolve`, {});
      toast(`Resolved: ${errorCode} for ${merchantName}`, "success");
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (e) { toast(`Error: ${e.message}`, "error"); }
    finally { setResolving(null); }
  };

  // Auto-resolve all LOW severity (simulate automation)
  const autoResolveLow = async () => {
    const lowAlerts = alerts.filter(a => a.severity === "low");
    if (!lowAlerts.length) { toast("No low-severity alerts to auto-resolve", "success"); return; }
    setAutoResolving(true);
    let count = 0;
    for (const a of lowAlerts) {
      try {
        await api.post(`/alerts/${a.id}/resolve`, {});
        count++;
      } catch {}
    }
    toast(`Auto-resolved ${count} low-severity alerts`, "success");
    await loadAlerts();
    setAutoResolving(false);
  };

  const bySeverity = (sev) => alerts.filter(a => a.severity === sev);
  const sevOrder = ["critical","high","medium","low"];

  return (
    <div style={{ padding:16 }}>
      {/* Controls */}
      <div style={{ display:"flex", gap:8, marginBottom:14, alignItems:"center", flexWrap:"wrap" }}>
        <div style={{ display:"flex", gap:4 }}>
          {["all","critical","high","medium","low"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ background: filter===f ? `${SEV_COLOR[f]||"#8ca4bc"}18` : "transparent",
                border:`1px solid ${filter===f ? `${SEV_COLOR[f]||"#8ca4bc"}40` : "#0e1922"}`,
                color: filter===f ? (SEV_COLOR[f]||"#8ca4bc") : "#9C9C9C",
                borderRadius:5, padding:"4px 10px", cursor:"pointer", fontFamily:"inherit",
                fontSize:9, fontWeight:700, transition:"all .15s" }}>
              {f} {f!=="all" && `(${bySeverity(f).length})`}
            </button>
          ))}
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
          <button onClick={loadAlerts} style={{ background:"none", border:"1px solid #0e1922", color:"#9C9C9C",
            borderRadius:5, padding:"4px 10px", cursor:"pointer", fontFamily:"inherit", fontSize:9 }}>
            ↺ Refresh
          </button>
          <button onClick={autoResolveLow} disabled={autoResolving}
            style={{ background:"rgba(96,165,250,.08)", border:"1px solid rgba(96,165,250,.25)",
              color:"#60a5fa", borderRadius:5, padding:"4px 10px", cursor:"pointer",
              fontFamily:"inherit", fontSize:9, fontWeight:700 }}>
            ⚡ Auto-Resolve Low
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display:"flex", gap:8, marginBottom:14 }}>
        {sevOrder.map(sev => {
          const c = bySeverity(sev).length;
          return (
            <div key={sev} style={{ background:"#060d14", border:`1px solid ${SEV_COLOR[sev]}20`,
              borderRadius:6, padding:"8px 12px", flex:1, cursor:"pointer" }}
              onClick={() => setFilter(sev)}>
              <div style={{ fontSize:8, color:"#9C9C9C", textTransform:"uppercase", letterSpacing:1, marginBottom:3 }}>{sev}</div>
              <div style={{ fontSize:18, fontWeight:800, color: c > 0 ? SEV_COLOR[sev] : "#9C9C9C" }}>{c}</div>
            </div>
          );
        })}
      </div>

      {loading ? (
        <div style={{ color:"#9C9C9C", textAlign:"center", padding:40, fontSize:11 }}>Loading alerts…</div>
      ) : alerts.length === 0 ? (
        <div style={{ textAlign:"center", color:"#9C9C9C", padding:60 }}>
          <div style={{ fontSize:24, marginBottom:8 }}>✓</div>
          <div style={{ fontSize:10 }}>No open alerts{filter !== "all" ? ` at ${filter} severity` : ""}</div>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {alerts.map(alert => (
            <div key={alert.id} style={{
              background: `${SEV_BG[alert.severity]}`,
              border:`1px solid ${SEV_COLOR[alert.severity]}25`,
              borderLeft:`3px solid ${SEV_COLOR[alert.severity]}`,
              borderRadius:7, padding:"10px 12px",
              display:"grid", gridTemplateColumns:"1fr auto",
              gap:10, alignItems:"center",
              animation:"fadeIn .2s ease",
            }}>
              <div>
                <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:5 }}>
                  <SevBadge severity={alert.severity} />
                  <span style={{ fontSize:9, fontFamily:"monospace", fontWeight:700, color:"#e2cfa0" }}>
                    {alert.action_key}
                  </span>
                  <span style={{ fontSize:8, color:"#9C9C9C" }}>·</span>
                  <span style={{ fontSize:8, color:"#9C9C9C", fontFamily:"monospace" }}>{alert.error_code}</span>
                </div>
                <div style={{ fontSize:10, fontWeight:700, color:"#c8d8e8", marginBottom:3 }}>
                  {alert.merchant_name}
                </div>
                <div style={{ fontSize:9, color:"#8ca4bc", lineHeight:1.5 }}>{alert.inline_message}</div>
                {alert.fix_message && (
                  <div style={{ fontSize:9, color:"#9C9C9C", marginTop:4 }}>
                    <span style={{ color:"#4ade80" }}>→</span> {alert.fix_message}
                  </div>
                )}
                <div style={{ fontSize:8, color:"#9C9C9C", marginTop:4 }}>
                  {new Date(alert.created_at).toLocaleString("en-KE")}
                </div>
              </div>
              <button
                onClick={() => resolveAlert(alert.id, alert.merchant_name, alert.error_code)}
                disabled={resolving === alert.id}
                style={{ background:"rgba(74,222,128,.07)", border:"1px solid rgba(74,222,128,.2)",
                  color:"#4ade80", borderRadius:5, padding:"5px 10px", cursor:"pointer",
                  fontFamily:"inherit", fontSize:8, fontWeight:700, transition:"all .15s",
                  opacity: resolving===alert.id ? .5 : 1 }}>
                {resolving===alert.id ? "…" : "Resolve"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4 — BATCH SCANNER (fleet-level risk matrix)
// ═══════════════════════════════════════════════════════════════════════════════
function BatchScannerTab({ rules, toast }) {
  const [merchants, setMerchants] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [matrix, setMatrix] = useState(null);   // { merchants×rules results }
  const [summary, setSummary] = useState(null);
  const [selectedRules, setSelectedRules] = useState([]);
  const [scanScope, setScanScope] = useState("all"); // all | critical | sample
  const abortRef = useRef(false);

  useEffect(() => {
    api.get("/merchants?limit=200").then(d => {
      const m = Array.isArray(d) ? d : [];
      setMerchants(m);
    });
    // Default: select top 5 rules by demand
    setSelectedRules(rules.slice(0, 5).map(r => r.action_key));
  }, [rules]);

  const toggleRule = (key) => {
    setSelectedRules(prev => prev.includes(key) ? prev.filter(k=>k!==key) : [...prev, key]);
  };

  const runBatchScan = async () => {
    if (!merchants.length || !selectedRules.length) return;
    abortRef.current = false;
    setScanning(true);
    setMatrix(null);
    setSummary(null);
    setProgress(0);

    const scope = scanScope === "sample" ? merchants.slice(0, 10)
                : scanScope === "critical" ? merchants.filter(m => m.account_status !== "active" || m.kyc_status === "expired")
                : merchants;

    const results = [];
    const ruleStats = {};
    selectedRules.forEach(k => { ruleStats[k] = { pass:0, fail:0, critical:0, high:0, medium:0, low:0 }; });

    let totalCallsAtRisk = 0;
    const ruleMap = {};
    rules.forEach(r => { ruleMap[r.action_key] = r; });

    for (let i = 0; i < scope.length; i++) {
      if (abortRef.current) break;
      const merchant = scope[i];
      const row = { merchant, results:{} };

      for (const key of selectedRules) {
        const res = evaluateRule(key, merchant);
        row.results[key] = res;

        if (res.passed) {
          ruleStats[key].pass++;
        } else {
          ruleStats[key].fail++;
          ruleStats[key][res.severity] = (ruleStats[key][res.severity] || 0) + 1;
          const rule = ruleMap[key];
          if (rule?.demand_total) totalCallsAtRisk += rule.demand_total;
        }
      }
      results.push(row);
      setProgress(Math.round(((i + 1) / scope.length) * 100));
    }

    // Batch-log failed events to backend (async, don't block)
    const failedEvents = [];
    results.forEach(row => {
      Object.entries(row.results).forEach(([key, res]) => {
        if (!res.passed) {
          failedEvents.push(api.post("/events", {
            merchant_id: row.merchant.id,
            merchant_name: row.merchant.business_name,
            action_key: key,
            action_label: ruleMap[key]?.label || key,
            channel: "batch_scan",
            success: 0,
            error_code: res.errorCode,
            severity: res.severity,
            escalated: res.severity === "critical" ? 1 : 0,
          }).catch(()=>{}));
        }
      });
    });
    Promise.all(failedEvents).catch(()=>{});

    setMatrix(results);
    setSummary({
      scanned: results.length,
      totalMerchants: merchants.length,
      ruleStats,
      totalCallsAtRisk,
      criticalMerchants: results.filter(r => Object.values(r.results).some(res => res.severity === "critical" && !res.passed)).length,
      healthyMerchants:  results.filter(r => Object.values(r.results).every(res => res.passed)).length,
    });
    setScanning(false);
    toast(`Batch scan complete — ${results.length} merchants, ${failedEvents.length} failures logged`, "success");
  };

  const enabledRules = rules.filter(r => r.enabled == 1 || r.enabled === true);
  const ruleMap = {};
  rules.forEach(r => { ruleMap[r.action_key] = r; });

  const getCell = (result) => {
    if (result.passed) return { bg:"rgba(74,222,128,.07)", color:"#4ade80", symbol:"✓" };
    return { bg:SEV_BG[result.severity], color:SEV_COLOR[result.severity], symbol:"✗" };
  };

  return (
    <div style={{ padding:16 }}>
      <div style={{ display:"grid", gridTemplateColumns:"260px 1fr", gap:14 }}>
        {/* Config panel */}
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ background:"#060d14", border:"1px solid #0e1922", borderRadius:8, padding:12 }}>
            <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>Scan Scope</div>
            {[
              { v:"all",      label:"All Merchants",   sub:`${merchants.length} total` },
              { v:"sample",   label:"Sample (10)",     sub:"Quick test run" },
              { v:"critical", label:"At-Risk Only",    sub:"Non-active / expired KYC" },
            ].map(opt => (
              <label key={opt.v} style={{ display:"flex", gap:8, alignItems:"center", padding:"6px 0",
                borderBottom:"1px solid #0a1520", cursor:"pointer" }}>
                <input type="radio" name="scope" checked={scanScope===opt.v}
                  onChange={() => setScanScope(opt.v)}
                  style={{ accentColor:"#e2cfa0" }} />
                <div>
                  <div style={{ fontSize:9, color:"#c8d8e8" }}>{opt.label}</div>
                  <div style={{ fontSize:8, color:"#9C9C9C" }}>{opt.sub}</div>
                </div>
              </label>
            ))}
          </div>

          <div style={{ background:"#060d14", border:"1px solid #0e1922", borderRadius:8, padding:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.5, textTransform:"uppercase" }}>Rules to Scan</div>
              <div style={{ display:"flex", gap:4 }}>
                <button onClick={() => setSelectedRules(enabledRules.map(r=>r.action_key))}
                  style={{ background:"none", border:"none", color:"#9C9C9C", fontSize:8, cursor:"pointer", fontFamily:"inherit" }}>
                  all
                </button>
                <button onClick={() => setSelectedRules([])}
                  style={{ background:"none", border:"none", color:"#9C9C9C", fontSize:8, cursor:"pointer", fontFamily:"inherit" }}>
                  none
                </button>
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:200, overflowY:"auto" }}>
              {enabledRules.map(r => (
                <label key={r.action_key} style={{ display:"flex", gap:7, alignItems:"center", cursor:"pointer" }}>
                  <input type="checkbox" checked={selectedRules.includes(r.action_key)}
                    onChange={() => toggleRule(r.action_key)}
                    style={{ accentColor:"#e2cfa0" }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:9, color:"#c8d8e8", fontFamily:"monospace" }}>{r.action_key}</div>
                  </div>
                  <span style={{ fontSize:8, color:"#9C9C9C" }}>{fmtDemand(r.demand_total)}</span>
                </label>
              ))}
            </div>
          </div>

          <button onClick={runBatchScan} disabled={scanning || !selectedRules.length}
            style={{ background: scanning ? "#060d14" : "rgba(230,175,80,.12)",
              border:`1px solid ${scanning ? "#0e1922" : "rgba(230,175,80,.35)"}`,
              color: scanning ? "#9C9C9C" : "#e2cfa0",
              borderRadius:6, padding:"10px", fontFamily:"inherit", fontSize:11, fontWeight:800,
              cursor: scanning ? "wait" : "pointer", letterSpacing:.5, transition:"all .2s" }}>
            {scanning ? `Scanning… ${progress}%` : "▶ Run Batch Scan"}
          </button>

          {scanning && (
            <div style={{ background:"#040b10", borderRadius:4, overflow:"hidden", height:4 }}>
              <div style={{ width:`${progress}%`, height:"100%", background:"#e2cfa0",
                transition:"width .15s", boxShadow:"0 0 8px #e2cfa080" }} />
            </div>
          )}
        </div>

        {/* Results */}
        <div style={{ overflow:"hidden", display:"flex", flexDirection:"column", gap:12 }}>
          {!matrix && !scanning && (
            <div style={{ textAlign:"center", color:"#9C9C9C", marginTop:60 }}>
              <div style={{ fontSize:28, marginBottom:10 }}>⚡</div>
              <div style={{ fontSize:10 }}>Configure scope and rules, then run batch scan</div>
              <div style={{ fontSize:8, marginTop:4 }}>Failures are batch-logged to /events</div>
            </div>
          )}

          {summary && (
            <div>
              {/* Summary stats */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8, marginBottom:12 }}>
                {[
                  { label:"Scanned",       v:summary.scanned,           color:"#e2cfa0" },
                  { label:"Healthy",       v:summary.healthyMerchants,  color:"#4ade80" },
                  { label:"Critical",      v:summary.criticalMerchants, color:"#f87171" },
                  { label:"Calls at Risk", v:fmtDemand(summary.totalCallsAtRisk), color:"#fb923c" },
                ].map(({label,v,color}) => (
                  <div key={label} style={{ background:"#060d14", border:`1px solid ${color}20`, borderRadius:7, padding:"10px 12px" }}>
                    <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>{label}</div>
                    <div style={{ fontSize:16, fontWeight:800, color }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Per-rule breakdown */}
              <div style={{ background:"#060d14", border:"1px solid #0e1922", borderRadius:7, padding:10, marginBottom:12 }}>
                <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>Rule Failure Breakdown</div>
                {selectedRules.map(key => {
                  const stat = summary.ruleStats[key] || {};
                  const total = (stat.pass||0) + (stat.fail||0);
                  const failRate = total > 0 ? ((stat.fail||0)/total*100) : 0;
                  const rule = ruleMap[key];
                  return (
                    <div key={key} style={{ display:"flex", alignItems:"center", gap:10, padding:"5px 0",
                      borderBottom:"1px solid #0a1520" }}>
                      <span style={{ fontSize:9, fontFamily:"monospace", color:"#e2cfa0", minWidth:130 }}>{key}</span>
                      <div style={{ flex:1, height:4, background:"#040b10", borderRadius:2, overflow:"hidden" }}>
                        <div style={{ width:`${failRate}%`, height:"100%", background: failRate>50?"#f87171":failRate>25?"#fbbf24":"#4ade80",
                          transition:"width .4s" }} />
                      </div>
                      <span style={{ fontSize:8, color:"#9C9C9C", minWidth:45, textAlign:"right" }}>
                        {stat.fail||0}/{total} fail
                      </span>
                      <span style={{ fontSize:8, color:"#9C9C9C", minWidth:50, textAlign:"right" }}>
                        {fmtDemand(rule?.demand_total)} calls
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Matrix grid */}
              <div style={{ overflowX:"auto" }}>
                <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>
                  Risk Matrix — {summary.scanned} merchants × {selectedRules.length} rules
                </div>
                {/* Rule headers */}
                <div style={{ display:"grid",
                  gridTemplateColumns:`160px repeat(${selectedRules.length}, 80px)`,
                  gap:0, marginBottom:3 }}>
                  <div />
                  {selectedRules.map(key => (
                    <div key={key} style={{ fontSize:7, color:"#9C9C9C", textAlign:"center",
                      textTransform:"uppercase", letterSpacing:.5, padding:"0 2px",
                      writingMode:"initial", overflow:"hidden", textOverflow:"ellipsis",
                      whiteSpace:"nowrap" }}>
                      {key.replace("_"," ")}
                    </div>
                  ))}
                </div>
                {/* Rows */}
                <div style={{ maxHeight:340, overflowY:"auto" }}>
                  {matrix.map((row, i) => {
                    const allPass = Object.values(row.results).every(r => r.passed);
                    return (
                      <div key={row.merchant.id} style={{
                        display:"grid",
                        gridTemplateColumns:`160px repeat(${selectedRules.length}, 80px)`,
                        gap:0, marginBottom:2,
                      }}>
                        <div style={{ display:"flex", gap:5, alignItems:"center",
                          background: allPass ? "transparent" : "rgba(248,113,113,.03)",
                          padding:"3px 6px", borderRadius:"5px 0 0 5px" }}>
                          <span style={{ fontSize:13 }}>{row.merchant.avatar||"🏪"}</span>
                          <div>
                            <div style={{ fontSize:8, color:"#c8d8e8", fontWeight:700,
                              maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {row.merchant.business_name}
                            </div>
                            <div style={{ fontSize:7, color:"#9C9C9C" }}>{row.merchant.county}</div>
                          </div>
                        </div>
                        {selectedRules.map(key => {
                          const res = row.results[key];
                          const cell = getCell(res);
                          return (
                            <div key={key} title={res.passed ? "Passed" : `${res.errorCode}: ${res.inlineMessage}`}
                              style={{ background:cell.bg, color:cell.color,
                                display:"flex", alignItems:"center", justifyContent:"center",
                                fontSize:10, fontWeight:700, borderRight:"1px solid #040b10",
                                borderBottom:"1px solid #040b10", cursor:"default",
                                transition:"transform .1s" }}
                              onMouseEnter={e=>e.currentTarget.style.transform="scale(1.15)"}
                              onMouseLeave={e=>e.currentTarget.style.transform="none"}>
                              {cell.symbol}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 5 — PROVISION (add rule / upload)
// ═══════════════════════════════════════════════════════════════════════════════
function ProvisionTab({ onRulesChanged, toast }) {
  const [mode, setMode] = useState("add"); // add | upload
  const [form, setForm] = useState({
    action_key:"", label:"", description:"", demand_total:0, demand_rank:0, enabled:1, automatable:0,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();
  const [uploadHistory, setUploadHistory] = useState([]);

  useEffect(() => {
    api.get("/uploads").then(d => setUploadHistory(Array.isArray(d) ? d.filter(u=>u.upload_type==="rules") : [])).catch(()=>{});
  }, []);

  const set = (k,v) => setForm(f => ({...f, [k]:v}));

  const submitNew = async () => {
    if (!form.action_key.trim()) { toast("action_key is required", "error"); return; }
    setSaving(true);
    try {
      await api.post("/rules", {
        ...form,
        action_key: form.action_key.toUpperCase().replace(/\s+/g,"_"),
        enabled: form.enabled ? 1 : 0,
        automatable: form.automatable ? 1 : 0,
      });
      toast(`✓ Rule ${form.action_key.toUpperCase()} created`, "success");
      setForm({ action_key:"", label:"", description:"", demand_total:0, demand_rank:0, enabled:1, automatable:0 });
      onRulesChanged();
    } catch (e) { toast(`Error: ${e.message}`, "error"); }
    finally { setSaving(false); }
  };

  const doUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const data = await api.upload("/upload/rules", fd);
      setUploadResult(data);
      if (data.success_count > 0) { toast(`✓ Imported ${data.success_count} rules`, "success"); onRulesChanged(); }
      api.get("/uploads").then(d => setUploadHistory(Array.isArray(d) ? d.filter(u=>u.upload_type==="rules") : [])).catch(()=>{});
    } catch (e) { toast(`Upload failed: ${e.message}`, "error"); }
    finally { setUploading(false); }
  };

  return (
    <div style={{ padding:16, display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
      {/* Add new rule */}
      <div style={{ background:"#060d14", border:"1px solid rgba(230,175,80,.15)", borderRadius:9, padding:14 }}>
        <div style={{ fontSize:8, color:"#e2cfa0", letterSpacing:1.5, textTransform:"uppercase", marginBottom:12 }}>
          + Add New Rule
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
          {[
            { k:"action_key",   label:"Action Key *",  placeholder:"NEW_RULE (auto-uppercased)" },
            { k:"label",        label:"Label",          placeholder:"Human-readable name" },
            { k:"description",  label:"Description",    placeholder:"What this rule checks" },
            { k:"demand_total", label:"Q4 Demand",      placeholder:"0", type:"number" },
            { k:"demand_rank",  label:"Demand Rank",    placeholder:"0", type:"number" },
          ].map(({k,label,placeholder,type}) => (
            <div key={k}>
              <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1, textTransform:"uppercase", marginBottom:3 }}>{label}</div>
              <input
                type={type||"text"}
                value={form[k]}
                onChange={e=>set(k, type==="number" ? parseInt(e.target.value)||0 : e.target.value)}
                placeholder={placeholder}
                style={{ background:"#040b10", border:"1px solid #9C9C9C", color:"#dde8f4",
                  borderRadius:5, padding:"6px 9px", fontSize:10, outline:"none",
                  fontFamily:"inherit", width:"100%", transition:"border-color .15s" }}
                onFocus={e=>e.currentTarget.style.borderColor="rgba(230,175,80,.4)"}
                onBlur={e=>e.currentTarget.style.borderColor="#9C9C9C"}
              />
            </div>
          ))}

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {[
              { k:"enabled",     label:"Enabled by default" },
              { k:"automatable", label:"Automatable (no human needed)" },
            ].map(({k,label}) => (
              <label key={k} style={{ display:"flex", gap:7, alignItems:"center", cursor:"pointer" }}>
                <Toggle checked={form[k]==1||form[k]===true} onChange={v=>set(k,v?1:0)} />
                <span style={{ fontSize:9, color:"#8ca4bc" }}>{label}</span>
              </label>
            ))}
          </div>

          <button onClick={submitNew} disabled={saving}
            style={{ background:"rgba(230,175,80,.12)", border:"1px solid rgba(230,175,80,.35)",
              color:"#e2cfa0", borderRadius:6, padding:"9px", fontFamily:"inherit",
              fontSize:11, fontWeight:800, cursor:saving?"wait":"pointer",
              opacity:saving?.6:1, letterSpacing:.5 }}>
            {saving ? "Creating…" : "Create Rule"}
          </button>

          <div style={{ fontSize:8, color:"#9C9C9C", lineHeight:1.7 }}>
            Rule will be available immediately in Catalog, Evaluator, and Batch Scanner.
            Add evaluation logic in <span style={{ color:"#e2cfa0", fontFamily:"monospace" }}>rulesEngine.jsx</span> → <span style={{ fontFamily:"monospace", color:"#9C9C9C" }}>evaluateRule()</span>.
          </div>
        </div>
      </div>

      {/* Right column: upload + history */}
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {/* Upload */}
        <div style={{ background:"#060d14", border:"1px solid rgba(139,92,246,.2)", borderRadius:9, padding:14 }}>
          <div style={{ fontSize:8, color:"#a78bfa", letterSpacing:1.5, textTransform:"uppercase", marginBottom:10 }}>
            ↑ Upload Rules CSV
          </div>
          <div style={{ fontSize:9, color:"#9C9C9C", lineHeight:1.7, marginBottom:10 }}>
            CSV columns: <span style={{ color:"#a78bfa", fontFamily:"monospace" }}>action_key, demand_total, demand_rank, enabled</span>
          </div>
          <button onClick={() => window.open(`${BASE}/upload/rules/template`,"_blank")}
            style={{ background:"none", border:"1px solid #9C9C9C", color:"#9C9C9C",
              borderRadius:5, padding:"5px 10px", cursor:"pointer", fontFamily:"inherit",
              fontSize:9, marginBottom:10 }}>
            ↓ Download Template
          </button>

          <div
            onDragOver={e=>{e.preventDefault();setDragging(true)}}
            onDragLeave={()=>setDragging(false)}
            onDrop={e=>{e.preventDefault();setDragging(false);doUpload(e.dataTransfer.files[0])}}
            onClick={()=>fileRef.current?.click()}
            style={{ border:`2px dashed ${dragging?"rgba(139,92,246,.5)":"rgba(139,92,246,.2)"}`,
              borderRadius:7, padding:"20px", textAlign:"center", cursor:"pointer",
              background:dragging?"rgba(139,92,246,.04)":"transparent", transition:"all .15s" }}>
            <div style={{ fontSize:20, marginBottom:6 }}>📋</div>
            <div style={{ fontSize:9, color:"#9C9C9C" }}>
              {uploading ? "Uploading…" : "Drop CSV/Excel or click to browse"}
            </div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display:"none" }}
              onChange={e=>doUpload(e.target.files?.[0])} />
          </div>

          {uploadResult && (
            <div style={{ marginTop:10, background:"#040b10", borderRadius:6, padding:10 }}>
              {[
                ["File",     uploadResult.filename],
                ["Rows",     uploadResult.row_count],
                ["Imported", uploadResult.success_count],
                ["Errors",   uploadResult.error_count],
              ].map(([k,v]) => (
                <div key={k} style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                  <span style={{ fontSize:8, color:"#9C9C9C" }}>{k}</span>
                  <span style={{ fontSize:8, color:"#8ca4bc" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upload history */}
        <div style={{ background:"#060d14", border:"1px solid #0e1922", borderRadius:9, padding:14, flex:1 }}>
          <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.5, textTransform:"uppercase", marginBottom:8 }}>
            Upload History
          </div>
          {uploadHistory.length === 0 ? (
            <div style={{ fontSize:9, color:"#9C9C9C" }}>No rule uploads yet</div>
          ) : (
            uploadHistory.slice(0,8).map((u,i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"5px 0", borderBottom:"1px solid #0a1520" }}>
                <div>
                  <div style={{ fontSize:9, color:"#8ca4bc" }}>{u.filename || u.file_name}</div>
                  <div style={{ fontSize:8, color:"#9C9C9C" }}>{new Date(u.created_at).toLocaleString("en-KE")}</div>
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  <span style={{ fontSize:8, color:"#4ade80" }}>+{u.success_count||0}</span>
                  {(u.error_count||0) > 0 && <span style={{ fontSize:8, color:"#f87171" }}>✗{u.error_count}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function RulesEngine() {
  const [rules, setRules]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [apiOnline, setApiOnline] = useState(null);
  const [activeTab, setActiveTab] = useState("catalog");
  const [toasts, setToasts]     = useState([]);

  const toast = useCallback((msg, type="success") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/rules");
      console.log(data)
      setRules(Array.isArray(data) ? data : []);
      setApiOnline(true);
    } catch {
      setApiOnline(false);
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRules(); }, [loadRules]);

  const TABS = [
    { id:"catalog",     label:"Catalog",     icon:"◈", sub:"All rules + demand" },
    { id:"evaluator",   label:"Evaluator",   icon:"▶", sub:"Single merchant × rule" },
    { id:"prescanner",  label:"Pre-Scanner", icon:"⚠", sub:"Live alert feed" },
    { id:"batch",       label:"Batch Scan",  icon:"⚡", sub:"Fleet risk matrix" },
    { id:"provision",   label:"Provision",   icon:"+", sub:"Add / upload rules" },
  ];

  const enabledCount = rules.filter(r => r.enabled==1||r.enabled===true).length;
  const totalDemand = rules.reduce((s,r) => s + (r.demand_total||0), 0);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,700;1,400&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:#04080d}
        ::-webkit-scrollbar-thumb{background:#0e1922;border-radius:2px}
        @keyframes toastIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
        @keyframes scanPulse{0%,100%{opacity:.5}50%{opacity:1}}
        input[type=checkbox]{accent-color:#e2cfa0}
        input[type=radio]{accent-color:#e2cfa0}
      `}</style>

      <div style={{ background:"#030810", color:"#c8d8e8", minHeight:"100vh",
        display:"flex", flexDirection:"column", fontFamily:"'IBM Plex Mono', monospace", fontSize:12 }}>

        {/* ── HEADER */}
        <div style={{ background:"#050c14", borderBottom:"1px solid rgba(230,175,80,.12)",
          padding:"9px 18px", display:"flex", alignItems:"center", justifyContent:"space-between",
          position:"sticky", top:0, zIndex:50 }}>
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:"#e2cfa0", letterSpacing:-.2 }}>
              <span style={{ color:"#b8903c", marginRight:6 }}>⬡</span>Rules Engine
            </div>
            <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1, marginTop:1 }}>
              Digital Twin · Demand Reduction · /api/v1/rules
            </div>
          </div>

          <div style={{ display:"flex", gap:12, alignItems:"center", fontSize:8, color:"#9C9C9C" }}>
            <span><span style={{ color:"#e2cfa0", fontWeight:700 }}>{rules.length}</span> rules</span>
            <span><span style={{ color:"#4ade80", fontWeight:700 }}>{enabledCount}</span> enabled</span>
            <span><span style={{ color:"#f87171", fontWeight:700 }}>{fmtDemand(totalDemand)}</span> calls/qtr</span>
            <button onClick={loadRules} style={{ background:"none", border:"1px solid #0e1922",
              color:"#9C9C9C", borderRadius:4, padding:"3px 8px", cursor:"pointer", fontFamily:"inherit", fontSize:8 }}>
              ↺
            </button>
            <div style={{ display:"flex", gap:5, alignItems:"center", background:"#040b10",
              border:"1px solid #0e1922", borderRadius:4, padding:"3px 9px" }}>
              <div style={{ width:4, height:4, borderRadius:"50%",
                background: apiOnline===null ? "#9C9C9C" : apiOnline ? "#4ade80" : "#f87171",
                boxShadow: apiOnline ? "0 0 5px #4ade8080" : "none" }} />
              <span style={{ color: apiOnline ? "#4ade80" : "#f87171", fontSize:8 }}>
                {apiOnline===null ? "…" : apiOnline ? ":4000 live" : "offline"}
              </span>
            </div>
          </div>
        </div>

        {/* offline banner */}
        {apiOnline === false && (
          <div style={{ background:"rgba(239,68,68,.06)", borderBottom:"1px solid rgba(239,68,68,.15)",
            padding:"7px 18px", fontSize:9, color:"#f87171" }}>
            ⚠ Backend unreachable at {BASE} — run <code style={{ color:"#fbbf24" }}>npm run dev</code>
          </div>
        )}

        {/* ── TAB BAR */}
        <div style={{ background:"#040b10", borderBottom:"1px solid #0a1520",
          display:"flex", padding:"0 18px", overflowX:"auto", flexShrink:0 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{ background:"none", border:"none", cursor:"pointer", fontFamily:"inherit",
                padding:"9px 16px", fontSize:10, fontWeight:700, letterSpacing:.3,
                borderBottom: activeTab===t.id ? "2px solid #e2cfa0" : "2px solid transparent",
                color: activeTab===t.id ? "#e2cfa0" : "#9C9C9C",
                transition:"color .15s", display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
              <span>{t.icon} {t.label}</span>
              <span style={{ fontSize:7, color: activeTab===t.id ? "#6b5020" : "#9C9C9C",
                fontWeight:400, letterSpacing:.5 }}>{t.sub}</span>
            </button>
          ))}
        </div>

        {/* ── TAB CONTENT */}
        <div style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
          {activeTab === "catalog"    && <div style={{ flex:1, overflowY:"auto" }}><CatalogTab    rules={rules} loading={loading} onRulesChanged={loadRules} toast={toast} /></div>}
          {activeTab === "evaluator"  && <div style={{ flex:1, overflow:"hidden", display:"flex" }}><EvaluatorTab  rules={rules} toast={toast} /></div>}
          {activeTab === "prescanner" && <div style={{ flex:1, overflowY:"auto" }}><PreScannerTab toast={toast} /></div>}
          {activeTab === "batch"      && <div style={{ flex:1, overflowY:"auto" }}><BatchScannerTab rules={rules} toast={toast} /></div>}
          {activeTab === "provision"  && <div style={{ flex:1, overflowY:"auto" }}><ProvisionTab  onRulesChanged={loadRules} toast={toast} /></div>}
        </div>

        <Toast toasts={toasts} />
      </div>
    </>
  );
}