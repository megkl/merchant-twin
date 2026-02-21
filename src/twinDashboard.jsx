// TwinDashboard.jsx
// Safaricom LNM Merchant Digital Twin — Mission Control Dashboard
// Real-time: polls /events (3s), /alerts (5s), /analytics/fleet (10s)
// Panels: Fleet Overview · Pre-failure Alerts · Activity Log · Demand Heatmap · Merchant Deep-Dive

import { useState, useEffect, useCallback, useRef } from "react";

// ─── API ──────────────────────────────────────────────────────────────────────
const BASE = "http://localhost:4000/api/v1";
const api = {
  get:  (p, q={}) => {
    const qs = Object.keys(q).length ? "?" + new URLSearchParams(q).toString() : "";
    return fetch(`${BASE}${p}${qs}`).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); });
  },
  post: (p, b) => fetch(`${BASE}${p}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(b) }).then(r => r.json()),
};

// ─── COLOURS ──────────────────────────────────────────────────────────────────
const SEV = {
  critical: { bg:"rgba(239,68,68,.12)",  border:"rgba(239,68,68,.35)",  text:"#f87171",  dot:"#ef4444" },
  high:     { bg:"rgba(251,146,60,.1)",   border:"rgba(251,146,60,.3)",  text:"#fb923c",  dot:"#f97316" },
  medium:   { bg:"rgba(251,191,36,.08)",  border:"rgba(251,191,36,.25)", text:"#fbbf24",  dot:"#eab308" },
  low:      { bg:"rgba(96,165,250,.07)",  border:"rgba(96,165,250,.2)",  text:"#60a5fa",  dot:"#3b82f6" },
  info:     { bg:"rgba(74,222,128,.06)",  border:"rgba(74,222,128,.18)", text:"#4ade80",  dot:"#22c55e" },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmtK = n => n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n||0);
const fmtTime = d => new Date(d).toLocaleTimeString("en-KE", { hour12:false });
const fmtDate = d => new Date(d).toLocaleDateString("en-KE", { day:"2-digit", month:"short" });
const elapsed = d => {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
};

// ─── LIVE TICKER ─────────────────────────────────────────────────────────────
function Ticker({ value, color="#f87171", size=28 }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (value !== prev.current) {
      setFlash(true);
      setTimeout(() => { setDisplay(value); setFlash(false); }, 150);
      prev.current = value;
    }
  }, [value]);

  return (
    <span style={{
      fontSize: size, fontWeight:800, color: flash ? "#fff" : color,
      transition:"color .15s", fontFamily:"'DM Mono', monospace",
      textShadow: flash ? `0 0 20px ${color}` : "none",
    }}>{display}</span>
  );
}

// ─── PULSE DOT ────────────────────────────────────────────────────────────────
function PulseDot({ color="#4ade80", size=7 }) {
  return (
    <span style={{ position:"relative", display:"inline-block", width:size, height:size, flexShrink:0 }}>
      <span style={{ position:"absolute", inset:0, borderRadius:"50%", background:color, animation:"dotPing 1.5s ease infinite", opacity:.7 }} />
      <span style={{ position:"absolute", inset:0, borderRadius:"50%", background:color }} />
    </span>
  );
}

// ─── SECTION HEADER ──────────────────────────────────────────────────────────
function SectionHeader({ icon, title, sub, live, count, color="#e2cfa0" }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <span style={{ fontSize:14 }}>{icon}</span>
        <div>
          <div style={{ fontSize:11, fontWeight:800, color, letterSpacing:.3 }}>{title}</div>
          {sub && <div style={{ fontSize:8, color:"#9C9C9C", marginTop:1 }}>{sub}</div>}
        </div>
      </div>
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        {count !== undefined && (
          <span style={{ fontSize:9, color:"#9C9C9C", background:"#060d14", border:"1px solid #9C9C9C",
            borderRadius:4, padding:"2px 7px", fontFamily:"monospace" }}>
            {count}
          </span>
        )}
        {live && (
          <div style={{ display:"flex", gap:4, alignItems:"center", background:"rgba(74,222,128,.07)",
            border:"1px solid rgba(74,222,128,.2)", borderRadius:4, padding:"2px 7px" }}>
            <PulseDot color="#4ade80" size={5} />
            <span style={{ fontSize:8, color:"#4ade80", fontWeight:700 }}>LIVE</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL 1 — FLEET OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════
function FleetOverview({ merchants, events, alerts, rules }) {
  // Compute fleet stats from live data
  const total = merchants.length;
  const active = merchants.filter(m => m.account_status === "active").length;
  const frozen = merchants.filter(m => m.account_status === "frozen").length;
  const suspended = merchants.filter(m => m.account_status === "suspended").length;
  const kycExpired = merchants.filter(m => m.kyc_status === "expired").length;
  const pinLocked = merchants.filter(m => m.pin_locked == 1).length;
  const simIssue = merchants.filter(m => m.sim_status !== "active").length;
  const settlementHold = merchants.filter(m => m.settlement_on_hold == 1).length;
  const zeroBalance = merchants.filter(m => parseFloat(m.balance||0) === 0).length;
  const openAlerts = alerts.filter(a => !a.resolved).length;
  const criticalAlerts = alerts.filter(a => a.severity === "critical" && !a.resolved).length;
  const recentEvents = events.filter(e => {
    const age = (Date.now() - new Date(e.created_at)) / 60000;
    return age < 60;
  }).length;
  const failRate = events.length > 0
    ? Math.round((events.filter(e => e.success === 0).length / events.length) * 100)
    : 0;

  // Top demand rules
  const sortedRules = [...rules].sort((a,b) => (b.demand_total||0) - (a.demand_total||0));
  const totalDemand = rules.reduce((s,r) => s + (r.demand_total||0), 0);

  // Channel breakdown from events
  const channels = ["app","ussd","web","twin","batch_scan"];
  const channelCounts = Object.fromEntries(channels.map(c => [c, events.filter(e=>e.channel===c).length]));

  // Behaviour type breakdown
  const networkBreakdown = ["4G","3G","2G","5G"].map(n => ({
    label: n,
    count: merchants.filter(m => m.network_type === n).length,
    color: n==="5G"?"#4ade80":n==="4G"?"#60a5fa":n==="3G"?"#fbbf24":"#f87171",
  }));

  const channelPref = ["app","ussd","web"].map(c => ({
    label: c.toUpperCase(),
    count: merchants.filter(m => m.preferred_channel === c).length,
    icon: c==="app"?"📱":c==="ussd"?"📟":"🌐",
  }));

  const tierCounts = { high:0, medium:0, low:0 };
  merchants.forEach(m => {
    const t = m.transaction_tier || "medium";
    if (tierCounts[t] !== undefined) tierCounts[t]++;
  });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <SectionHeader icon="🛰️" title="FLEET OVERVIEW" sub={`${total} merchants monitored`} live count={`${active} active`} />

      {/* KPI row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
        {[
          { label:"Total Fleet",    v:total,          color:"#c8d8e8", sub:"merchants" },
          { label:"Active",         v:active,         color:"#4ade80", sub:`${Math.round(active/total*100)||0}% healthy` },
          { label:"Open Alerts",    v:openAlerts,     color: openAlerts>0?"#f87171":"#4ade80", sub:`${criticalAlerts} critical` },
          { label:"Failure Rate",   v:`${failRate}%`, color: failRate>30?"#f87171":failRate>15?"#fbbf24":"#4ade80", sub:"of all events" },
        ].map(k => (
          <div key={k.label} style={{ background:"#060d14", border:"1px solid #0e1922",
            borderRadius:8, padding:"10px 12px" }}>
            <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.2, textTransform:"uppercase", marginBottom:4 }}>{k.label}</div>
            <Ticker value={k.v} color={k.color} size={22} />
            <div style={{ fontSize:8, color:"#9C9C9C", marginTop:3 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Sensor issue summary */}
      <div style={{ background:"#060d14", border:"1px solid #0e1922", borderRadius:8, padding:12 }}>
        <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.2, textTransform:"uppercase", marginBottom:8 }}>SENSOR FAILURE DISTRIBUTION</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
          {[
            { label:"Frozen",         v:frozen,         color:"#f87171", icon:"🧊" },
            { label:"Suspended",      v:suspended,      color:"#fb923c", icon:"⛔" },
            { label:"KYC Expired",    v:kycExpired,     color:"#fbbf24", icon:"📋" },
            { label:"PIN Locked",     v:pinLocked,      color:"#f87171", icon:"🔐" },
            { label:"SIM Issues",     v:simIssue,       color:"#fb923c", icon:"📱" },
            { label:"Settle Hold",    v:settlementHold, color:"#fbbf24", icon:"💰" },
            { label:"Zero Balance",   v:zeroBalance,    color:"#60a5fa", icon:"🪙" },
            { label:"Events /60m",    v:recentEvents,   color:"#a78bfa", icon:"⚡" },
          ].map(s => (
            <div key={s.label} style={{ display:"flex", gap:6, alignItems:"center",
              background:s.v>0?`${s.color}09`:"transparent",
              border:`1px solid ${s.v>0?`${s.color}25`:"#0e1922"}`,
              borderRadius:6, padding:"6px 8px" }}>
              <span style={{ fontSize:13 }}>{s.icon}</span>
              <div>
                <div style={{ fontSize:12, fontWeight:800, color:s.v>0?s.color:"#9C9C9C" }}>{s.v}</div>
                <div style={{ fontSize:7, color:"#9C9C9C" }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Two columns: demand + merchant profile */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        {/* Top demand rules */}
        <div style={{ background:"#060d14", border:"1px solid #0e1922", borderRadius:8, padding:12 }}>
          <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.2, textTransform:"uppercase", marginBottom:8 }}>
            TOP DEMAND DRIVERS
          </div>
          {sortedRules.slice(0,6).map((r,i) => {
            const pct = totalDemand > 0 ? (r.demand_total / totalDemand) * 100 : 0;
            const barColor = i===0?"#f87171":i===1?"#fb923c":i===2?"#fbbf24":"#60a5fa";
            return (
              <div key={r.action_key} style={{ marginBottom:7 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                  <span style={{ fontSize:8, color:"#c8d8e8", fontFamily:"monospace" }}>{r.action_key}</span>
                  <span style={{ fontSize:8, color:barColor, fontWeight:700 }}>{fmtK(r.demand_total)}</span>
                </div>
                <div style={{ height:3, background:"#0a1520", borderRadius:1, overflow:"hidden" }}>
                  <div style={{ width:`${pct}%`, height:"100%", background:barColor,
                    boxShadow:`0 0 6px ${barColor}60`, transition:"width .5s ease" }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Merchant behaviour profile */}
        <div style={{ background:"#060d14", border:"1px solid #0e1922", borderRadius:8, padding:12 }}>
          <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1.2, textTransform:"uppercase", marginBottom:8 }}>
            MERCHANT PROFILE MIX
          </div>

          <div style={{ marginBottom:10 }}>
            <div style={{ fontSize:8, color:"#9C9C9C", marginBottom:5 }}>NETWORK TYPE</div>
            <div style={{ display:"flex", gap:3, height:6, borderRadius:3, overflow:"hidden" }}>
              {networkBreakdown.map(n => (
                <div key={n.label} title={`${n.label}: ${n.count}`}
                  style={{ flex:n.count||0.1, background:n.color, transition:"flex .5s" }} />
              ))}
            </div>
            <div style={{ display:"flex", gap:8, marginTop:4 }}>
              {networkBreakdown.map(n => (
                <span key={n.label} style={{ fontSize:7, color:n.color }}>{n.label} {n.count}</span>
              ))}
            </div>
          </div>

          <div style={{ marginBottom:10 }}>
            <div style={{ fontSize:8, color:"#9C9C9C", marginBottom:5 }}>PREFERRED CHANNEL</div>
            <div style={{ display:"flex", gap:5 }}>
              {channelPref.map(c => (
                <div key={c.label} style={{ flex:1, background:"#0a1520", borderRadius:5,
                  padding:"6px", textAlign:"center" }}>
                  <div style={{ fontSize:14, marginBottom:2 }}>{c.icon}</div>
                  <div style={{ fontSize:9, fontWeight:700, color:"#c8d8e8" }}>{c.count}</div>
                  <div style={{ fontSize:7, color:"#9C9C9C" }}>{c.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize:8, color:"#9C9C9C", marginBottom:5 }}>TRANSACTION TIER</div>
            <div style={{ display:"flex", gap:3 }}>
              {[
                { k:"high",   label:"High",   color:"#4ade80" },
                { k:"medium", label:"Medium", color:"#fbbf24" },
                { k:"low",    label:"Low",    color:"#f87171" },
              ].map(t => (
                <div key={t.k} style={{ flex:tierCounts[t.k]||0.1, background:`${t.color}12`,
                  border:`1px solid ${t.color}25`, borderRadius:5, padding:"5px 6px", textAlign:"center" }}>
                  <div style={{ fontSize:10, fontWeight:800, color:t.color }}>{tierCounts[t.k]}</div>
                  <div style={{ fontSize:7, color:"#9C9C9C" }}>{t.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL 2 — PRE-FAILURE ALERT FEED
// ═══════════════════════════════════════════════════════════════════════════════
function AlertFeed({ alerts, onResolve, resolving }) {
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

  const sevOrder = ["critical","high","medium","low"];
  const filtered = filter === "all" ? alerts : alerts.filter(a => a.severity === filter);
  const counts = Object.fromEntries(sevOrder.map(s => [s, alerts.filter(a=>a.severity===s&&!a.resolved).length]));

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:0, height:"100%" }}>
      <SectionHeader icon="🚨" title="PRE-FAILURE ALERT FEED"
        sub="Predicted failures before merchant calls" live count={`${filtered.length} open`} color="#f87171" />

      {/* Severity pills */}
      <div style={{ display:"flex", gap:4, marginBottom:10, flexWrap:"wrap" }}>
        {["all",...sevOrder].map(s => {
          const c = SEV[s] || { border:"#9C9C9C", text:"#9C9C9C", bg:"transparent" };
          const cnt = s==="all" ? alerts.filter(a=>!a.resolved).length : counts[s];
          return (
            <button key={s} onClick={() => setFilter(s)}
              style={{ background:filter===s ? (c.bg||"rgba(255,255,255,.05)") : "transparent",
                border:`1px solid ${filter===s ? (c.border||"#9C9C9C") : "#9C9C9C"}`,
                color:filter===s ? (c.text||"#c8d8e8") : "#9C9C9C",
                borderRadius:5, padding:"3px 9px", cursor:"pointer", fontFamily:"inherit",
                fontSize:8, fontWeight:700, transition:"all .12s", display:"flex", gap:4 }}>
              {s.toUpperCase()} {cnt > 0 && <span style={{ opacity:.7 }}>({cnt})</span>}
            </button>
          );
        })}
      </div>

      {/* Alert list */}
      <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:5 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign:"center", padding:40, color:"#9C9C9C" }}>
            <div style={{ fontSize:24, marginBottom:8 }}>✓</div>
            <div style={{ fontSize:10 }}>No open alerts{filter!=="all"?` at ${filter} severity`:""}</div>
          </div>
        ) : filtered.map(alert => {
          const s = SEV[alert.severity] || SEV.low;
          const isExpanded = expandedId === alert.id;
          return (
            <div key={alert.id}
              style={{ background:s.bg, border:`1px solid ${s.border}`,
                borderLeft:`3px solid ${s.dot}`, borderRadius:"0 7px 7px 0",
                padding:"8px 10px", cursor:"pointer", transition:"all .12s",
                animation:"slideIn .2s ease" }}
              onClick={() => setExpandedId(isExpanded ? null : alert.id)}>
              <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                <PulseDot color={s.dot} size={6} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", marginBottom:3 }}>
                    <span style={{ fontSize:8, fontFamily:"monospace", fontWeight:800, color:"#e2cfa0" }}>
                      {alert.action_key}
                    </span>
                    <span style={{ fontSize:7, color:s.text, background:`${s.dot}18`,
                      border:`1px solid ${s.dot}35`, borderRadius:100, padding:"1px 6px", fontWeight:800 }}>
                      {(alert.severity||"").toUpperCase()}
                    </span>
                    <span style={{ fontSize:7, color:"#9C9C9C", fontFamily:"monospace" }}>
                      {alert.error_code}
                    </span>
                  </div>
                  <div style={{ fontSize:10, fontWeight:700, color:"#c8d8e8", marginBottom:2 }}>
                    {alert.merchant_name}
                  </div>
                  <div style={{ fontSize:8, color:"#8ca4bc", lineHeight:1.5 }}>{alert.inline_message}</div>
                  {isExpanded && (
                    <div style={{ marginTop:7, animation:"fadeUp .15s ease" }}>
                      {alert.fix_message && (
                        <div style={{ background:"rgba(226,207,160,.06)", borderRadius:5,
                          padding:"6px 8px", marginBottom:5 }}>
                          <div style={{ fontSize:7, color:"#e2cfa0", marginBottom:2 }}>💡 FIX</div>
                          <div style={{ fontSize:9, color:"#c8d8e8" }}>{alert.fix_message}</div>
                        </div>
                      )}
                      {alert.escalation_msg && (
                        <div style={{ background:"rgba(96,165,250,.05)", borderRadius:5, padding:"6px 8px" }}>
                          <div style={{ fontSize:7, color:"#60a5fa", marginBottom:2 }}>📞 ESCALATION</div>
                          <div style={{ fontSize:9, color:"#8ca4bc" }}>{alert.escalation_msg}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end", flexShrink:0 }}>
                  <span style={{ fontSize:7, color:"#9C9C9C" }}>{elapsed(alert.created_at)}</span>
                  <button onClick={e => { e.stopPropagation(); onResolve(alert.id); }}
                    disabled={resolving === alert.id}
                    style={{ background:"rgba(74,222,128,.07)", border:"1px solid rgba(74,222,128,.2)",
                      color:"#4ade80", borderRadius:4, padding:"3px 7px", cursor:"pointer",
                      fontFamily:"inherit", fontSize:7, fontWeight:700,
                      opacity: resolving===alert.id ? .5 : 1 }}>
                    {resolving===alert.id ? "…" : "✓ Resolve"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL 3 — REAL-TIME ACTIVITY LOG
// ═══════════════════════════════════════════════════════════════════════════════
function ActivityLog({ events, loading }) {
  const [filter, setFilter] = useState("all");
  const [pauseScroll, setPauseScroll] = useState(false);
  const logRef = useRef();
  const newIds = useRef(new Set());

  useEffect(() => {
    if (!pauseScroll && logRef.current) {
      logRef.current.scrollTop = 0;
    }
  }, [events, pauseScroll]);

  const filtered = filter === "all" ? events
    : filter === "fail" ? events.filter(e => e.success === 0)
    : filter === "warn" ? events.filter(e => e.success === 2)
    : events.filter(e => e.channel === filter);

  const channelIcon = { app:"📱", ussd:"📟", web:"🌐", twin:"⬡", batch_scan:"⚡" };
  const sevColor = { critical:"#f87171", high:"#fb923c", medium:"#fbbf24", low:"#60a5fa", info:"#4ade80" };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <SectionHeader icon="📋" title="REAL-TIME ACTIVITY LOG"
        sub="All twin evaluation events" live count={`${events.length} events`} color="#60a5fa" />

      {/* Filter bar */}
      <div style={{ display:"flex", gap:3, marginBottom:8, flexWrap:"wrap" }}>
        {[
          ["all","All","#9C9C9C"],
          ["fail","Failures","#f87171"],
          ["app","App","#4ade80"],
          ["ussd","USSD","#fbbf24"],
          ["web","Web","#60a5fa"],
          ["twin","Twin","#a78bfa"],
        ].map(([v,l,c]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{ background:filter===v?`${c}15`:"transparent",
              border:`1px solid ${filter===v?`${c}50`:"#9C9C9C"}`,
              color:filter===v?c:"#9C9C9C", borderRadius:5,
              padding:"3px 8px", cursor:"pointer", fontFamily:"inherit",
              fontSize:8, fontWeight:700, transition:"all .12s" }}>
            {l}
          </button>
        ))}
        <button onClick={() => setPauseScroll(p=>!p)}
          style={{ marginLeft:"auto", background:pauseScroll?"rgba(251,191,36,.1)":"transparent",
            border:`1px solid ${pauseScroll?"rgba(251,191,36,.3)":"#9C9C9C"}`,
            color:pauseScroll?"#fbbf24":"#9C9C9C",
            borderRadius:5, padding:"3px 8px", cursor:"pointer", fontFamily:"inherit", fontSize:8 }}>
          {pauseScroll ? "⏸ Paused" : "▶ Live"}
        </button>
      </div>

      {/* Log entries */}
      <div ref={logRef} style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:2 }}>
        {loading && filtered.length === 0 ? (
          <div style={{ textAlign:"center", color:"#9C9C9C", padding:30, fontSize:10 }}>Loading events…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:"center", color:"#9C9C9C", padding:30 }}>
            <div style={{ fontSize:20, marginBottom:6 }}>◌</div>
            <div style={{ fontSize:9 }}>No events yet — run the simulator to generate activity</div>
          </div>
        ) : filtered.map((e, i) => {
          const isNew = i < 3;
          const sc = e.success === 1 ? "#4ade80" : e.success === 0 ? (sevColor[e.severity]||"#f87171") : "#fbbf24";
          return (
            <div key={e.id || i} style={{
              display:"grid", gridTemplateColumns:"22px 55px 30px 1fr 70px 60px",
              gap:4, padding:"5px 6px", alignItems:"center",
              background: isNew ? "rgba(255,255,255,.025)" : "transparent",
              borderRadius:4, borderLeft:`2px solid ${isNew?sc:"transparent"}`,
              animation: isNew ? "slideIn .2s ease" : "none",
              transition:"background .3s",
            }}>
              <span style={{ fontSize:11, textAlign:"center" }}>{channelIcon[e.channel]||"◈"}</span>
              <span style={{ fontSize:7, color:"#9C9C9C", fontFamily:"monospace" }}>
                {fmtTime(e.created_at)}
              </span>
              <span style={{ fontSize:8, textAlign:"center" }}>
                {e.success===1?"✓":e.success===0?"✗":"⚠"}
              </span>
              <div style={{ overflow:"hidden" }}>
                <span style={{ fontSize:8, fontFamily:"monospace", color:"#e2cfa0",
                  display:"block", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                  {e.action_key}
                </span>
                <span style={{ fontSize:7, color:"#9C9C9C", display:"block",
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                  {e.merchant_name}
                </span>
              </div>
              <span style={{ fontSize:7, color:sc, fontFamily:"monospace", textAlign:"right" }}>
                {e.error_code || (e.success===1?"OK":"—")}
              </span>
              <span style={{ fontSize:7, color:"#9C9C9C", textAlign:"right" }}>
                {e.response_time_ms ? `${e.response_time_ms}ms` : ""}
              </span>
            </div>
          );
        })}
      </div>

      {/* Mini stats footer */}
      <div style={{ borderTop:"1px solid #0e1922", paddingTop:8, marginTop:6,
        display:"flex", gap:12, fontSize:8, color:"#9C9C9C" }}>
        {[
          { l:"Passed",  v:events.filter(e=>e.success===1).length, c:"#4ade80" },
          { l:"Failed",  v:events.filter(e=>e.success===0).length, c:"#f87171" },
          { l:"Escalated",v:events.filter(e=>e.escalated===1).length, c:"#fb923c" },
        ].map(s => (
          <span key={s.l}>{s.l}: <span style={{ color:s.c, fontWeight:700 }}>{s.v}</span></span>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL 4 — DEMAND × FAILURE RATE HEATMAP
// ═══════════════════════════════════════════════════════════════════════════════
function DemandHeatmap({ rules, events, merchants }) {
  const [view, setView] = useState("rules"); // rules | channel | behaviour | literacy

  // Per-rule failure stats from events
  const ruleStats = {};
  rules.forEach(r => {
    const ruleEvents = events.filter(e => e.action_key === r.action_key);
    const failed = ruleEvents.filter(e => e.success === 0).length;
    ruleStats[r.action_key] = {
      total: ruleEvents.length,
      failed,
      failRate: ruleEvents.length > 0 ? failed / ruleEvents.length : 0,
      demand: r.demand_total || 0,
    };
  });

  // Channel failure rates
  const channelStats = ["app","ussd","web","twin"].map(ch => {
    const chEvents = events.filter(e => e.channel === ch);
    const failed = chEvents.filter(e => e.success === 0).length;
    return { label: ch.toUpperCase(), icon: {app:"📱",ussd:"📟",web:"🌐",twin:"⬡"}[ch],
      total: chEvents.length, failed,
      failRate: chEvents.length > 0 ? failed/chEvents.length : 0 };
  });

  // Behaviour correlation: which merchant types cause most failures
  const behaviourMap = {};
  events.filter(e => e.success === 0).forEach(evt => {
    const merchant = merchants.find(m => m.id === evt.merchant_id);
    if (!merchant) return;
    const key = merchant.literacy_tier || "unknown";
    if (!behaviourMap[key]) behaviourMap[key] = { count:0, merchants:new Set() };
    behaviourMap[key].count++;
    behaviourMap[key].merchants.add(merchant.id);
  });

  // Network type × failure correlation
  const networkFailMap = {};
  events.filter(e => e.success === 0).forEach(evt => {
    const merchant = merchants.find(m => m.id === evt.merchant_id);
    if (!merchant) return;
    const key = merchant.network_type || "unknown";
    if (!networkFailMap[key]) networkFailMap[key] = 0;
    networkFailMap[key]++;
  });

  // Scatter: demand vs fail rate
  const sortedRules = [...rules].sort((a,b) => (b.demand_total||0) - (a.demand_total||0));
  const maxDemand = Math.max(...rules.map(r=>r.demand_total||0), 1);

  const cellColor = (failRate) => {
    if (failRate >= 0.5) return "#f87171";
    if (failRate >= 0.3) return "#fb923c";
    if (failRate >= 0.15) return "#fbbf24";
    if (failRate > 0) return "#60a5fa";
    return "#9C9C9C";
  };

  const heatIntensity = (demand, failRate) => {
    const d = demand / maxDemand;
    const f = failRate;
    const score = d * 0.4 + f * 0.6;
    return score;
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <SectionHeader icon="📊" title="DEMAND × FAILURE HEATMAP"
        sub="Which issues drive the most call-centre load" count={`${rules.length} rules`} color="#fbbf24" />

      {/* View toggle */}
      <div style={{ display:"flex", gap:4, marginBottom:12 }}>
        {[["rules","Rules"],["channel","Channel"],["behaviour","Behaviour"],["network","Network"]].map(([v,l]) => (
          <button key={v} onClick={()=>setView(v)}
            style={{ background:view===v?"rgba(251,191,36,.1)":"transparent",
              border:`1px solid ${view===v?"rgba(251,191,36,.35)":"#9C9C9C"}`,
              color:view===v?"#fbbf24":"#9C9C9C",
              borderRadius:5, padding:"4px 10px", cursor:"pointer",
              fontFamily:"inherit", fontSize:9, fontWeight:700, transition:"all .12s" }}>
            {l}
          </button>
        ))}
      </div>

      {/* RULES VIEW */}
      {view === "rules" && (
        <div style={{ flex:1, overflowY:"auto" }}>
          {/* Column headers */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 70px 70px 80px 90px",
            gap:4, padding:"3px 6px", marginBottom:4 }}>
            {["Rule","Demand","Events","Fail Rate","Heat"].map(h => (
              <div key={h} style={{ fontSize:7, color:"#9C9C9C", letterSpacing:1,
                textTransform:"uppercase", textAlign:h==="Rule"?"left":"right" }}>{h}</div>
            ))}
          </div>

          {sortedRules.map((r,i) => {
            const stat = ruleStats[r.action_key] || {};
            const fr = stat.failRate || 0;
            const intensity = heatIntensity(r.demand_total||0, fr);
            const heatColor = cellColor(fr);
            const demandPct = ((r.demand_total||0) / maxDemand) * 100;

            return (
              <div key={r.action_key} style={{
                display:"grid", gridTemplateColumns:"1fr 70px 70px 80px 90px",
                gap:4, padding:"6px 6px", marginBottom:3,
                background: intensity > 0.4 ? `${heatColor}08` : "transparent",
                border:`1px solid ${intensity > 0.4 ? `${heatColor}20` : "transparent"}`,
                borderRadius:6, transition:"all .2s",
              }}>
                <div>
                  <div style={{ fontSize:9, fontFamily:"monospace", color:"#e2cfa0", fontWeight:700 }}>{r.action_key}</div>
                  <div style={{ fontSize:8, color:"#9C9C9C" }}>{r.label}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:9, fontWeight:700, color:"#c8d8e8" }}>{fmtK(r.demand_total)}</div>
                  <div style={{ height:2, background:"#0a1520", marginTop:3, borderRadius:1, overflow:"hidden" }}>
                    <div style={{ width:`${demandPct}%`, height:"100%", background:"#c8d8e8" }} />
                  </div>
                </div>
                <div style={{ textAlign:"right", fontSize:9, color:"#9C9C9C" }}>
                  {stat.total || 0}
                </div>
                <div style={{ textAlign:"right" }}>
                  <span style={{ fontSize:9, fontWeight:700,
                    color:fr>0?heatColor:"#9C9C9C" }}>
                    {fr > 0 ? `${Math.round(fr*100)}%` : "—"}
                  </span>
                </div>
                {/* Heat cell */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end" }}>
                  <div style={{ width:Math.max(4, intensity * 80), height:12, borderRadius:2,
                    background:intensity>0?`linear-gradient(90deg, ${heatColor}40, ${heatColor})`:"#0a1520",
                    boxShadow:intensity>0.5?`0 0 8px ${heatColor}60`:"none",
                    transition:"all .4s ease", minWidth:4 }} />
                </div>
              </div>
            );
          })}

          {/* Legend */}
          <div style={{ display:"flex", gap:10, marginTop:8, padding:"6px 0",
            borderTop:"1px solid #0e1922", fontSize:8, color:"#9C9C9C" }}>
            {[["≥50%","#f87171"],["30-50%","#fb923c"],["15-30%","#fbbf24"],["1-15%","#60a5fa"],["0%","#9C9C9C"]].map(([l,c])=>(
              <span key={l} style={{ display:"flex", gap:4, alignItems:"center" }}>
                <span style={{ width:8, height:8, background:c, borderRadius:1, display:"inline-block" }}/>
                {l}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* CHANNEL VIEW */}
      {view === "channel" && (
        <div style={{ flex:1 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:14 }}>
            {channelStats.map(ch => (
              <div key={ch.label} style={{
                background:`${cellColor(ch.failRate)}09`,
                border:`1px solid ${cellColor(ch.failRate)}30`,
                borderRadius:9, padding:"12px 10px", textAlign:"center" }}>
                <div style={{ fontSize:22, marginBottom:6 }}>{ch.icon}</div>
                <div style={{ fontSize:10, fontWeight:800, color:"#c8d8e8" }}>{ch.label}</div>
                <div style={{ fontSize:18, fontWeight:800, color:cellColor(ch.failRate), margin:"6px 0" }}>
                  {ch.total > 0 ? `${Math.round(ch.failRate*100)}%` : "—"}
                </div>
                <div style={{ fontSize:8, color:"#9C9C9C" }}>{ch.failed}/{ch.total} failed</div>
              </div>
            ))}
          </div>

          {/* Per-rule per-channel grid */}
          <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>
            Failure breakdown by channel
          </div>
          <div style={{ overflowX:"auto" }}>
            <div style={{ display:"grid", gridTemplateColumns:`130px repeat(4, 60px)`, gap:2 }}>
              {/* Header */}
              <div />
              {["App","USSD","Web","Twin"].map(c=>(
                <div key={c} style={{ fontSize:7, color:"#9C9C9C", textAlign:"center", padding:"2px 0" }}>{c}</div>
              ))}
              {sortedRules.slice(0,8).map(r => (
                <>
                  <div key={r.action_key} style={{ fontSize:8, color:"#e2cfa0", fontFamily:"monospace",
                    padding:"4px 0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {r.action_key}
                  </div>
                  {["app","ussd","web","twin"].map(ch => {
                    const chRuleEvents = events.filter(e=>e.action_key===r.action_key&&e.channel===ch);
                    const chFailed = chRuleEvents.filter(e=>e.success===0).length;
                    const chFR = chRuleEvents.length>0 ? chFailed/chRuleEvents.length : -1;
                    return (
                      <div key={ch} title={`${r.action_key} × ${ch}: ${chRuleEvents.length} events, ${chFailed} failed`}
                        style={{ background:chFR>=0?cellColor(chFR)+"25":"#0a1520",
                          border:`1px solid ${chFR>=0?cellColor(chFR)+"40":"#060d14"}`,
                          borderRadius:3, height:24, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <span style={{ fontSize:8, color:chFR>=0?cellColor(chFR):"#9C9C9C", fontWeight:700 }}>
                          {chFR>=0 ? `${Math.round(chFR*100)}%` : "·"}
                        </span>
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* BEHAVIOUR VIEW */}
      {view === "behaviour" && (
        <div style={{ flex:1, overflowY:"auto" }}>
          <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1, marginBottom:10 }}>
            Which merchant profiles generate the most failures
          </div>

          {/* Literacy tier failures */}
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:9, color:"#c8d8e8", fontWeight:700, marginBottom:8 }}>BY LITERACY TIER</div>
            {["literate","semi-literate","illiterate"].map(tier => {
              const tierMerchants = merchants.filter(m=>m.literacy_tier===tier);
              const tierEvents = events.filter(e=>e.success===0&&tierMerchants.some(m=>m.id===e.merchant_id));
              const pct = tierMerchants.length>0 ? tierEvents.length/tierMerchants.length : 0;
              const color = tier==="illiterate"?"#f87171":tier==="semi-literate"?"#fbbf24":"#4ade80";
              return (
                <div key={tier} style={{ marginBottom:7 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                    <span style={{ fontSize:9, color:"#c8d8e8", textTransform:"capitalize" }}>{tier}</span>
                    <span style={{ fontSize:9, color, fontWeight:700 }}>
                      {tierEvents.length} failures · {tierMerchants.length} merchants
                    </span>
                  </div>
                  <div style={{ height:5, background:"#0a1520", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ width:`${Math.min(pct*50,100)}%`, height:"100%", background:color,
                      boxShadow:`0 0 6px ${color}60` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Transaction tier failures */}
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:9, color:"#c8d8e8", fontWeight:700, marginBottom:8 }}>BY TRANSACTION TIER</div>
            {["high","medium","low"].map(tier => {
              const tierMerchants = merchants.filter(m=>m.transaction_tier===tier);
              const tierFails = events.filter(e=>e.success===0&&tierMerchants.some(m=>m.id===e.merchant_id)).length;
              const color = tier==="low"?"#f87171":tier==="medium"?"#fbbf24":"#4ade80";
              return (
                <div key={tier} style={{ marginBottom:7 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                    <span style={{ fontSize:9, color:"#c8d8e8", textTransform:"capitalize" }}>{tier} volume</span>
                    <span style={{ fontSize:9, color, fontWeight:700 }}>{tierFails} failures</span>
                  </div>
                  <div style={{ height:5, background:"#0a1520", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ width:`${Math.min((tierFails/(events.filter(e=>e.success===0).length||1))*100, 100)}%`,
                      height:"100%", background:color }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Customer type */}
          <div>
            <div style={{ fontSize:9, color:"#c8d8e8", fontWeight:700, marginBottom:8 }}>BY CUSTOMER TYPE</div>
            <div style={{ display:"flex", gap:6 }}>
              {["existing","new","dormant"].map(type => {
                const typeMerchants = merchants.filter(m=>m.customer_type===type);
                const typeFails = events.filter(e=>e.success===0&&typeMerchants.some(m=>m.id===e.merchant_id)).length;
                const color = type==="dormant"?"#f87171":type==="new"?"#fbbf24":"#4ade80";
                return (
                  <div key={type} style={{ flex:1, background:`${color}08`,
                    border:`1px solid ${color}20`, borderRadius:7, padding:"10px 8px", textAlign:"center" }}>
                    <div style={{ fontSize:14, fontWeight:800, color, marginBottom:3 }}>{typeFails}</div>
                    <div style={{ fontSize:8, color:"#c8d8e8", textTransform:"capitalize" }}>{type}</div>
                    <div style={{ fontSize:7, color:"#9C9C9C" }}>{typeMerchants.length} merchants</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* NETWORK VIEW */}
      {view === "network" && (
        <div style={{ flex:1, overflowY:"auto" }}>
          <div style={{ fontSize:8, color:"#9C9C9C", marginBottom:12 }}>
            How network quality correlates with failure rates
          </div>
          {["5G","4G","3G","2G","EDGE"].map(net => {
            const netMerchants = merchants.filter(m=>(m.network_type||"4G")===net);
            const netEvents = events.filter(e=>netMerchants.some(m=>m.id===e.merchant_id));
            const netFails = netEvents.filter(e=>e.success===0).length;
            const fr = netEvents.length>0 ? netFails/netEvents.length : 0;
            const color = net==="5G"?"#4ade80":net==="4G"?"#60a5fa":net==="3G"?"#fbbf24":net==="2G"?"#fb923c":"#f87171";
            if (netMerchants.length === 0 && netEvents.length === 0) return null;
            return (
              <div key={net} style={{ display:"grid", gridTemplateColumns:"50px 1fr 60px 50px",
                gap:10, alignItems:"center", marginBottom:8,
                padding:"8px 10px", background:`${color}06`,
                border:`1px solid ${color}20`, borderRadius:7 }}>
                <div style={{ fontSize:11, fontWeight:800, color }}>{net}</div>
                <div>
                  <div style={{ height:5, background:"#0a1520", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ width:`${fr*100}%`, height:"100%", background:color,
                      boxShadow:`0 0 6px ${color}60` }} />
                  </div>
                  <div style={{ fontSize:7, color:"#9C9C9C", marginTop:2 }}>
                    {netMerchants.length} merchants · {netEvents.length} events
                  </div>
                </div>
                <div style={{ fontSize:10, fontWeight:800, color, textAlign:"right" }}>
                  {fr>0?`${Math.round(fr*100)}%`:"—"}
                </div>
                <div style={{ fontSize:8, color:"#9C9C9C", textAlign:"right" }}>
                  {netFails} fail
                </div>
              </div>
            );
          })}

          {/* Insight box */}
          <div style={{ marginTop:12, background:"rgba(251,191,36,.05)", border:"1px solid rgba(251,191,36,.15)",
            borderRadius:7, padding:10 }}>
            <div style={{ fontSize:8, color:"#fbbf24", marginBottom:4 }}>📡 KEY INSIGHT</div>
            <div style={{ fontSize:9, color:"#8ca4bc", lineHeight:1.6 }}>
              2G/EDGE merchants generate disproportionate call-centre load due to USSD session timeouts
              and app crashes. Proactive USSD stability messaging + offline-capable USSD flows
              reduce demand from this segment by an estimated 35%.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL 5 — MERCHANT DEEP-DIVE
// ═══════════════════════════════════════════════════════════════════════════════
function MerchantDeepDive({ merchants, events, alerts, rules }) {
  const [selectedId, setSelectedId] = useState(null);
  const [merchantEvents, setMerchantEvents] = useState([]);
  const [merchantAlerts, setMerchantAlerts] = useState([]);
  const [loading, setLoading] = useState(false);

  const merchant = merchants.find(m => m.id === selectedId);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    Promise.all([
      api.get("/events", { merchant_id:selectedId, limit:50 }).catch(()=>[]),
      api.get("/alerts", { merchant_id:selectedId }).catch(()=>[]),
    ]).then(([ev, al]) => {
      setMerchantEvents(Array.isArray(ev) ? ev : []);
      setMerchantAlerts(Array.isArray(al) ? al : []);
      setLoading(false);
    });
  }, [selectedId]);

  // Rank merchants by risk
  const rankedMerchants = [...merchants].map(m => {
    const mAlerts = alerts.filter(a => a.merchant_id === m.id && !a.resolved);
    const mFails = events.filter(e => e.merchant_id === m.id && e.success === 0).length;
    const criticals = mAlerts.filter(a => a.severity === "critical").length;
    const score = criticals * 10 + mAlerts.length * 3 + mFails;
    return { ...m, riskScore: score, openAlerts: mAlerts.length, recentFails: mFails };
  }).sort((a,b) => b.riskScore - a.riskScore);

  const sensorRows = merchant ? [
    { k:"Account Status",   v:merchant.account_status,   bad:v=>v!=="active" },
    { k:"KYC Status",       v:merchant.kyc_status,       bad:v=>v!=="verified", warn:v=>v==="pending" },
    { k:"KYC Age",          v:`${merchant.kyc_age_days||0}d`, bad:v=>parseInt(v)>=365, warn:v=>parseInt(v)>=300 },
    { k:"SIM Status",       v:merchant.sim_status,       bad:v=>v==="unregistered", warn:v=>v==="swapped" },
    { k:"PIN Attempts",     v:`${merchant.pin_attempts||0}/3`, bad:()=>merchant.pin_locked==1, warn:()=>(merchant.pin_attempts||0)>=2 },
    { k:"PIN Locked",       v:merchant.pin_locked==1?"YES":"NO", bad:v=>v==="YES" },
    { k:"Start Key",        v:merchant.start_key_status, bad:v=>v!=="valid" },
    { k:"Balance",          v:`KES ${parseFloat(merchant.balance||0).toLocaleString()}`, bad:()=>parseFloat(merchant.balance||0)===0, warn:()=>parseFloat(merchant.balance||0)<500 },
    { k:"Dormant Days",     v:`${merchant.dormant_days||0}d`, bad:v=>parseInt(v)>=60, warn:v=>parseInt(v)>=30 },
    { k:"Operator Dormant", v:`${merchant.operator_dormant_days||0}d`, bad:v=>parseInt(v)>=90, warn:v=>parseInt(v)>=30 },
    { k:"Notifications",    v:merchant.notifications_enabled?"ON":"OFF", bad:v=>v==="OFF" },
    { k:"Settlement Hold",  v:merchant.settlement_on_hold==1?"HOLD":"CLEAR", bad:v=>v==="HOLD" },
  ] : [];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%" }}>
      <SectionHeader icon="🔬" title="MERCHANT DEEP-DIVE"
        sub="Risk-ranked merchant inspection" count={`${merchants.length} merchants`} color="#a78bfa" />

      <div style={{ display:"grid", gridTemplateColumns:"180px 1fr", gap:10, flex:1, overflow:"hidden" }}>
        {/* Merchant list — ranked by risk */}
        <div style={{ overflowY:"auto", display:"flex", flexDirection:"column", gap:3 }}>
          <div style={{ fontSize:7, color:"#9C9C9C", letterSpacing:1, textTransform:"uppercase",
            marginBottom:4, padding:"0 4px" }}>RANKED BY RISK</div>
          {rankedMerchants.map((m,i) => (
            <button key={m.id} onClick={() => setSelectedId(m.id)}
              style={{ background: selectedId===m.id ? "rgba(167,139,250,.08)" : "transparent",
                border:`1px solid ${selectedId===m.id?"rgba(167,139,250,.3)":m.riskScore>10?"rgba(248,113,113,.15)":"transparent"}`,
                borderRadius:7, padding:"7px 8px", cursor:"pointer", textAlign:"left",
                transition:"all .12s" }}>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <span style={{ fontSize:16 }}>{m.avatar||"🏪"}</span>
                <div style={{ flex:1, overflow:"hidden" }}>
                  <div style={{ fontSize:8, fontWeight:700, color:"#c8d8e8",
                    whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                    {m.business_name}
                  </div>
                  <div style={{ display:"flex", gap:4, marginTop:2 }}>
                    {m.openAlerts > 0 && (
                      <span style={{ fontSize:7, color:"#f87171" }}>⚠ {m.openAlerts}</span>
                    )}
                    {m.recentFails > 0 && (
                      <span style={{ fontSize:7, color:"#fb923c" }}>✗ {m.recentFails}</span>
                    )}
                    {m.riskScore === 0 && (
                      <span style={{ fontSize:7, color:"#4ade80" }}>✓ clean</span>
                    )}
                  </div>
                </div>
                {m.riskScore > 0 && (
                  <div style={{ width:3, height:26, borderRadius:1,
                    background:`linear-gradient(180deg, #f87171, #fb923c)`,
                    opacity: Math.min(m.riskScore/20, 1), flexShrink:0 }} />
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Detail pane */}
        <div style={{ overflowY:"auto", paddingLeft:8, borderLeft:"1px solid #0e1922" }}>
          {!merchant ? (
            <div style={{ textAlign:"center", color:"#9C9C9C", marginTop:50 }}>
              <div style={{ fontSize:24, marginBottom:8 }}>◉</div>
              <div style={{ fontSize:9 }}>Select a merchant to inspect</div>
            </div>
          ) : (
            <div style={{ animation:"fadeUp .2s ease" }}>
              {/* Merchant header */}
              <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:12,
                background:"rgba(255,255,255,.02)", border:"1px solid #0e1922",
                borderRadius:9, padding:"10px 12px" }}>
                <span style={{ fontSize:28 }}>{merchant.avatar||"🏪"}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:"#c8d8e8" }}>{merchant.business_name}</div>
                  <div style={{ fontSize:8, color:"#9C9C9C", marginTop:2 }}>
                    {merchant.phone_number} · PB {merchant.paybill} · {merchant.county} · {merchant.network_type||"4G"}
                  </div>
                  <div style={{ display:"flex", gap:5, marginTop:5, flexWrap:"wrap" }}>
                    {[
                      { v:merchant.account_status, bad:merchant.account_status!=="active" },
                      { v:merchant.kyc_status, bad:merchant.kyc_status!=="verified" },
                      { v:merchant.literacy_tier, bad:false },
                      { v:merchant.preferred_channel?.toUpperCase(), bad:false },
                    ].map((tag,ti) => (
                      <span key={ti} style={{ fontSize:7, padding:"2px 7px", borderRadius:100,
                        fontWeight:700, textTransform:"uppercase",
                        background: tag.bad ? "rgba(248,113,113,.12)" : "rgba(74,222,128,.07)",
                        border:`1px solid ${tag.bad?"rgba(248,113,113,.3)":"rgba(74,222,128,.2)"}`,
                        color: tag.bad ? "#f87171" : "#4ade80" }}>
                        {tag.v}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:14, fontWeight:800, color:"white" }}>
                    KES {parseFloat(merchant.balance||0).toLocaleString()}
                  </div>
                  <div style={{ fontSize:8, color:"#9C9C9C", marginTop:2 }}>float balance</div>
                  {merchantAlerts.filter(a=>!a.resolved).length > 0 && (
                    <div style={{ fontSize:8, color:"#f87171", marginTop:4, fontWeight:700 }}>
                      ⚠ {merchantAlerts.filter(a=>!a.resolved).length} open alerts
                    </div>
                  )}
                </div>
              </div>

              {/* Sensor grid */}
              <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1, textTransform:"uppercase",
                marginBottom:7 }}>SENSOR STATUS</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:4, marginBottom:12 }}>
                {sensorRows.map(s => {
                  const isBad  = s.bad?.(s.v);
                  const isWarn = !isBad && s.warn?.(s.v);
                  const color  = isBad ? "#f87171" : isWarn ? "#fbbf24" : "#4ade80";
                  return (
                    <div key={s.k} style={{ background:"#060d14",
                      border:`1px solid ${isBad?"rgba(248,113,113,.2)":isWarn?"rgba(251,191,36,.15)":"#0e1922"}`,
                      borderRadius:5, padding:"6px 8px" }}>
                      <div style={{ fontSize:7, color:"#9C9C9C", marginBottom:2 }}>{s.k}</div>
                      <div style={{ fontSize:9, fontWeight:700, color, textTransform:"uppercase" }}>{s.v}</div>
                    </div>
                  );
                })}
              </div>

              {/* Recent events for this merchant */}
              {loading ? (
                <div style={{ color:"#9C9C9C", fontSize:9, textAlign:"center", padding:20 }}>Loading…</div>
              ) : merchantEvents.length > 0 && (
                <>
                  <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1, textTransform:"uppercase",
                    marginBottom:7 }}>RECENT EVENTS ({merchantEvents.length})</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:3, maxHeight:200, overflowY:"auto" }}>
                    {merchantEvents.map((e,i) => (
                      <div key={i} style={{ display:"flex", gap:8, alignItems:"center",
                        padding:"5px 6px", background:"rgba(255,255,255,.02)", borderRadius:4,
                        borderLeft:`2px solid ${e.success===1?"#4ade80":SEV[e.severity]?.dot||"#f87171"}` }}>
                        <span style={{ fontSize:9 }}>
                          {e.success===1?"✓":e.success===0?"✗":"⚠"}
                        </span>
                        <span style={{ fontSize:8, fontFamily:"monospace", color:"#e2cfa0", flex:1 }}>
                          {e.action_key}
                        </span>
                        <span style={{ fontSize:8, color:SEV[e.severity]?.text||"#9C9C9C" }}>
                          {e.error_code||"OK"}
                        </span>
                        <span style={{ fontSize:7, color:"#9C9C9C" }}>
                          {elapsed(e.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Open alerts for this merchant */}
              {merchantAlerts.filter(a=>!a.resolved).length > 0 && (
                <>
                  <div style={{ fontSize:8, color:"#9C9C9C", letterSpacing:1, textTransform:"uppercase",
                    marginTop:12, marginBottom:7 }}>OPEN ALERTS</div>
                  {merchantAlerts.filter(a=>!a.resolved).map((a,i) => (
                    <div key={i} style={{ background:SEV[a.severity]?.bg||SEV.low.bg,
                      border:`1px solid ${SEV[a.severity]?.border||SEV.low.border}`,
                      borderLeft:`3px solid ${SEV[a.severity]?.dot||"#60a5fa"}`,
                      borderRadius:"0 6px 6px 0", padding:"8px 10px", marginBottom:5 }}>
                      <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:3 }}>
                        <span style={{ fontSize:8, fontFamily:"monospace", fontWeight:700,
                          color:"#e2cfa0" }}>{a.action_key}</span>
                        <span style={{ fontSize:7, color:SEV[a.severity]?.text||"#60a5fa",
                          fontWeight:700 }}>{(a.severity||"").toUpperCase()}</span>
                      </div>
                      <div style={{ fontSize:9, color:"#c8d8e8" }}>{a.inline_message}</div>
                      {a.fix_message && (
                        <div style={{ fontSize:8, color:"#e2cfa0", marginTop:4 }}>
                          → {a.fix_message}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT — TWIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
export default function TwinDashboard() {
  const [merchants, setMerchants] = useState([]);
  const [events,    setEvents]    = useState([]);
  const [alerts,    setAlerts]    = useState([]);
  const [rules,     setRules]     = useState([]);
  const [apiOnline, setApiOnline] = useState(null);
  const [lastPoll,  setLastPoll]  = useState(null);
  const [resolving, setResolving] = useState(null);
  const [layout,    setLayout]    = useState("mission"); // mission | focus
  const [focusPanel,setFocusPanel]= useState(null);
  const pollRef = useRef({});

  // ── Initial load
  const loadAll = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([
        api.get("/merchants", { limit:200 }),
        api.get("/rules"),
      ]);
      setMerchants(Array.isArray(m) ? m : []);
      setRules(Array.isArray(r) ? r : []);
      setApiOnline(true);
    } catch { setApiOnline(false); }
  }, []);

  // ── Live polls
  const pollEvents = useCallback(async () => {
    try {
      const data = await api.get("/events", { limit:200 });
      setEvents(Array.isArray(data) ? data : []);
      setLastPoll(new Date());
    } catch {}
  }, []);

  const pollAlerts = useCallback(async () => {
    try {
      const data = await api.get("/alerts", { resolved:0 });
      setAlerts(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => {
    loadAll();
    pollEvents();
    pollAlerts();
    pollRef.current.events = setInterval(pollEvents, 3000);
    pollRef.current.alerts = setInterval(pollAlerts, 5000);
    pollRef.current.merchants = setInterval(loadAll, 15000);
    return () => Object.values(pollRef.current).forEach(clearInterval);
  }, []);

  const resolveAlert = async (id) => {
    setResolving(id);
    try {
      await api.post(`/alerts/${id}/resolve`, {});
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch {}
    finally { setResolving(null); }
  };

  const openAlerts = alerts.filter(a => !a.resolved);
  const criticalCount = openAlerts.filter(a => a.severity === "critical").length;

  if (apiOnline === false) {
    return (
      <div style={{ background:"#030810", minHeight:"100vh", display:"flex",
        flexDirection:"column", alignItems:"center", justifyContent:"center",
        fontFamily:"'DM Mono', monospace", color:"#c8d8e8" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');`}</style>
        <div style={{ fontSize:48, marginBottom:16 }}>📡</div>
        <div style={{ fontSize:20, fontWeight:800, color:"#f87171", fontFamily:"'Syne',sans-serif", marginBottom:8 }}>
          TWIN OFFLINE
        </div>
        <div style={{ fontSize:10, color:"#9C9C9C", marginBottom:20, textAlign:"center", lineHeight:2 }}>
          Cannot reach <span style={{ color:"#e2cfa0" }}>{BASE}</span>
        </div>
        <div style={{ background:"#060d14", border:"1px solid #9C9C9C", borderRadius:8,
          padding:"12px 18px", fontFamily:"monospace", fontSize:10, color:"#4ade80" }}>
          cd merchant-twin-backend && npm run dev
        </div>
        <button onClick={loadAll} style={{ marginTop:16, background:"rgba(74,222,128,.1)",
          border:"1px solid rgba(74,222,128,.3)", color:"#4ade80",
          borderRadius:7, padding:"9px 18px", cursor:"pointer", fontFamily:"inherit",
          fontSize:10, fontWeight:700 }}>↺ Retry</button>
      </div>
    );
  }

  const panels = [
    { id:"fleet",   label:"Fleet Overview",     icon:"🛰️",  color:"#c8d8e8" },
    { id:"alerts",  label:"Alert Feed",          icon:"🚨",  color:"#f87171" },
    { id:"log",     label:"Activity Log",        icon:"📋",  color:"#60a5fa" },
    { id:"heatmap", label:"Demand Heatmap",      icon:"📊",  color:"#fbbf24" },
    { id:"deepdive",label:"Merchant Deep-Dive",  icon:"🔬",  color:"#a78bfa" },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:#030810}
        ::-webkit-scrollbar-thumb{background:#9C9C9C;border-radius:2px}
        @keyframes dotPing{0%{transform:scale(1);opacity:.8}70%{transform:scale(2.5);opacity:0}100%{transform:scale(2.5);opacity:0}}
        @keyframes slideIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @keyframes scanline{0%{transform:translateY(-100%)}100%{transform:translateY(100vh)}}
        @keyframes gridPulse{0%,100%{opacity:.03}50%{opacity:.06}}
      `}</style>

      <div style={{ background:"#030810", color:"#c8d8e8", minHeight:"100vh",
        display:"flex", flexDirection:"column", fontFamily:"'DM Mono', monospace",
        position:"relative", overflow:"hidden" }}>

        {/* Background grid */}
        <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0,
          backgroundImage:"linear-gradient(rgba(0,200,83,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,83,.04) 1px, transparent 1px)",
          backgroundSize:"40px 40px", animation:"gridPulse 4s ease infinite" }} />

        {/* Scanline effect */}
        <div style={{ position:"fixed", left:0, right:0, height:2, zIndex:1, pointerEvents:"none",
          background:"linear-gradient(transparent, rgba(0,200,83,.06), transparent)",
          animation:"scanline 8s linear infinite" }} />

        {/* ── HEADER */}
        <div style={{ background:"rgba(4,12,22,.95)", backdropFilter:"blur(10px)",
          borderBottom:"1px solid rgba(0,200,83,.1)",
          padding:"8px 18px", display:"flex", alignItems:"center", justifyContent:"space-between",
          position:"sticky", top:0, zIndex:50 }}>
          <div style={{ display:"flex", gap:12, alignItems:"center" }}>
            <div style={{ display:"flex", gap:5, alignItems:"center" }}>
              <PulseDot color="#4ade80" size={8} />
              <span style={{ fontSize:14, fontWeight:800, color:"#4ade80",
                fontFamily:"'Syne', sans-serif", letterSpacing:.5 }}>TWIN DASHBOARD</span>
            </div>
            <span style={{ fontSize:8, color:"#9C9C9C" }}>·</span>
            <span style={{ fontSize:8, color:"#9C9C9C" }}>Safaricom LNM Merchant Digital Twin</span>
          </div>

          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            {/* Critical alert badge */}
            {criticalCount > 0 && (
              <div style={{ display:"flex", gap:5, alignItems:"center",
                background:"rgba(239,68,68,.12)", border:"1px solid rgba(239,68,68,.35)",
                borderRadius:5, padding:"3px 10px", animation:"dotPing .8s ease infinite" }}>
                <PulseDot color="#ef4444" size={5} />
                <span style={{ fontSize:9, color:"#f87171", fontWeight:800 }}>
                  {criticalCount} CRITICAL
                </span>
              </div>
            )}

            {/* Stats chips */}
            {[
              { v:merchants.length, label:"merchants", color:"#c8d8e8" },
              { v:events.length, label:"events", color:"#60a5fa" },
              { v:openAlerts.length, label:"alerts", color:openAlerts.length>0?"#fbbf24":"#9C9C9C" },
            ].map(s => (
              <div key={s.label} style={{ fontSize:8, color:"#9C9C9C",
                background:"#060d14", border:"1px solid #0e1922",
                borderRadius:4, padding:"3px 8px" }}>
                <span style={{ color:s.color, fontWeight:700 }}>{s.v}</span> {s.label}
              </div>
            ))}

            {/* Last poll */}
            {lastPoll && (
              <span style={{ fontSize:7, color:"#9C9C9C", fontFamily:"monospace" }}>
                ↺ {fmtTime(lastPoll)}
              </span>
            )}

            {/* API status */}
            <div style={{ display:"flex", gap:4, alignItems:"center", background:"#040b10",
              border:"1px solid #0e1922", borderRadius:4, padding:"3px 8px" }}>
              <PulseDot color="#4ade80" size={4} />
              <span style={{ fontSize:8, color:"#4ade80" }}>LIVE :4000</span>
            </div>
          </div>
        </div>

        {/* ── PANEL QUICK JUMP */}
        <div style={{ background:"rgba(3,8,16,.9)", borderBottom:"1px solid #0e1922",
          padding:"4px 18px", display:"flex", gap:2, position:"sticky", top:42, zIndex:49 }}>
          {panels.map(p => (
            <a key={p.id} href={`#panel-${p.id}`}
              style={{ color:p.color, fontSize:8, fontWeight:700, padding:"3px 10px",
                borderRadius:4, textDecoration:"none", transition:"all .12s",
                background:"transparent" }}
              onMouseEnter={e=>e.currentTarget.style.background=`${p.color}12`}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              {p.icon} {p.label}
            </a>
          ))}
        </div>

        {/* ── MAIN CONTENT */}
        <div style={{ flex:1, padding:"14px 18px", position:"relative", zIndex:2 }}>

          {/* ROW 1: Fleet + Alerts side by side */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 380px", gap:14, marginBottom:14 }}>
            {/* Fleet overview */}
            <div id="panel-fleet" style={{ background:"rgba(5,12,20,.8)", backdropFilter:"blur(8px)",
              border:"1px solid #0e1922", borderRadius:12, padding:16 }}>
              <FleetOverview merchants={merchants} events={events} alerts={alerts} rules={rules} />
            </div>

            {/* Alert feed */}
            <div id="panel-alerts" style={{ background:"rgba(5,12,20,.8)", backdropFilter:"blur(8px)",
              border:"1px solid rgba(239,68,68,.12)", borderRadius:12, padding:16,
              display:"flex", flexDirection:"column", maxHeight:520, overflow:"hidden" }}>
              <AlertFeed alerts={openAlerts} onResolve={resolveAlert} resolving={resolving} />
            </div>
          </div>

          {/* ROW 2: Activity log + Heatmap side by side */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
            {/* Activity log */}
            <div id="panel-log" style={{ background:"rgba(5,12,20,.8)", backdropFilter:"blur(8px)",
              border:"1px solid rgba(96,165,250,.08)", borderRadius:12, padding:16,
              maxHeight:500, overflow:"hidden", display:"flex", flexDirection:"column" }}>
              <ActivityLog events={events} loading={apiOnline===null} />
            </div>

            {/* Demand heatmap */}
            <div id="panel-heatmap" style={{ background:"rgba(5,12,20,.8)", backdropFilter:"blur(8px)",
              border:"1px solid rgba(251,191,36,.08)", borderRadius:12, padding:16,
              maxHeight:500, overflow:"hidden", display:"flex", flexDirection:"column" }}>
              <DemandHeatmap rules={rules} events={events} merchants={merchants} />
            </div>
          </div>

          {/* ROW 3: Merchant deep-dive full width */}
          <div id="panel-deepdive" style={{ background:"rgba(5,12,20,.8)", backdropFilter:"blur(8px)",
            border:"1px solid rgba(167,139,250,.08)", borderRadius:12, padding:16,
            maxHeight:560, overflow:"hidden", display:"flex", flexDirection:"column" }}>
            <MerchantDeepDive merchants={merchants} events={events} alerts={alerts} rules={rules} />
          </div>
        </div>
      </div>
    </>
  );
}