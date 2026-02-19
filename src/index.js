import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';

// ── Four steps of the Merchant Digital Twin
import MerchantDataModelViewer from './merchantdatamodelviewer.jsx';   // Step 1 UI
import FailureRulesViewer from './failurerulesviewer';             // Step 2 UI
import MerchantSimulator from './merchant-simulator';           // Step 3
import TwinDashboard from './twinDashboard';                       // Step 4

const STEPS = [
  {
    id: 1,
    label: "Data Model",
    icon: "🗄️",
    file: "merchantDataModel.js",
    desc: "Schema · Registry · Generator · Mutations · Utilities",
    tag: "STEP 1",
    component: MerchantDataModelViewer,
  },
  {
    id: 2,
    label: "Rules Engine",
    icon: "⚙️",
    file: "failureRulesEngine.js",
    desc: "12 Rules · Evaluator · Pre-scanner · Batch scanner",
    tag: "STEP 2",
    component: FailureRulesViewer,
  },
  {
    id: 3,
    label: "Simulator",
    icon: "📱",
    file: "merchant-simulator-v2.jsx",
    desc: "M-PESA App · USSD *234# · Web Portal",
    tag: "STEP 3",
    component: MerchantSimulator,
  },
  {
    id: 4,
    label: "Twin Dashboard",
    icon: "🔁",
    file: "twinDashboard.jsx",
    desc: "Mirror · Analyze · Update · Summarize · Fleet · Alerts",
    tag: "STEP 4",
    component: TwinDashboard,
  },
];

function App() {
  const [activeStep, setActiveStep] = useState(4);
  const ActiveComponent = STEPS.find(s => s.id === activeStep)?.component;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#060a0f", fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif" }}>

      {/* ── Tab bar */}
      <div style={{
        background: "#080b10",
        borderBottom: "1px solid #1e2730",
        display: "flex",
        alignItems: "stretch",
        padding: "0 16px",
        gap: 4,
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingRight: 20, borderRight: "1px solid #1e2730", marginRight: 8 }}>
          <div style={{ background: "linear-gradient(135deg, #00a651, #005520)", borderRadius: 7, padding: "5px 8px", fontSize: 14 }}>📡</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 12, color: "#e2e8f0", letterSpacing: -0.3 }}>Merchant Digital Twin</div>
            <div style={{ fontSize: 8, color: "#374151" }}>Safaricom LNM · 4-Step Architecture</div>
          </div>
        </div>

        {/* Step tabs */}
        {STEPS.map(step => {
          const active = activeStep === step.id;
          return (
            <button
              key={step.id}
              onClick={() => setActiveStep(step.id)}
              style={{
                background: active ? "rgba(0,166,81,0.1)" : "transparent",
                border: "none",
                borderBottom: active ? "2px solid #00a651" : "2px solid transparent",
                borderTop: "2px solid transparent",
                color: active ? "#e2e8f0" : "#4b5563",
                padding: "10px 16px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 2,
                transition: "all 0.15s",
                minWidth: 140,
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.color = "#94a3b8"; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.color = "#4b5563"; }}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{
                  fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
                  color: active ? "#00a651" : "#374151",
                  background: active ? "rgba(0,166,81,0.15)" : "#161b22",
                  padding: "1px 5px", borderRadius: 3,
                }}>{step.tag}</span>
                <span style={{ fontSize: 11, fontWeight: 700 }}>{step.icon} {step.label}</span>
              </div>
              <div style={{ fontSize: 8, color: active ? "#6b7280" : "#374151", lineHeight: 1.3 }}>{step.desc}</div>
            </button>
          );
        })}

        {/* Architecture flow — right side */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, paddingLeft: 16 }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {i > 0 && <span style={{ color: "#1e2730", fontSize: 12 }}>→</span>}
              <button onClick={() => setActiveStep(s.id)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 8, color: activeStep === s.id ? "#00a651" : "#374151",
                fontWeight: activeStep === s.id ? 700 : 400,
                padding: "2px 4px",
              }}>
                {s.file}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Active step content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {ActiveComponent && <ActiveComponent />}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);