// MerchantDataModelViewer.jsx
// Live backend-connected merchant data model viewer
// All data from http://localhost:4000/api/v1 — zero hardcoded merchants
// Three modes: Registry (browse/view), Generator (random), Manual Add, Upload CSV

import { useState, useEffect, useCallback, useRef } from "react";

// ─── API CLIENT ───────────────────────────────────────────────────────────────
const BASE = "http://localhost:4000/api/v1";

const api = {
  get:    (path) => fetch(`${BASE}${path}`).then(r => r.json()),
  post:   (path, body) => fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
  put:    (path, body) => fetch(`${BASE}${path}`, { method: "PUT",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
  delete: (path)       => fetch(`${BASE}${path}`, { method: "DELETE" }).then(r => r.json()),
  upload: (path, form) => fetch(`${BASE}${path}`, { method: "POST", body: form }).then(r => r.json()),
};

// ─── SENSOR HEALTH ────────────────────────────────────────────────────────────
function sensorColor(field, value) {
  const v = String(value ?? "").toLowerCase();
  const rules = {
    account_status:      { green: ["active"],         red: ["suspended", "frozen"] },
    kyc_status:          { green: ["verified"],       amber: ["pending"], red: ["expired"] },
    sim_status:          { green: ["active"],         amber: ["swapped"], red: ["unregistered"] },
    pin_locked:          { green: ["0", "false"],     red: ["1", "true"] },
    start_key_status:    { green: ["valid"],          red: ["invalid", "expired"] },
    settlement_on_hold:  { green: ["0", "false"],     red: ["1", "true"] },
    notifications_enabled: { green: ["1", "true"],   amber: ["0", "false"] },
  };
  const r = rules[field];
  if (!r) {
    if (field === "dormant_days") {
      const n = parseInt(value) || 0;
      return n < 30 ? "#4ade80" : n < 60 ? "#fbbf24" : "#f87171";
    }
    if (field === "kyc_age_days") {
      const n = parseInt(value) || 0;
      return n < 180 ? "#4ade80" : n < 365 ? "#fbbf24" : "#f87171";
    }
    if (field === "pin_attempts") {
      const n = parseInt(value) || 0;
      return n === 0 ? "#4ade80" : n < 3 ? "#fbbf24" : "#f87171";
    }
    return "#94a3b8";
  }
  if (r.green?.includes(v)) return "#4ade80";
  if (r.amber?.includes(v)) return "#fbbf24";
  if (r.red?.includes(v))   return "#f87171";
  return "#94a3b8";
}

function getRiskTier(m) {
  if (!m) return { label: "UNKNOWN", color: "#4b5563", bg: "rgba(75,85,99,.12)", border: "rgba(75,85,99,.3)" };
  const red = [
    m.account_status !== "active",
    m.kyc_status === "expired",
    m.pin_locked == 1 || m.pin_locked === true,
    m.start_key_status !== "valid",
    m.settlement_on_hold == 1,
  ].filter(Boolean).length;
  const amber = [
    m.kyc_status === "pending",
    parseInt(m.pin_attempts) >= 2,
    m.sim_status === "swapped",
    parseInt(m.dormant_days) >= 30,
    !m.notifications_enabled || m.notifications_enabled == 0,
  ].filter(Boolean).length;

  if (red >= 3 || (red >= 2 && amber >= 2)) return { label: "CRITICAL", color: "#f87171", bg: "rgba(248,113,113,.1)", border: "rgba(248,113,113,.35)" };
  if (red >= 1 || amber >= 3)               return { label: "HIGH RISK", color: "#fb923c", bg: "rgba(251,146,60,.08)", border: "rgba(251,146,60,.3)" };
  if (amber >= 2)                           return { label: "MEDIUM", color: "#fbbf24", bg: "rgba(251,191,36,.08)", border: "rgba(251,191,36,.3)" };
  if (amber >= 1)                           return { label: "LOW RISK", color: "#a3e635", bg: "rgba(163,230,53,.07)", border: "rgba(163,230,53,.25)" };
  return                                           { label: "HEALTHY", color: "#4ade80", bg: "rgba(74,222,128,.07)", border: "rgba(74,222,128,.25)" };
}

// ─── SENSOR FIELDS DISPLAY CONFIG ─────────────────────────────────────────────
const SENSOR_FIELDS = [
  { key: "account_status",        label: "Account Status" },
  { key: "kyc_status",            label: "KYC Status" },
  { key: "kyc_age_days",          label: "KYC Age",          suffix: "d" },
  { key: "sim_status",            label: "SIM Status" },
  { key: "pin_attempts",          label: "PIN Attempts",     suffix: "/3" },
  { key: "pin_locked",            label: "PIN Locked" },
  { key: "start_key_status",      label: "Start Key" },
  { key: "balance",               label: "Balance",          prefix: "KES ", fmt: n => Number(n).toLocaleString() },
  { key: "dormant_days",          label: "Dormant",          suffix: "d" },
  { key: "notifications_enabled", label: "Notifications" },
  { key: "settlement_on_hold",    label: "Settlement Hold" },
  { key: "operator_dormant_days", label: "Operator Dormant", suffix: "d" },
];

const FIELD_GROUPS = {
  identity: {
    label: "Identity",
    fields: ["first_name","middle_name","last_name","date_of_birth","gender","nationality","document_type","document_number"],
  },
  contact: {
    label: "Contact",
    fields: ["phone_number","email","county","city","physical_address","postal_address","postal_code"],
  },
  business: {
    label: "Business",
    fields: ["business_name","business_category","business_region","paybill","kra_pin","certificate_number","product","duration","application_status","expected_turnover"],
  },
  banking: {
    label: "Banking",
    fields: ["bank","bank_branch","bank_account_name","bank_account","source_of_funds","purpose_of_funds"],
  },
  demographics: {
    label: "Demographics",
    fields: ["network_type","customer_type","literacy_tier","transaction_tier","transaction_count_30d","preferred_channel"],
  },
};

// ─── MANUAL ADD FORM SCHEMA ────────────────────────────────────────────────────
const MANUAL_FIELDS = [
  { key: "first_name",    label: "First Name",     required: true },
  { key: "last_name",     label: "Last Name",      required: true },
  { key: "business_name", label: "Business Name",  required: true },
  { key: "phone_number",  label: "Phone Number",   placeholder: "07XXXXXXXX" },
  { key: "paybill",       label: "Paybill",        placeholder: "174379" },
  { key: "county",        label: "County",         type: "select", options: ["Nairobi","Mombasa","Kisumu","Nakuru","Eldoret","Kiambu","Machakos","Meru","Nyeri","Embu","Kakamega","Kisii"] },
  { key: "bank",          label: "Bank",           placeholder: "Equity Bank" },
  { key: "bank_account",  label: "Bank Account",   placeholder: "01234567890" },
  { key: "balance",       label: "Initial Balance (KES)", type: "number" },
  { key: "network_type",  label: "Network",        type: "select", options: ["4G","3G","5G","2G"] },
  { key: "customer_type", label: "Customer Type",  type: "select", options: ["new","existing","dormant"] },
  { key: "literacy_tier", label: "Literacy",       type: "select", options: ["literate","semi-literate","illiterate"] },
  { key: "transaction_tier", label: "Txn Tier",    type: "select", options: ["high","medium","low"] },
  { key: "preferred_channel", label: "Channel",    type: "select", options: ["app","ussd","web"] },
];

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  root: {
    background: "#04080d",
    color: "#dde8f4",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    fontFamily: "'IBM Plex Mono', 'Fira Code', 'JetBrains Mono', monospace",
    fontSize: 12,
  },
  header: {
    background: "#060b11",
    borderBottom: "1px solid rgba(0,200,83,.15)",
    padding: "10px 18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    position: "sticky",
    top: 0,
    zIndex: 50,
  },
  tabBar: {
    background: "#050a10",
    borderBottom: "1px solid #0e1922",
    display: "flex",
    padding: "0 18px",
    gap: 2,
    overflowX: "auto",
  },
  body: { flex: 1, display: "flex", overflow: "hidden" },
  sidebar: { width: 230, flexShrink: 0, borderRight: "1px solid #0e1922", display: "flex", flexDirection: "column", overflow: "hidden" },
  main: { flex: 1, overflow: "auto", padding: 16 },
  card: { background: "#070d14", border: "1px solid #0e1922", borderRadius: 8, padding: 12, marginBottom: 10 },
  input: {
    background: "#060c13", border: "1px solid #9C9C9C", color: "#dde8f4",
    borderRadius: 5, padding: "6px 9px", fontSize: 11, outline: "none",
    fontFamily: "inherit", width: "100%", transition: "border-color .15s",
  },
  btn: {
    background: "rgba(0,200,83,.12)", border: "1px solid rgba(0,200,83,.3)", color: "#4ade80",
    borderRadius: 5, padding: "6px 13px", cursor: "pointer", fontFamily: "inherit",
    fontSize: 10, fontWeight: 700, letterSpacing: .5, transition: "all .15s",
  },
  btnDanger: {
    background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)", color: "#f87171",
    borderRadius: 5, padding: "6px 10px", cursor: "pointer", fontFamily: "inherit",
    fontSize: 9, transition: "all .15s",
  },
  btnGhost: {
    background: "none", border: "1px solid #9C9C9C", color: "#9C9C9C",
    borderRadius: 5, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit",
    fontSize: 10, transition: "all .15s",
  },
  label: { fontSize: 8, color: "#9C9C9C", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 5, display: "block" },
  sectionTitle: { fontSize: 8, color: "#9C9C9C", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  kvKey: { fontSize: 9, color: "#9C9C9C" },
  kvVal: { fontSize: 9, color: "#8ca4bc", maxWidth: 160, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
};

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, display: "flex", flexDirection: "column", gap: 6, zIndex: 200 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === "error" ? "rgba(239,68,68,.12)" : "rgba(0,200,83,.1)",
          border: `1px solid ${t.type === "error" ? "rgba(239,68,68,.4)" : "rgba(0,200,83,.4)"}`,
          color: t.type === "error" ? "#f87171" : "#4ade80",
          borderRadius: 7, padding: "8px 14px", fontSize: 10,
          animation: "toastIn .2s ease",
          boxShadow: "0 4px 20px rgba(0,0,0,.4)",
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ─── MERCHANT CARD (SIDEBAR) ──────────────────────────────────────────────────
function MerchantCard({ merchant, selected, onClick }) {
  const tier = getRiskTier(merchant);
  return (
    <button onClick={onClick} style={{
      background: selected ? "rgba(0,200,83,.06)" : "transparent",
      border: `1px solid ${selected ? "rgba(0,200,83,.3)" : "transparent"}`,
      borderRadius: 7, padding: "9px 11px", cursor: "pointer", textAlign: "left",
      width: "100%", display: "flex", gap: 9, alignItems: "center",
      transition: "all .15s",
    }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>{merchant.avatar || "🏪"}</span>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div style={{ color: "#dde8f4", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {merchant.business_name}
        </div>
        <div style={{ fontSize: 9, color: "#9C9C9C" }}>
          PB {merchant.paybill || "—"}
        </div>
        <div style={{ fontSize: 8, color: tier.color, fontWeight: 700, marginTop: 2 }}>
          {tier.label}
        </div>
      </div>
      <div style={{
        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
        background: tier.color, boxShadow: `0 0 6px ${tier.color}80`,
      }} />
    </button>
  );
}

// ─── SENSOR GRID ──────────────────────────────────────────────────────────────
function SensorGrid({ merchant }) {
  return (
    <div>
      <div style={S.sectionTitle}>📡 Live Sensors</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
        {SENSOR_FIELDS.map(({ key, label, suffix, prefix, fmt }) => {
          const raw = merchant[key];
          const display = raw == null ? "—" : (prefix || "") + (fmt ? fmt(raw) : raw) + (suffix || "");
          const col = sensorColor(key, raw);
          return (
            <div key={key} style={{ background: "#040b10", border: `1px solid ${col}20`, borderRadius: 6, padding: "7px 8px" }}>
              <div style={{ fontSize: 7, color: "#9C9C9C", marginBottom: 3, letterSpacing: .5 }}>{label}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: col, textTransform: "uppercase", letterSpacing: .3 }}>
                {display}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FIELD GROUP ──────────────────────────────────────────────────────────────
function FieldGroup({ title, fields, merchant }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ ...S.card, padding: 0, overflow: "hidden", marginBottom: 8 }}>
      <button onClick={() => setOpen(!open)} style={{
        background: "none", border: "none", color: "#8ca4bc", cursor: "pointer",
        width: "100%", textAlign: "left", padding: "9px 12px",
        display: "flex", justifyContent: "space-between", fontFamily: "inherit", fontSize: 9,
        letterSpacing: 1.5, textTransform: "uppercase",
      }}>
        <span style={{ color: "#9C9C9C" }}>{title}</span>
        <span style={{ color: "#9C9C9C" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 12px 10px" }}>
          {fields.filter(f => merchant[f] != null && merchant[f] !== "").map(f => (
            <div key={f} style={S.row}>
              <span style={S.kvKey}>{f.replace(/_/g, " ")}</span>
              <span style={S.kvVal}>{String(merchant[f])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── HEALTH BAR ───────────────────────────────────────────────────────────────
function HealthBar({ merchant }) {
  const sensors = SENSOR_FIELDS.map(({ key }) => sensorColor(key, merchant[key]));
  const green  = sensors.filter(c => c === "#4ade80").length;
  const amber  = sensors.filter(c => c === "#fbbf24").length;
  const red    = sensors.filter(c => c === "#f87171").length;
  const total  = sensors.length;
  const tier   = getRiskTier(merchant);
  const score  = Math.round((green * 100 + amber * 50) / (total * 100) * 100);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontSize: 8, color: "#9C9C9C", letterSpacing: 1.5, textTransform: "uppercase" }}>Health</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: tier.color }}>{tier.label}</span>
      </div>
      <div style={{ height: 5, background: "#070d14", borderRadius: 3, overflow: "hidden", display: "flex", gap: 1 }}>
        <div style={{ width: `${(green/total)*100}%`, background: "#4ade80", transition: "width .4s" }} />
        <div style={{ width: `${(amber/total)*100}%`, background: "#fbbf24", transition: "width .4s" }} />
        <div style={{ width: `${(red/total)*100}%`,   background: "#f87171", transition: "width .4s" }} />
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 5, fontSize: 8, color: "#9C9C9C" }}>
        <span style={{ color: "#4ade80" }}>● {green} ok</span>
        <span style={{ color: "#fbbf24" }}>● {amber} warn</span>
        <span style={{ color: "#f87171" }}>● {red} fail</span>
        <span style={{ marginLeft: "auto", color: "#9C9C9C" }}>score {score}%</span>
      </div>
    </div>
  );
}

// ─── GENERATE PANEL ───────────────────────────────────────────────────────────
function GeneratePanel({ onGenerated, toast }) {
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const generate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const data = await api.post("/merchants/generate", { count });
      setResult(data);
      toast(`✓ Generated ${data.generated} merchants`, "success");
      onGenerated();
    } catch (e) {
      toast(`Error: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ ...S.card, borderColor: "rgba(0,200,83,.15)" }}>
        <div style={S.sectionTitle}>⚡ Random Generator</div>
        <div style={{ fontSize: 10, color: "#9C9C9C", lineHeight: 1.7, marginBottom: 14 }}>
          Generates merchants with weighted random sensor states matching Q4 2025 call-center failure distribution.
          Stored directly to backend via <span style={{ color: "#4ade80" }}>POST /merchants/generate</span>.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12, fontSize: 9, color: "#9C9C9C" }}>
          {[
            ["account_status", "60% active · 25% suspended · 15% frozen"],
            ["kyc_status", "60% verified · 20% pending · 20% expired"],
            ["sim_status", "80% active · 20% swapped"],
            ["pin_attempts", "55% zero · 35% 1–2 · 10% locked"],
            ["network_type", "50% 4G · 30% 3G · 10% 5G · 10% 2G"],
            ["literacy_tier", "50% literate · 30% semi · 20% illiterate"],
          ].map(([k, v]) => (
            <div key={k} style={{ background: "#040b10", borderRadius: 5, padding: "6px 8px", borderLeft: "2px solid rgba(0,200,83,.2)" }}>
              <div style={{ fontWeight: 700, color: "#4ade80", marginBottom: 2 }}>{k}</div>
              <div style={{ lineHeight: 1.5 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 9, color: "#9C9C9C" }}>Count</div>
          <input
            type="number" min={1} max={100} value={count}
            onChange={e => setCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
            style={{ ...S.input, width: 70 }}
          />
          <button onClick={generate} disabled={loading} style={{
            ...S.btn, opacity: loading ? .5 : 1,
          }}>
            {loading ? "Generating…" : `Generate ${count}`}
          </button>
        </div>
      </div>

      {result && (
        <div style={{ ...S.card, borderColor: "rgba(0,200,83,.2)" }}>
          <div style={S.sectionTitle}>✓ Generated {result.generated} merchants</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(result.merchants || []).map(m => (
              <div key={m.id} style={{
                background: "#040b10", border: "1px solid #0e1922", borderRadius: 4,
                padding: "3px 7px", fontSize: 9, color: "#9C9C9C",
              }}>
                <span style={{ color: "#4ade80" }}>{m.id}</span>
                {" "}{m.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MANUAL ADD PANEL ─────────────────────────────────────────────────────────
function ManualAddPanel({ onAdded, toast }) {
  const [form, setForm] = useState({
    network_type: "4G", customer_type: "new", literacy_tier: "literate",
    transaction_tier: "medium", preferred_channel: "app", county: "Nairobi",
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => { const n = { ...e }; delete n[k]; return n; });
  };

  const validate = () => {
    const e = {};
    MANUAL_FIELDS.filter(f => f.required).forEach(f => {
      if (!form[f.key]?.trim()) e[f.key] = "Required";
    });
    return e;
  };

  const submit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setLoading(true);
    try {
      const data = await api.post("/merchants", form);
      toast(`✓ Created merchant ${data.id}`, "success");
      setForm({ network_type: "4G", customer_type: "new", literacy_tier: "literate", transaction_tier: "medium", preferred_channel: "app", county: "Nairobi" });
      onAdded();
    } catch (err) {
      toast(`Error: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ ...S.card, borderColor: "rgba(96,165,250,.15)" }}>
      <div style={S.sectionTitle}>✍️ Manual Add</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {MANUAL_FIELDS.map(({ key, label, required, placeholder, type, options }) => (
          <div key={key}>
            <label style={S.label}>
              {label}{required && <span style={{ color: "#f87171" }}> *</span>}
            </label>
            {type === "select" ? (
              <select value={form[key] || ""} onChange={e => set(key, e.target.value)}
                style={{ ...S.input, appearance: "none", cursor: "pointer" }}>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={type || "text"}
                value={form[key] || ""}
                onChange={e => set(key, e.target.value)}
                placeholder={placeholder}
                style={{ ...S.input, borderColor: errors[key] ? "rgba(248,113,113,.4)" : "#9C9C9C" }}
              />
            )}
            {errors[key] && <div style={{ fontSize: 8, color: "#f87171", marginTop: 2 }}>{errors[key]}</div>}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <button onClick={submit} disabled={loading} style={{ ...S.btn, opacity: loading ? .6 : 1 }}>
          {loading ? "Creating…" : "Create Merchant"}
        </button>
        <button onClick={() => setForm({ network_type: "4G", customer_type: "new", literacy_tier: "literate", transaction_tier: "medium", preferred_channel: "app", county: "Nairobi" })}
          style={S.btnGhost}>
          Clear
        </button>
      </div>
    </div>
  );
}

// ─── UPLOAD PANEL ─────────────────────────────────────────────────────────────
function UploadPanel({ onUploaded, toast }) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef();

  const doUpload = async (file) => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const data = await api.upload("/upload/merchants", form);
      setResult(data);
      if (data.success_count > 0) {
        toast(`✓ Imported ${data.success_count} merchants`, "success");
        onUploaded();
      }
      if (data.error_count > 0) toast(`${data.error_count} rows had errors`, "error");
    } catch (e) {
      toast(`Upload failed: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) doUpload(file);
  };

  const downloadTemplate = () => {
    window.open(`${BASE}/upload/merchants/template`, "_blank");
  };

  return (
    <div>
      <div style={{ ...S.card, borderColor: "rgba(124,58,237,.2)" }}>
        <div style={S.sectionTitle}>📤 Upload CSV / Excel</div>
        <div style={{ fontSize: 9, color: "#9C9C9C", lineHeight: 1.7, marginBottom: 12 }}>
          Upload a CSV or Excel file of merchants. Hit <span style={{ color: "#a78bfa" }}>POST /upload/merchants</span>. Required fields: first_name, last_name, business_name.
        </div>

        <button onClick={downloadTemplate} style={{ ...S.btnGhost, marginBottom: 12, fontSize: 9 }}>
          ↓ Download CSV Template
        </button>

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? "rgba(124,58,237,.6)" : "rgba(124,58,237,.2)"}`,
            borderRadius: 8, padding: "28px 20px", textAlign: "center", cursor: "pointer",
            background: dragging ? "rgba(124,58,237,.05)" : "transparent",
            transition: "all .15s",
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>📁</div>
          <div style={{ fontSize: 10, color: "#9C9C9C", lineHeight: 1.6 }}>
            {loading ? "Uploading…" : "Drop CSV or Excel file here, or click to browse"}
          </div>
          <div style={{ fontSize: 8, color: "#9C9C9C", marginTop: 6 }}>
            .csv · .xlsx · .xls · max 10MB
          </div>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
            onChange={e => doUpload(e.target.files?.[0])} />
        </div>
      </div>

      {result && (
        <div style={{ ...S.card, borderColor: result.error_count > 0 ? "rgba(251,191,36,.2)" : "rgba(0,200,83,.2)" }}>
          <div style={S.sectionTitle}>Upload Result</div>
          <div style={S.row}>
            <span style={S.kvKey}>Filename</span>
            <span style={{ fontSize: 9, color: "#a78bfa" }}>{result.filename}</span>
          </div>
          <div style={S.row}>
            <span style={S.kvKey}>Total rows</span>
            <span style={{ ...S.kvVal }}>{result.row_count}</span>
          </div>
          <div style={S.row}>
            <span style={S.kvKey}>Imported</span>
            <span style={{ fontSize: 9, color: "#4ade80", fontWeight: 700 }}>{result.success_count}</span>
          </div>
          <div style={S.row}>
            <span style={S.kvKey}>Errors</span>
            <span style={{ fontSize: 9, color: result.error_count > 0 ? "#f87171" : "#4ade80" }}>{result.error_count}</span>
          </div>
          {result.errors?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={S.sectionTitle}>Errors</div>
              {result.errors.slice(0, 5).map((e, i) => (
                <div key={i} style={{ fontSize: 9, color: "#f87171", padding: "2px 0" }}>{String(e)}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MERCHANT DETAIL PANEL ────────────────────────────────────────────────────
function MerchantDetail({ merchant, onDelete, onRefresh, toast }) {
  const [deleting, setDeleting] = useState(false);
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [activeSection, setActiveSection] = useState("sensors");
  const tier = getRiskTier(merchant);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const loadProfile = async () => {
    if (profile) return;
    setLoadingProfile(true);
    try {
      const data = await api.get(`/merchants/${merchant.id}/profile`);
      setProfile(data);
    } catch {/* profile unavailable */} finally {
      setLoadingProfile(false);
    }
  };

  useEffect(() => {
    setProfile(null);
    setActiveSection("sensors");
  }, [merchant.id]);

  const doDelete = async () => {
    setDeleting(true);
    setConfirmDelete(false);
    try {
      await api.delete(`/merchants/${merchant.id}`);
      toast(`Deleted ${merchant.business_name}`, "success");
      onDelete(merchant.id);
    } catch (e) {
      toast(`Error: ${e.message}`, "error");
    } finally {
      setDeleting(false);
    }
  };

  const sections = ["sensors", "identity", "business", "contact", "banking", "demographics"];

  return (
    <div>
      {/* Merchant header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
        <span style={{ fontSize: 36 }}>{merchant.avatar || "🏪"}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#dde8f4", letterSpacing: -.3 }}>
            {merchant.business_name}
          </div>
          <div style={{ fontSize: 9, color: "#9C9C9C", marginTop: 2 }}>
            {[merchant.first_name, merchant.middle_name, merchant.last_name].filter(Boolean).join(" ")}
            {merchant.phone_number && <span> · {merchant.phone_number}</span>}
            {merchant.paybill && <span> · PB {merchant.paybill}</span>}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <span style={{
              background: tier.bg, border: `1px solid ${tier.border}`,
              color: tier.color, fontSize: 8, fontWeight: 800, padding: "2px 8px",
              borderRadius: 100, letterSpacing: 1,
            }}>{tier.label}</span>
            {merchant.county && <span style={{ background: "#040b10", border: "1px solid #0e1922", color: "#9C9C9C", fontSize: 8, padding: "2px 8px", borderRadius: 100 }}>{merchant.county}</span>}
            {merchant.network_type && <span style={{ background: "#040b10", border: "1px solid #0e1922", color: "#9C9C9C", fontSize: 8, padding: "2px 8px", borderRadius: 100 }}>{merchant.network_type}</span>}
            {merchant.source && <span style={{ background: "#040b10", border: "1px solid #0e1922", color: "#9C9C9C", fontSize: 8, padding: "2px 8px", borderRadius: 100 }}>src:{merchant.source}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          <button onClick={onRefresh} style={S.btnGhost} title="Refresh">↺</button>
          {confirmDelete ? (
  <>
    <button onClick={doDelete} disabled={deleting}
      style={{ ...S.btnDanger, opacity: deleting ? .5 : 1 }}>
      {deleting ? "…" : "Confirm"}
    </button>
    <button onClick={() => setConfirmDelete(false)} style={S.btnGhost}>
      Cancel
    </button>
  </>
) : (
  <button onClick={() => setConfirmDelete(true)} style={S.btnDanger}>
    Delete
  </button>
)}
        </div>
      </div>

      {/* Health bar */}
      <HealthBar merchant={merchant} />

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 12, flexWrap: "wrap" }}>
        {sections.map(s => (
          <button key={s} onClick={() => { setActiveSection(s); if (s === "profile") loadProfile(); }}
            style={{
              background: activeSection === s ? "rgba(0,200,83,.1)" : "#040b10",
              border: `1px solid ${activeSection === s ? "rgba(0,200,83,.3)" : "#0e1922"}`,
              color: activeSection === s ? "#4ade80" : "#9C9C9C",
              borderRadius: 4, padding: "4px 9px", cursor: "pointer",
              fontFamily: "inherit", fontSize: 9, textTransform: "capitalize",
              transition: "all .15s",
            }}>
            {s}
          </button>
        ))}
      </div>

      {/* Section content */}
      {activeSection === "sensors" && <SensorGrid merchant={merchant} />}
      {activeSection !== "sensors" && FIELD_GROUPS[activeSection] && (
        <FieldGroup
          title={FIELD_GROUPS[activeSection].label}
          fields={FIELD_GROUPS[activeSection].fields}
          merchant={merchant}
        />
      )}

      {/* Raw JSON toggle */}
      <details style={{ marginTop: 12 }}>
        <summary style={{ fontSize: 8, color: "#9C9C9C", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase", userSelect: "none" }}>
          Raw JSON
        </summary>
        <pre style={{
          background: "#030810", border: "1px solid #0e1922", borderRadius: 6,
          padding: 10, fontSize: 9, color: "#9C9C9C", overflow: "auto",
          maxHeight: 240, marginTop: 6, whiteSpace: "pre-wrap",
        }}>
          {JSON.stringify(merchant, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// ─── FLEET STATS BAR ──────────────────────────────────────────────────────────
function FleetStats({ merchants }) {
  const total    = merchants.length;
  const active   = merchants.filter(m => m.account_status === "active").length;
  const critical = merchants.filter(m => getRiskTier(m).label === "CRITICAL").length;
  const healthy  = merchants.filter(m => getRiskTier(m).label === "HEALTHY").length;

  return (
    <div style={{ display: "flex", gap: 12, padding: "6px 18px", borderBottom: "1px solid #0e1922", background: "#040b10", flexShrink: 0 }}>
      {[
        { label: "Total",    v: total,    color: "#8ca4bc" },
        { label: "Healthy",  v: healthy,  color: "#4ade80" },
        { label: "Critical", v: critical, color: "#f87171" },
        { label: "Active",   v: active,   color: "#60a5fa" },
      ].map(({ label, v, color }) => (
        <div key={label} style={{ display: "flex", gap: 5, alignItems: "baseline" }}>
          <span style={{ fontSize: 13, fontWeight: 800, color }}>{v}</span>
          <span style={{ fontSize: 8, color: "#9C9C9C", textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function MerchantDataModelViewer() {
  const [merchants, setMerchants]   = useState([]);
  const [selected,  setSelected]    = useState(null);
  const [loading,   setLoading]     = useState(true);
  const [apiOnline, setApiOnline]   = useState(null);
  const [activeTab, setActiveTab]   = useState("browse"); // browse | generate | add | upload
  const [search,    setSearch]      = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [toasts,    setToasts]      = useState([]);

  // toast helper
  const toast = useCallback((msg, type = "success") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  // load merchants from backend
  const loadMerchants = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("account_status", filterStatus);
      const data = await api.get(`/merchants${params.toString() ? "?" + params : ""}`);
      setMerchants(Array.isArray(data) ? data : []);
      setApiOnline(true);
    } catch {
      setApiOnline(false);
      setMerchants([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { loadMerchants(); }, [loadMerchants]);

  // filter merchants by search
  const filtered = merchants.filter(m => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (m.business_name || "").toLowerCase().includes(q) ||
      (m.first_name    || "").toLowerCase().includes(q) ||
      (m.last_name     || "").toLowerCase().includes(q) ||
      (m.paybill       || "").includes(q) ||
      (m.phone_number  || "").includes(q) ||
      (m.county        || "").toLowerCase().includes(q)
    );
  });

  const handleDelete = (id) => {
    setMerchants(prev => prev.filter(m => m.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const tabs = [
    { id: "browse",   label: "Browse",   icon: "◈" },
    { id: "generate", label: "Generate", icon: "⚡" },
    { id: "add",      label: "Add",      icon: "+" },
    { id: "upload",   label: "Upload",   icon: "↑" },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input:focus, select:focus { border-color: rgba(0,200,83,.4) !important; box-shadow: 0 0 0 2px rgba(0,200,83,.08); }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #04080d; }
        ::-webkit-scrollbar-thumb { background: #0e1922; border-radius: 2px; }
        @keyframes toastIn { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }
        @keyframes fadeIn  { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .merchant-card-hover:hover { background: rgba(0,200,83,.04) !important; border-color: rgba(0,200,83,.15) !important; }
        details > summary { list-style: none; }
        details > summary::-webkit-details-marker { display: none; }
      `}</style>

      <div style={S.root}>

        {/* ── HEADER */}
        <div style={S.header}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#dde8f4", letterSpacing: -.3 }}>
              <span style={{ color: "#00c853" }}>⬡</span> Merchant Data Model
            </div>
            <div style={{ fontSize: 8, color: "#9C9C9C", letterSpacing: 1, marginTop: 2 }}>
              /api/v1/merchants · {BASE}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Filter */}
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ ...S.input, width: "auto", fontSize: 9 }}>
              <option value="all">all status</option>
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="frozen">frozen</option>
            </select>

            <button onClick={loadMerchants} style={{ ...S.btnGhost, fontSize: 9 }}>
              ↺ Refresh
            </button>

            {/* API status */}
            <div style={{
              display: "flex", alignItems: "center", gap: 5, fontSize: 8,
              background: "#040b10", border: "1px solid #0e1922", borderRadius: 5,
              padding: "4px 9px",
            }}>
              <div style={{
                width: 5, height: 5, borderRadius: "50%",
                background: apiOnline === null ? "#9C9C9C" : apiOnline ? "#4ade80" : "#f87171",
                boxShadow: apiOnline ? "0 0 6px #4ade8080" : "none",
              }} />
              <span style={{ color: apiOnline === null ? "#9C9C9C" : apiOnline ? "#4ade80" : "#f87171" }}>
                {apiOnline === null ? "checking" : apiOnline ? `:4000 live · ${merchants.length} merchants` : "API offline"}
              </span>
            </div>
          </div>
        </div>

        {/* ── TABS */}
        <div style={S.tabBar}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
              padding: "8px 14px", fontSize: 10, fontWeight: 700,
              borderBottom: activeTab === t.id ? "2px solid #00c853" : "2px solid transparent",
              color: activeTab === t.id ? "#dde8f4" : "#C6C6C6",
              letterSpacing: .5, transition: "color .15s",
            }}>
              <span style={{ marginRight: 4 }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {/* ── OFFLINE BANNER */}
        {apiOnline === false && (
          <div style={{
            background: "rgba(239,68,68,.07)", border: "none",
            borderBottom: "1px solid rgba(239,68,68,.2)", padding: "8px 18px",
            fontSize: 9, color: "#f87171", letterSpacing: .3,
          }}>
            ⚠ Cannot reach {BASE} — start the backend: <code style={{ color: "#fbbf24" }}>npm run dev</code> in merchant-twin-backend/
          </div>
        )}

        {/* ── BROWSE TAB */}
        {activeTab === "browse" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <FleetStats merchants={merchants} />
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              {/* Sidebar */}
              <div style={S.sidebar}>
                {/* Search */}
                <div style={{ padding: "8px 8px 4px" }}>
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search merchants…"
                    style={{ ...S.input, fontSize: 9 }}
                  />
                </div>

                {/* Count */}
                <div style={{ padding: "3px 10px 5px", fontSize: 8, color: "#9C9C9C", letterSpacing: 1 }}>
                  {filtered.length} merchant{filtered.length !== 1 ? "s" : ""}
                  {search && ` matching "${search}"`}
                </div>

                {/* Merchant list */}
                <div style={{ flex: 1, overflowY: "auto", padding: "0 4px 8px" }}>
                  {loading ? (
                    <div style={{ color: "#9C9C9C", fontSize: 9, textAlign: "center", marginTop: 30 }}>
                      Loading…
                    </div>
                  ) : filtered.length === 0 ? (
                    <div style={{ color: "#9C9C9C", fontSize: 9, textAlign: "center", marginTop: 30, lineHeight: 1.8 }}>
                      {merchants.length === 0 ? (
                        <>No merchants yet.<br/>Generate or add one.</>
                      ) : (
                        "No matches."
                      )}
                    </div>
                  ) : (
                    filtered.map(m => (
                      <MerchantCard
                        key={m.id}
                        merchant={m}
                        selected={selected?.id === m.id}
                        onClick={() => setSelected(m)}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Detail pane */}
              <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                {!selected ? (
                  <div style={{ textAlign: "center", color: "#9C9C9C", marginTop: 60, lineHeight: 2 }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>◈</div>
                    <div style={{ fontSize: 10, letterSpacing: 1 }}>Select a merchant to inspect</div>
                    <div style={{ fontSize: 9, marginTop: 4 }}>
                      {merchants.length > 0 ? `${merchants.length} merchants loaded from API` : "No merchants yet"}
                    </div>
                  </div>
                ) : (
                  <MerchantDetail
                    key={selected.id}
                    merchant={selected}
                    onDelete={handleDelete}
                    onRefresh={() => {
                      api.get(`/merchants/${selected.id}`)
                        .then(m => {
                          setSelected(m);
                          setMerchants(prev => prev.map(x => x.id === m.id ? m : x));
                        })
                        .catch(() => toast("Refresh failed", "error"));
                    }}
                    toast={toast}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── GENERATE TAB */}
        {activeTab === "generate" && (
          <div style={{ flex: 1, overflow: "auto", padding: 16, maxWidth: 700 }}>
            <GeneratePanel onGenerated={() => { loadMerchants(); setActiveTab("browse"); }} toast={toast} />
          </div>
        )}

        {/* ── ADD TAB */}
        {activeTab === "add" && (
          <div style={{ flex: 1, overflow: "auto", padding: 16, maxWidth: 700 }}>
            <ManualAddPanel onAdded={() => { loadMerchants(); setActiveTab("browse"); }} toast={toast} />
          </div>
        )}

        {/* ── UPLOAD TAB */}
        {activeTab === "upload" && (
          <div style={{ flex: 1, overflow: "auto", padding: 16, maxWidth: 700 }}>
            <UploadPanel onUploaded={() => { loadMerchants(); setActiveTab("browse"); }} toast={toast} />
          </div>
        )}

        <Toast toasts={toasts} />
      </div>
    </>
  );
}