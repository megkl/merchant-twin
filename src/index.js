// src/index.js — Merchant Digital Twin (Full Stack v3)
// 7 tabs: Data Model · Rules Engine · Simulator · Twin Dashboard · AI Dashboard · Upload · Bot Lab

import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";

import MerchantDataModelViewer from "./merchantDataModelViewer";
import FailureRulesViewer      from "./failureRulesViewer";
import MerchantSimulator       from "./merchantSimulator";
import TwinDashboard           from "./twinDashboard";

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Syne:wght@700;800&family=Nunito:wght@400;600;700;800;900&display=swap');
  @keyframes pulse  { 0%,100%{opacity:0.5}50%{opacity:1} }
  @keyframes fadeIn { from{opacity:0}to{opacity:1} }
  * { box-sizing:border-box; }
  body { margin:0; padding:0; }
  ::-webkit-scrollbar { width:4px; height:4px; }
  ::-webkit-scrollbar-track { background:#080b10; }
  ::-webkit-scrollbar-thumb { background:#1e2730; border-radius:2px; }
  ::-webkit-scrollbar-thumb:hover { background:#374151; }
`;

const STEPS = [
  { id:1, tag:"STEP 1", icon:"🗄️", label:"Data Model",    accent:"#3b82f6", desc:"Schema · Registry · Mutations",          component:MerchantDataModelViewer },
  { id:2, tag:"STEP 2", icon:"⚙️", label:"Rules Engine",  accent:"#f97316", desc:"12 Rules · Evaluator · Batch Scanner",   component:FailureRulesViewer      },
  { id:3, tag:"STEP 3", icon:"📱", label:"Simulator",      accent:"#00a651", desc:"App · USSD *234# · Web Portal",          component:MerchantSimulator       },
  { id:4, tag:"STEP 4", icon:"🔁", label:"Twin Dashboard", accent:"#10b981", desc:"Mirror · Analyze · Update · Summarize",  component:TwinDashboard           },
 ];

function BackendStatus() {
  const [status, setStatus] = useState("checking");
  useEffect(() => {
    const check = () => {
      fetch("http://localhost:4000/api/v1/health")
        .then(r => r.json())
        .then(d => setStatus(d.status === "ok" ? "ok" : "error"))
        .catch(() => setStatus("error"));
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);
  const color = status === "ok" ? "#4ade80" : status === "error" ? "#ef4444" : "#fbbf24";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, background:"#0a0e14", padding:"4px 10px", borderRadius:5, border:"1px solid #1e2730" }}>
      <div style={{ width:6, height:6, borderRadius:"50%", background:color, animation: status!=="ok" ? "pulse 1s infinite" : "none" }} />
      <span style={{ fontSize:8, color, fontFamily:"'JetBrains Mono',monospace" }}>
        {status === "ok" ? "API :4000 ✓" : status === "error" ? "API offline" : "Connecting..."}
      </span>
    </div>
  );
}

function App() {
  const [active, setActive] = useState(1); // Open on Bot Lab

  const step = STEPS.find(s => s.id === active);
  const ActiveComponent = step?.component;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:"#060a0f", fontFamily:"'Nunito',sans-serif", overflow:"hidden" }}>
      <style>{CSS}</style>

      {/* NAV */}
      <nav style={{ background:"#080b10", borderBottom:"1px solid #1e2730", display:"flex", alignItems:"stretch", padding:"0 12px", gap:1, flexShrink:0, overflowX:"auto" }}>
        {/* Brand */}
        <div style={{ display:"flex", alignItems:"center", gap:8, paddingRight:12, borderRight:"1px solid #1e2730", marginRight:4, flexShrink:0 }}>
          <div style={{ background:"linear-gradient(135deg,#00a651,#005520)", borderRadius:7, padding:"4px 7px", fontSize:12 }}>📡</div>
          <div>
            <div style={{ fontWeight:900, fontSize:11, color:"#e2e8f0", fontFamily:"'Syne',sans-serif" }}>Merchant Digital Twin</div>
            <div style={{ fontSize:6, color:"#374151" }}>Safaricom LNM · v3 · ML + Bots</div>
          </div>
        </div>

        {STEPS.map(s => {
          const isActive = active === s.id;
          return (
            <button key={s.id} onClick={() => setActive(s.id)} style={{
              background: isActive ? `${s.accent}10` : "transparent",
              border:"none",
              borderBottom: isActive ? `2px solid ${s.accent}` : "2px solid transparent",
              borderTop:"2px solid transparent",
              color: isActive ? "#e2e8f0" : "#4b5563",
              padding:"6px 12px", cursor:"pointer",
              display:"flex", flexDirection:"column", alignItems:"flex-start", gap:1,
              transition:"all 0.15s", minWidth:95, flexShrink:0,
            }}>
              <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                <span style={{ fontSize:6, fontWeight:700, color: isActive ? s.accent : "#374151", background: isActive ? `${s.accent}20` : "#161b22", padding:"1px 4px", borderRadius:3 }}>
                  {s.tag}
                </span>
                <span style={{ fontSize:9, fontWeight:700 }}>{s.icon} {s.label}</span>
                {s.ai && <span style={{ fontSize:5, background:"linear-gradient(90deg,#6366f1,#8b5cf6)", color:"white", padding:"1px 3px", borderRadius:2, fontWeight:700 }}>AI</span>}
                {s.ml && <span style={{ fontSize:5, background:"linear-gradient(90deg,#7c3aed,#a78bfa)", color:"white", padding:"1px 3px", borderRadius:2, fontWeight:700 }}>ML</span>}
              </div>
              <div style={{ fontSize:6, color: isActive ? "#4b5563" : "#1e2730", whiteSpace:"nowrap", overflow:"hidden", maxWidth:130, textOverflow:"ellipsis" }}>{s.desc}</div>
            </button>
          );
        })}

        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", padding:"0 6px", flexShrink:0 }}>
          <BackendStatus />
        </div>
      </nav>

      {/* ACTIVE TAB */}
      <div key={active} style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column", animation:"fadeIn 0.15s" }}>
        {ActiveComponent && <ActiveComponent />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);