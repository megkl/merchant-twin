// UploadPanel.jsx (Redesigned)
// File Upload · Manual Entry · Upload History · CSV Templates
// API wired: POST /api/v1/upload/:type, GET /uploads, POST /merchants/generate

import { useState, useRef, useCallback } from "react";
import api from "./api/client";
import { useMerchantGenerator } from "./hooks/useApi";

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Nunito:wght@400;600;700;800;900&display=swap');
  @keyframes fadeUp   { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
  @keyframes popIn    { 0% { transform:scale(0.9); opacity:0 } 80% { transform:scale(1.03) } 100% { transform:scale(1); opacity:1 } }
  @keyframes spin     { to { transform:rotate(360deg) } }
  @keyframes pulse    { 0%,100%{opacity:0.5}50%{opacity:1} }
  @keyframes dropGlow { 0%,100%{border-color:rgba(99,102,241,0.3)}50%{border-color:rgba(99,102,241,0.8);box-shadow:0 0 30px rgba(99,102,241,0.2)} }
  @keyframes progress { from{width:0} to{width:100%} }
  @keyframes slideIn  { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
  .upload-type { transition: all 0.15s; cursor:pointer; }
  .upload-type:hover { transform:translateY(-2px); }
  .field-input { background:#0d1117; border:1px solid #1e2730; border-radius:6px; padding:6px 9px; color:#e2e8f0; font-size:10px; font-family:'Nunito',sans-serif; width:100%; box-sizing:border-box; outline:none; transition:border-color 0.15s; }
  .field-input:focus { border-color:rgba(99,102,241,0.5); }
`;

const UPLOAD_TYPES = [
  { id:"merchants", label:"Merchants",     icon:"🏪", color:"#00a651", desc:"Full merchant records. Auto-maps 50+ column variants." },
  { id:"behaviours",label:"Behaviours",    icon:"📊", color:"#6366f1", desc:"Update demographics: network, literacy, channel." },
  { id:"rules",     label:"Rules / Demand",icon:"⚙️", color:"#f97316", desc:"Update rule demand totals and enable/disable flags." },
];

const MANUAL_DEFAULTS = {
  first_name:"", last_name:"", business_name:"", phone_number:"",
  county:"", paybill:"", bank:"", balance:"",
  account_status:"active", kyc_status:"verified", kyc_age_days:"0",
  sim_status:"active", pin_attempts:"0", pin_locked:false,
  start_key_status:"valid", dormant_days:"0", notifications_enabled:true,
  settlement_on_hold:false, network_type:"4G", customer_type:"existing",
  literacy_tier:"literate", transaction_tier:"medium",
  transaction_count_30d:"0", preferred_channel:"app", avatar:"🏪",
};

const AVATARS = ["🏪","🏬","🛒","🍎","🥩","🧃","🍕","🚗","💊","🌿","☕","🎭","🛍️","🏠","🎓","💈"];

function DropZone({ onFile, loading, accept = ".csv,.xlsx,.xls,.json", type }) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState(null);
  const inputRef = useRef();

  const handleFile = (f) => { setFileName(f.name); onFile(f); };
  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  return (
    <div
      onClick={() => !loading && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${dragging ? type.color : "#1e2730"}`,
        borderRadius: 14,
        padding: "32px 20px",
        textAlign: "center",
        cursor: loading ? "not-allowed" : "pointer",
        background: dragging ? `${type.color}08` : "#0a0e14",
        transition: "all 0.2s",
        animation: dragging ? "dropGlow 1s infinite" : "none",
      }}>
      <input ref={inputRef} type="file" accept={accept} style={{ display:"none" }} onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); }} />

      {loading ? (
        <div>
          <div style={{ width:28, height:28, border:`3px solid ${type.color}33`, borderTop:`3px solid ${type.color}`, borderRadius:"50%", animation:"spin 0.8s linear infinite", margin:"0 auto 10px" }} />
          <div style={{ fontSize:11, color:type.color, fontWeight:700 }}>Processing {fileName}...</div>
          <div style={{ width:"60%", margin:"8px auto 0", background:"#161b22", borderRadius:3, height:4, overflow:"hidden" }}>
            <div style={{ height:"100%", background:type.color, animation:"progress 2s linear infinite", borderRadius:3 }} />
          </div>
        </div>
      ) : fileName ? (
        <div>
          <div style={{ fontSize:28, marginBottom:8 }}>✅</div>
          <div style={{ fontSize:11, fontWeight:700, color:type.color }}>{fileName}</div>
          <div style={{ fontSize:9, color:"#4b5563", marginTop:4 }}>Click to upload another</div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize:36, marginBottom:10 }}>{type.icon}</div>
          <div style={{ fontSize:13, fontWeight:800, color:"#e2e8f0", marginBottom:4 }}>Drop your {type.label} file here</div>
          <div style={{ fontSize:9, color:"#4b5563", marginBottom:10 }}>{type.desc}</div>
          <div style={{ display:"flex", gap:4, justifyContent:"center" }}>
            {[".csv",".xlsx",".json"].map(ext => (
              <span key={ext} style={{ fontSize:8, background:"#161b22", color:"#4b5563", padding:"2px 7px", borderRadius:4, fontFamily:"'JetBrains Mono',monospace" }}>{ext}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ManualForm({ onSuccess }) {
  const [form, setForm]     = useState({ ...MANUAL_DEFAULTS });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState(null);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async () => {
    if (!form.business_name || !form.paybill) { setError("Business name and paybill are required"); return; }
    setLoading(true); setError(null);
    try {
      // 🔌 API CALL → POST /api/v1/merchants
      await api.merchants.create(form);
      setSuccess(true);
      setForm({ ...MANUAL_DEFAULTS });
      onSuccess?.();
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  const fields = [
    [["first_name","First Name","text"],["last_name","Last Name","text"]],
    [["business_name","Business Name *","text",true],["paybill","Paybill *","text",true]],
    [["phone_number","Phone Number","text"],["county","County","text"]],
    [["bank","Bank","text"],["balance","Balance (KES)","number"]],
  ];

  const selects = [
    { key:"account_status", label:"Account Status", options:["active","suspended","frozen","dormant"] },
    { key:"kyc_status",     label:"KYC Status",     options:["verified","pending","expired","rejected"] },
    { key:"network_type",   label:"Network",        options:["2G","3G","4G","5G"] },
    { key:"customer_type",  label:"Customer Type",  options:["existing","new","dormant"] },
    { key:"literacy_tier",  label:"Literacy",       options:["literate","semi-literate","illiterate"] },
    { key:"preferred_channel", label:"Channel",     options:["app","ussd","web"] },
  ];

  return (
    <div style={{ animation:"fadeUp 0.2s" }}>
      {/* Avatar picker */}
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:9, color:"#374151", fontWeight:700, letterSpacing:0.5, marginBottom:6 }}>AVATAR</div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {AVATARS.map(a => (
            <button key={a} onClick={() => set("avatar", a)} style={{
              fontSize:20, background: form.avatar === a ? "rgba(99,102,241,0.15)" : "#0d1117",
              border: form.avatar === a ? "2px solid #6366f1" : "1px solid #1e2730",
              borderRadius:8, padding:"5px 6px", cursor:"pointer",
            }}>{a}</button>
          ))}
        </div>
      </div>

      {/* Text fields */}
      {fields.map((row, ri) => (
        <div key={ri} style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
          {row.map(([key, label, type, required]) => (
            <div key={key}>
              <div style={{ fontSize:8, color: required ? "#fbbf24" : "#374151", fontWeight:700, marginBottom:3 }}>{label}</div>
              <input className="field-input" type={type} value={form[key]} onChange={e => set(key, e.target.value)} placeholder={label} />
            </div>
          ))}
        </div>
      ))}

      {/* Select fields */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:12 }}>
        {selects.map(s => (
          <div key={s.key}>
            <div style={{ fontSize:8, color:"#374151", fontWeight:700, marginBottom:3 }}>{s.label}</div>
            <select value={form[s.key]} onChange={e => set(s.key, e.target.value)} className="field-input">
              {s.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        ))}
      </div>

      {/* Toggles */}
      <div style={{ display:"flex", gap:10, marginBottom:14 }}>
        {[["pin_locked","PIN Locked"],["notifications_enabled","Notifications On"],["settlement_on_hold","Settlement Hold"]].map(([k,label]) => (
          <label key={k} style={{ display:"flex", gap:5, alignItems:"center", cursor:"pointer" }}>
            <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} style={{ accentColor:"#6366f1" }} />
            <span style={{ fontSize:9, color:"#6b7280" }}>{label}</span>
          </label>
        ))}
      </div>

      {error && <div style={{ fontSize:9, color:"#ef4444", background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:8, padding:"8px 12px", marginBottom:10 }}>{error}</div>}
      {success && <div style={{ fontSize:9, color:"#4ade80", background:"rgba(74,222,128,0.06)", border:"1px solid rgba(74,222,128,0.2)", borderRadius:8, padding:"8px 12px", marginBottom:10, animation:"popIn 0.2s" }}>✅ Merchant added successfully!</div>}

      <button onClick={handleSubmit} disabled={loading} style={{
        width:"100%", background:"linear-gradient(135deg,#6366f1,#4f46e5)",
        border:"none", borderRadius:10, padding:"12px",
        color:"white", fontWeight:800, fontSize:12, cursor:"pointer",
        fontFamily:"'Nunito',sans-serif",
        display:"flex", alignItems:"center", justifyContent:"center", gap:8,
        opacity: loading ? 0.7 : 1,
      }}>
        {loading ? <><span style={{ width:14, height:14, border:"2px solid rgba(255,255,255,0.3)", borderTop:"2px solid white", borderRadius:"50%", animation:"spin 0.7s linear infinite", display:"inline-block" }} /> Adding...</> : "➕ Add Merchant"}
      </button>
    </div>
  );
}

export default function UploadPanel() {
  const [uploadType,   setUploadType]   = useState("merchants");
  const [mode,         setMode]         = useState("upload"); // upload | manual | history | generate
  const [loading,      setLoading]      = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error,        setError]        = useState(null);
  const [history,      setHistory]      = useState([]);
  const [genCount,     setGenCount]     = useState(5);
  const [genResult,    setGenResult]    = useState(null);
  const { generate, loading: genLoading } = useMerchantGenerator();

  const selectedType = UPLOAD_TYPES.find(t => t.id === uploadType);

  const handleFile = async (file) => {
    setLoading(true); setUploadResult(null); setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      // 🔌 API CALL → POST /api/v1/upload/:type
      const res = await fetch(`http://localhost:4000/api/v1/upload/${uploadType}`, { method:"POST", body:formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUploadResult(data);
      setHistory(prev => [{ file:file.name, type:uploadType, result:data, ts:new Date().toLocaleTimeString() }, ...prev.slice(0,9)]);
    } catch (e) {
      setError(`Upload failed: ${e.message}. Make sure backend is running.`);
    } finally { setLoading(false); }
  };

  const handleGenerate = async () => {
    // 🔌 API CALL → POST /api/v1/merchants/generate
    const result = await generate(genCount);
    setGenResult(result);
  };

  const downloadTemplate = (type) => {
    // 🔌 API CALL → GET /api/v1/upload/:type/template
    window.open(`http://localhost:4000/api/v1/upload/${type}/template`, "_blank");
  };

  const MODES = [
    { id:"upload",   label:"⬆ Upload File",  },
    { id:"manual",   label:"✍ Manual Entry", },
    { id:"generate", label:"⚡ Generate",     },
    { id:"history",  label:"📋 History",      },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#060a0f", color:"#e2e8f0", fontFamily:"'Nunito',sans-serif" }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ background:"#080b10", borderBottom:"1px solid #1e2730", padding:"10px 18px", display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ background:"linear-gradient(135deg,#6366f1,#4f46e5)", borderRadius:8, padding:"5px 9px", fontSize:13 }}>📤</div>
        <div>
          <div style={{ fontWeight:800, fontSize:13 }}>Upload & Manage Data</div>
          <div style={{ fontSize:8, color:"#374151" }}>CSV · Excel · JSON · Manual entry · Generator · POST /api/v1/upload/:type</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:4 }}>
          {MODES.map(m => (
            <button key={m.id} onClick={() => { setMode(m.id); setUploadResult(null); setError(null); }} style={{
              background: mode===m.id ? "rgba(99,102,241,0.12)" : "transparent",
              border:"none", borderBottom: mode===m.id ? "2px solid #6366f1" : "2px solid transparent",
              color: mode===m.id ? "#e2e8f0" : "#4b5563",
              padding:"4px 12px", cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"'Nunito',sans-serif",
            }}>{m.label}</button>
          ))}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"20px" }}>

        {/* Upload mode */}
        {mode === "upload" && (
          <div style={{ maxWidth:560, animation:"fadeUp 0.2s" }}>
            {/* Type selector */}
            <div style={{ display:"flex", gap:8, marginBottom:16 }}>
              {UPLOAD_TYPES.map(t => (
                <button key={t.id} className="upload-type" onClick={() => setUploadType(t.id)} style={{
                  flex:1, background: uploadType===t.id ? `${t.color}12` : "#0d1117",
                  border:`1px solid ${uploadType===t.id ? t.color : "#1e2730"}`,
                  borderRadius:10, padding:"10px 12px", cursor:"pointer", textAlign:"left",
                }}>
                  <div style={{ fontSize:18, marginBottom:4 }}>{t.icon}</div>
                  <div style={{ fontSize:10, fontWeight:800, color: uploadType===t.id ? t.color : "#e2e8f0" }}>{t.label}</div>
                  <div style={{ fontSize:8, color:"#4b5563", marginTop:2, lineHeight:1.4 }}>{t.desc}</div>
                </button>
              ))}
            </div>

            <DropZone onFile={handleFile} loading={loading} type={selectedType} />

            {/* Template download */}
            <button onClick={() => downloadTemplate(uploadType)} style={{
              width:"100%", marginTop:8, background:"transparent",
              border:"1px solid #1e2730", borderRadius:8, padding:"8px",
              color:"#4b5563", fontSize:9, cursor:"pointer", fontFamily:"'Nunito',sans-serif",
            }}>
              ⬇ Download {selectedType.label} CSV Template
              <span style={{ marginLeft:6, fontSize:7, color:"#1e2730", fontFamily:"'JetBrains Mono',monospace" }}>GET /upload/{uploadType}/template</span>
            </button>

            {/* Error */}
            {error && (
              <div style={{ marginTop:10, background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:10, padding:"12px", animation:"popIn 0.2s" }}>
                <div style={{ fontSize:10, color:"#ef4444", fontWeight:700 }}>Upload Failed</div>
                <div style={{ fontSize:9, color:"#94a3b8", marginTop:4 }}>{error}</div>
              </div>
            )}

            {/* Success result */}
            {uploadResult && !error && (
              <div style={{ marginTop:10, background:"rgba(74,222,128,0.06)", border:"1px solid rgba(74,222,128,0.2)", borderRadius:10, padding:"14px", animation:"popIn 0.2s" }}>
                <div style={{ fontWeight:800, fontSize:12, color:"#4ade80", marginBottom:10 }}>✅ Upload Successful</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                  {[
                    { label:"Processed", value:uploadResult.processed || uploadResult.total || "—", color:"#4ade80" },
                    { label:"Errors",    value:uploadResult.errors || 0,                             color: (uploadResult.errors||0) > 0 ? "#f87171" : "#374151" },
                    { label:"Type",      value:uploadType,                                           color:"#6366f1" },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign:"center", background:"#161b22", borderRadius:8, padding:"10px" }}>
                      <div style={{ fontSize:18, fontWeight:900, color:s.color }}>{s.value}</div>
                      <div style={{ fontSize:8, color:"#374151", marginTop:2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                {uploadResult.parseErrors?.length > 0 && (
                  <div style={{ marginTop:8 }}>
                    <div style={{ fontSize:8, color:"#f97316", fontWeight:700, marginBottom:4 }}>PARSE ERRORS</div>
                    {uploadResult.parseErrors.slice(0,3).map((e,i) => (
                      <div key={i} style={{ fontSize:8, color:"#6b7280", fontFamily:"'JetBrains Mono',monospace" }}>Row {e.row}: {e.message}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Manual entry mode */}
        {mode === "manual" && (
          <div style={{ maxWidth:540 }}>
            <div style={{ fontWeight:800, fontSize:13, marginBottom:14 }}>Add Merchant Manually</div>
            <ManualForm onSuccess={() => {}} />
          </div>
        )}

        {/* Generator mode */}
        {mode === "generate" && (
          <div style={{ maxWidth:480, animation:"fadeUp 0.2s" }}>
            <div style={{ fontWeight:800, fontSize:13, marginBottom:14 }}>Generate Random Merchants</div>

            <div style={{ background:"#0d1117", border:"1px solid #1e2730", borderRadius:12, padding:"20px", marginBottom:14 }}>
              <div style={{ fontSize:9, color:"#374151", fontWeight:700, letterSpacing:0.5, marginBottom:12 }}>HOW MANY?</div>
              <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:16 }}>
                <input type="range" min={1} max={100} value={genCount} onChange={e => setGenCount(+e.target.value)} style={{ flex:1, accentColor:"#6366f1" }} />
                <div style={{ fontSize:28, fontWeight:900, color:"#6366f1", fontFamily:"'JetBrains Mono',monospace", minWidth:50, textAlign:"center" }}>{genCount}</div>
              </div>
              <div style={{ display:"flex", gap:4, marginBottom:16 }}>
                {[1,5,10,25,50,100].map(n => (
                  <button key={n} onClick={() => setGenCount(n)} style={{
                    flex:1, background: genCount===n ? "rgba(99,102,241,0.15)" : "#161b22",
                    border:`1px solid ${genCount===n ? "#6366f1" : "#1e2730"}`,
                    color: genCount===n ? "#818cf8" : "#4b5563",
                    borderRadius:6, padding:"5px 3px", cursor:"pointer", fontSize:9, fontWeight:700, fontFamily:"'JetBrains Mono',monospace",
                  }}>{n}</button>
                ))}
              </div>
              <button onClick={handleGenerate} disabled={genLoading} style={{
                width:"100%", background:"linear-gradient(135deg,#6366f1,#4f46e5)",
                border:"none", borderRadius:10, padding:"13px",
                color:"white", fontWeight:800, fontSize:13, cursor:"pointer",
                fontFamily:"'Nunito',sans-serif",
                display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                opacity: genLoading ? 0.7 : 1,
              }}>
                {genLoading ? (
                  <><span style={{ width:14, height:14, border:"2px solid rgba(255,255,255,0.3)", borderTop:"2px solid white", borderRadius:"50%", animation:"spin 0.7s linear infinite", display:"inline-block" }} /> Generating...</>
                ) : `⚡ Generate ${genCount} Merchant${genCount > 1 ? "s" : ""}`}
              </button>
              <div style={{ fontSize:8, color:"#374151", textAlign:"center", marginTop:6 }}>
                🔌 POST /api/v1/merchants/generate · Persisted to SQLite
              </div>
            </div>

            {genResult && (
              <div style={{ background:"rgba(74,222,128,0.06)", border:"1px solid rgba(74,222,128,0.2)", borderRadius:10, padding:"14px", animation:"popIn 0.2s" }}>
                <div style={{ fontWeight:800, fontSize:12, color:"#4ade80", marginBottom:8 }}>✅ Generated {genCount} merchants</div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {(genResult.merchants || []).slice(0,8).map((m,i) => (
                    <div key={i} style={{ background:"#161b22", borderRadius:6, padding:"5px 8px", display:"flex", gap:4, alignItems:"center" }}>
                      <span style={{ fontSize:14 }}>{m.avatar}</span>
                      <span style={{ fontSize:8, color:"#e2e8f0" }}>{m.business_name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* History mode */}
        {mode === "history" && (
          <div style={{ maxWidth:600, animation:"fadeUp 0.2s" }}>
            <div style={{ fontWeight:800, fontSize:13, marginBottom:14 }}>
              Upload History
              <button onClick={async () => {
                try {
                  // 🔌 API CALL → GET /api/v1/uploads
                  const data = await api.uploads?.list?.();
                  if (data) setHistory(data.map(u => ({ file:u.filename, type:u.type, result:{ processed:u.total_records }, ts:u.uploaded_at })));
                } catch {}
              }} style={{ marginLeft:10, fontSize:9, background:"rgba(99,102,241,0.1)", border:"1px solid rgba(99,102,241,0.3)", color:"#818cf8", borderRadius:6, padding:"3px 10px", cursor:"pointer", fontFamily:"'Nunito',sans-serif", fontWeight:700 }}>
                🔌 Refresh from API
              </button>
            </div>

            {history.length === 0 && (
              <div style={{ textAlign:"center", padding:"40px", background:"#0d1117", border:"1px solid #1e2730", borderRadius:12 }}>
                <div style={{ fontSize:28, marginBottom:8 }}>📭</div>
                <div style={{ fontSize:12, fontWeight:700, color:"#374151" }}>No uploads yet</div>
                <div style={{ fontSize:9, color:"#1e2730", marginTop:4 }}>Upload files or add merchants manually to see history</div>
              </div>
            )}

            {history.map((h, i) => {
              const t = UPLOAD_TYPES.find(u => u.id === h.type) || UPLOAD_TYPES[0];
              return (
                <div key={i} style={{ background:"#0d1117", border:"1px solid #1e2730", borderRadius:10, padding:"12px 14px", marginBottom:8, animation:"slideIn 0.15s" }}>
                  <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                    <span style={{ fontSize:22 }}>{t.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:11 }}>{h.file}</div>
                      <div style={{ fontSize:8, color:"#4b5563" }}>{t.label} · {h.ts}</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:14, fontWeight:800, color:t.color }}>{h.result?.processed || "—"}</div>
                      <div style={{ fontSize:7, color:"#374151" }}>records</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}