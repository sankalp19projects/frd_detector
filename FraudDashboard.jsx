import { useState, useEffect, useRef, useCallback } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line } from "recharts";

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_API = "http://localhost:8766";
const RISK_COLORS  = { CRITICAL:"#ff2d55", HIGH:"#ff6b2d", MEDIUM:"#ffd60a", LOW:"#30d158" };
const RISK_BG      = { CRITICAL:"rgba(255,45,85,0.12)", HIGH:"rgba(255,107,45,0.12)", MEDIUM:"rgba(255,214,10,0.10)", LOW:"rgba(48,209,88,0.10)" };
const FEATURE_DESC = {
  amount:"Amount",hour_of_day:"Hour of day",day_of_week:"Day of week",
  merchant_category:"Merchant category",distance_from_home:"Distance from home (km)",
  transaction_velocity_1h:"Txns last 1h",transaction_velocity_24h:"Txns last 24h",
  avg_amount_30d:"Avg spend 30d",amount_deviation:"Amount deviation",
  is_foreign:"Foreign txn",card_present:"Card present",recurring:"Recurring",
  high_risk_merchant:"High-risk merchant",account_age_days:"Account age (days)",
  failed_attempts_24h:"Failed attempts 24h",
};

const fmt$   = v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${Number(v).toFixed(0)}`;
const fmtPct = v => `${(Number(v)*100).toFixed(1)}%`;
const fmtTime = s => { try { return new Date(s).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}); } catch{ return s; }};

// ── Connection banner ──────────────────────────────────────────────────────────
function SetupBanner({ apiUrl, setApiUrl, status, onRetry }) {
  const [draft, setDraft] = useState(apiUrl);
  return (
    <div style={{background:"#0d1117",border:"1px solid #334155",borderRadius:6,padding:28,maxWidth:600,margin:"60px auto",fontFamily:"'IBM Plex Mono',monospace"}}>
      <div style={{fontSize:20,fontWeight:700,color:"#f87171",marginBottom:8}}>⚠ Backend Not Reachable</div>
      <div style={{fontSize:12,color:"#94a3b8",marginBottom:20,lineHeight:1.7}}>
        The dashboard calls your real backend API — no mock data.<br/>
        Start the server first, then retry.
      </div>

      <div style={{background:"#060912",border:"1px solid #1e293b",borderRadius:4,padding:16,marginBottom:20,fontSize:11,color:"#7dd3fc",lineHeight:1.8}}>
        <div style={{color:"#64748b",marginBottom:6}}># Start the backend server</div>
        <div>cd fraud-detection</div>
        <div>python backend/train_model.py &nbsp;&nbsp;<span style={{color:"#64748b"}}># if not done yet</span></div>
        <div>python backend/server.py</div>
        <div style={{color:"#64748b",marginTop:6}}># HTTP API → http://localhost:8766</div>
        <div style={{color:"#64748b"}}># WebSocket → ws://localhost:8765</div>
      </div>

      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,color:"#64748b",marginBottom:6}}>API BASE URL</div>
        <div style={{display:"flex",gap:8}}>
          <input value={draft} onChange={e=>setDraft(e.target.value)}
            style={{flex:1,background:"#060912",border:"1px solid #334155",color:"#e2e8f0",fontFamily:"inherit",fontSize:12,padding:"8px 10px",borderRadius:3,outline:"none"}}/>
          <button onClick={()=>{ setApiUrl(draft); onRetry(draft); }}
            style={{background:"#1d4ed8",border:"none",color:"#fff",fontFamily:"inherit",fontSize:11,padding:"8px 16px",borderRadius:3,cursor:"pointer"}}>
            Connect
          </button>
        </div>
      </div>

      <div style={{fontSize:10,color:"#475569"}}>
        Status: <span style={{color:"#f87171"}}>{status}</span>
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function FraudDashboard() {
  const [apiUrl, setApiUrl]         = useState(DEFAULT_API);
  const [connStatus, setConnStatus] = useState("connecting…"); // connecting | ok | error
  const [transactions, setTxns]     = useState([]);
  const [metrics, setMetrics]       = useState(null);
  const [featureInfo, setFeatureInfo] = useState(null);
  const [selected, setSelected]     = useState(null);
  const [tab, setTab]               = useState("stream");
  const [running, setRunning]       = useState(true);
  const [throughputData, setTputData] = useState([]);
  const [fraudRateData, setFRData]  = useState([]);
  const idxRef  = useRef(0);
  const timerRef = useRef(null);
  const urlRef  = useRef(apiUrl);
  urlRef.current = apiUrl;

  // ── API helpers ──────────────────────────────────────────────────────────────
  const apiFetch = useCallback(async (path, base = null) => {
    const res = await fetch(`${base || urlRef.current}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, []);

  // ── Initial connection check ──────────────────────────────────────────────────
  const connect = useCallback(async (base) => {
    setConnStatus("connecting…");
    try {
      await apiFetch("/health", base);
      setConnStatus("ok");
      // Also fetch feature info once
      try {
        const fi = await apiFetch("/feature-info", base);
        setFeatureInfo(fi);
      } catch(_) {}
    } catch(e) {
      setConnStatus(e.message || "unreachable");
    }
  }, [apiFetch]);

  useEffect(() => { connect(apiUrl); }, [apiUrl, connect]);

  // ── Polling loop ─────────────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      const data = await apiFetch(`/poll?since=${idxRef.current}`);
      const newTxns = data.transactions || [];
      if (newTxns.length) {
        idxRef.current = data.total_index;
        setTxns(prev => [...newTxns.reverse(), ...prev].slice(0, 300));
        if (connStatus !== "ok") setConnStatus("ok");
      }
      if (data.metrics) {
        setMetrics(data.metrics);
        const ts = fmtTime(new Date().toISOString());
        setTputData(p => [...p, { ts, value: data.metrics.total_processed || 0 }].slice(-30));
        setFRData(p => [...p, { ts, value: Math.round((data.metrics.fraud_rate || 0) * 1000) / 10 }].slice(-30));
      }
    } catch(e) {
      setConnStatus(e.message || "connection lost");
    }
  }, [apiFetch, connStatus]);

  useEffect(() => {
    if (connStatus !== "ok" || !running) {
      clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(poll, 700);
    return () => clearInterval(timerRef.current);
  }, [connStatus, running, poll]);

  // ── Not connected ────────────────────────────────────────────────────────────
  if (connStatus !== "ok" && transactions.length === 0) {
    return (
      <div style={{ minHeight:"100vh", background:"#060912" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap');`}</style>
        <SetupBanner apiUrl={apiUrl} setApiUrl={setApiUrl} status={connStatus} onRetry={connect} />
      </div>
    );
  }

  const fraudTxns = transactions.filter(t => t.is_fraud);
  const m = metrics || {};

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"#060912", fontFamily:"'IBM Plex Mono','Courier New',monospace", color:"#e2e8f0", overflowX:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#0d1117}
        ::-webkit-scrollbar-thumb{background:#2d3748;border-radius:2px}
        .txn-row:hover{background:rgba(255,255,255,0.04)!important;cursor:pointer}
        .tab-btn{background:none;border:none;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:.1em;padding:8px 16px;text-transform:uppercase;transition:all .15s}
        .ctrl-btn{background:none;border:1px solid #2d3748;cursor:pointer;font-family:inherit;font-size:11px;padding:5px 12px;color:#94a3b8;border-radius:3px}
        .ctrl-btn:hover{background:#1e293b;color:#e2e8f0}
        @keyframes fadeSlide{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .new-txn{animation:fadeSlide .25s ease-out}
        .live-dot{animation:pulse 1.2s ease-in-out infinite}
        .shap-bar{transition:width .4s ease}
      `}</style>

      {/* Header */}
      <div style={{borderBottom:"1px solid #1a2035",padding:"14px 28px",display:"flex",alignItems:"center",gap:16,background:"rgba(6,9,18,.95)",position:"sticky",top:0,zIndex:50}}>
        <div>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,color:"#fff"}}>
            SENTINEL<span style={{color:"#ff2d55"}}>//</span>FDP
          </div>
          <div style={{fontSize:9,color:"#475569",letterSpacing:".2em",marginTop:1}}>FRAUD DETECTION PIPELINE — LIVE BACKEND</div>
        </div>
        {/* Connection status */}
        <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:24,background:"#0d1117",border:"1px solid #1a2035",borderRadius:3,padding:"4px 10px"}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:connStatus==="ok"?"#30d158":"#f87171"}}
               className={connStatus==="ok"?"live-dot":""}/>
          <span style={{fontSize:9,color:connStatus==="ok"?"#30d158":"#f87171",letterSpacing:".1em"}}>
            {connStatus==="ok" ? apiUrl : connStatus}
          </span>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          <button className="ctrl-btn" onClick={()=>setRunning(r=>!r)}>{running?"⏸ PAUSE":"▶ RESUME"}</button>
          <button className="ctrl-btn" onClick={()=>connect(apiUrl)}>↻ RECONNECT</button>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:1,background:"#1a2035",borderBottom:"1px solid #1a2035"}}>
        {[
          {label:"PROCESSED",    value:(m.total_processed||0).toLocaleString(), sub:"total transactions"},
          {label:"FRAUD FLAGGED",value:(m.total_fraud||0).toLocaleString(),     sub:"alerts raised",          color:"#ff2d55"},
          {label:"FRAUD RATE",   value:fmtPct(m.fraud_rate||0),                 sub:"of stream",             color:(m.fraud_rate||0)>0.08?"#ff2d55":(m.fraud_rate||0)>0.05?"#ff6b2d":"#30d158"},
          {label:"VOLUME",       value:fmt$(m.total_amount||0),                  sub:"total streamed"},
          {label:"AT RISK",      value:fmt$(m.fraud_amount||0),                  sub:"fraud exposure",        color:"#ff6b2d"},
          {label:"AVG LATENCY",  value:`${m.avg_latency_ms||0}ms`,              sub:"inference time",        color:"#60a5fa"},
        ].map(k => (
          <div key={k.label} style={{background:"#060912",padding:"14px 20px"}}>
            <div style={{fontSize:9,color:"#475569",letterSpacing:".15em",marginBottom:4}}>{k.label}</div>
            <div style={{fontSize:22,fontWeight:600,color:k.color||"#e2e8f0",fontFamily:"'Syne',sans-serif"}}>{k.value}</div>
            <div style={{fontSize:9,color:"#334155",marginTop:2}}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{borderBottom:"1px solid #1a2035",padding:"0 20px",display:"flex",gap:4}}>
        {["stream","analytics","model","alerts"].map(t => (
          <button key={t} className="tab-btn" onClick={()=>setTab(t)}
            style={{color:tab===t?"#60a5fa":"#475569",borderBottom:tab===t?"1px solid #60a5fa":"1px solid transparent",marginBottom:-1}}>
            {t}
          </button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:12,fontSize:10,color:"#334155",padding:"0 4px"}}>
          {featureInfo && <span>AUC: {Number(featureInfo.auc).toFixed(4)}</span>}
          <span>WINDOW: {m.window_transactions||0} txns/min</span>
          <span>FRAUD RATE: {fmtPct(m.window_fraud_rate||0)}</span>
        </div>
      </div>

      {/* Content */}
      <div style={{padding:"20px 24px",display:"grid",gridTemplateColumns:selected&&tab==="stream"?"1fr 360px":"1fr",gap:16}}>

        {/* ── STREAM TAB ── */}
        {tab==="stream" && <>
          <div>
            {/* Sparklines */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              {[
                {title:"TRANSACTION VOLUME (CUMULATIVE)",data:throughputData,key:"value",color:"#60a5fa",grad:"tg"},
                {title:"FRAUD RATE % (ROLLING)",data:fraudRateData,key:"value",color:"#ff2d55",grad:"fg"},
              ].map(({title,data,key,color,grad})=>(
                <div key={title} style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,padding:"12px 16px"}}>
                  <div style={{fontSize:9,color:"#475569",letterSpacing:".15em",marginBottom:8}}>{title}</div>
                  <ResponsiveContainer width="100%" height={56}>
                    <AreaChart data={data}>
                      <defs><linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={.3}/><stop offset="95%" stopColor={color} stopOpacity={0}/>
                      </linearGradient></defs>
                      <Area type="monotone" dataKey={key} stroke={color} fill={`url(#${grad})`} strokeWidth={1.5} dot={false}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>

            {/* Transaction table */}
            <div style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"130px 80px 100px 1fr 80px 70px 80px 90px",padding:"8px 16px",borderBottom:"1px solid #1a2035",fontSize:9,color:"#334155",letterSpacing:".12em",textTransform:"uppercase"}}>
                <span>TXN ID</span><span>USER</span><span>TIME</span><span>MERCHANT</span><span>AMOUNT</span><span>COUNTRY</span><span>RISK</span><span>FRAUD PROB</span>
              </div>
              <div style={{maxHeight:"56vh",overflowY:"auto"}}>
                {transactions.length === 0 && (
                  <div style={{textAlign:"center",padding:40,color:"#334155",fontSize:12}}>
                    {connStatus==="ok" ? "Waiting for transactions from backend…" : `Backend: ${connStatus}`}
                  </div>
                )}
                {transactions.slice(0,100).map((t,i) => (
                  <div key={t.transaction_id} className={`txn-row${i===0?" new-txn":""}`}
                    onClick={()=>setSelected(selected?.transaction_id===t.transaction_id?null:t)}
                    style={{display:"grid",gridTemplateColumns:"130px 80px 100px 1fr 80px 70px 80px 90px",padding:"7px 16px",borderBottom:"1px solid #0d1520",fontSize:11,background:selected?.transaction_id===t.transaction_id?"rgba(96,165,250,.06)":t.is_fraud?"rgba(255,45,85,.04)":"transparent",transition:"background .1s"}}>
                    <span style={{color:"#60a5fa",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.transaction_id?.slice(0,13)}</span>
                    <span style={{color:"#94a3b8"}}>{t.user_id?.slice(0,8)}</span>
                    <span style={{color:"#475569",fontSize:10}}>{fmtTime(t.timestamp)}</span>
                    <span style={{color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.merchant_name}</span>
                    <span style={{color:"#e2e8f0",fontWeight:500}}>${Number(t.amount).toFixed(2)}</span>
                    <span style={{color:"#94a3b8"}}>{t.country}{t.is_foreign?"🌐":""}</span>
                    <span style={{color:RISK_COLORS[t.risk_level],background:RISK_BG[t.risk_level],padding:"1px 5px",borderRadius:2,fontSize:9,fontWeight:600}}>{t.risk_level}</span>
                    <div style={{display:"flex",alignItems:"center",gap:5}}>
                      <div style={{flex:1,height:3,background:"#1a2035",borderRadius:2}}>
                        <div style={{width:`${t.fraud_probability*100}%`,height:"100%",background:RISK_COLORS[t.risk_level],borderRadius:2}}/>
                      </div>
                      <span style={{fontSize:10,color:RISK_COLORS[t.risk_level],minWidth:34}}>{fmtPct(t.fraud_probability)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Detail panel */}
          {selected && (
            <div style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,padding:20,overflowY:"auto",maxHeight:"calc(100vh - 230px)",position:"sticky",top:220}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                <div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:13,fontWeight:800,color:"#fff"}}>{selected.transaction_id?.slice(0,18)}</div>
                  <div style={{fontSize:10,color:"#475569",marginTop:2}}>{selected.user_id} · {selected.merchant_name}</div>
                  <div style={{fontSize:9,color:"#334155",marginTop:1}}>{selected.card_network} · {selected.country}</div>
                </div>
                <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:16}}>✕</button>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                <div style={{background:"#060912",border:"1px solid #1a2035",borderRadius:3,padding:"10px 12px"}}>
                  <div style={{fontSize:9,color:"#475569",marginBottom:3}}>AMOUNT</div>
                  <div style={{fontSize:20,fontFamily:"'Syne',sans-serif",fontWeight:800}}>${Number(selected.amount).toFixed(2)}</div>
                </div>
                <div style={{background:RISK_BG[selected.risk_level],border:`1px solid ${RISK_COLORS[selected.risk_level]}44`,borderRadius:3,padding:"10px 12px"}}>
                  <div style={{fontSize:9,color:"#475569",marginBottom:3}}>FRAUD PROBABILITY</div>
                  <div style={{fontSize:20,fontFamily:"'Syne',sans-serif",fontWeight:800,color:RISK_COLORS[selected.risk_level]}}>{fmtPct(selected.fraud_probability)}</div>
                  <div style={{fontSize:9,color:RISK_COLORS[selected.risk_level],marginTop:2}}>{selected.risk_level}</div>
                </div>
              </div>

              {/* SHAP Waterfall — real data from backend */}
              <div style={{marginBottom:14}}>
                <div style={{fontSize:9,color:"#475569",letterSpacing:".15em",marginBottom:8}}>SHAP FEATURE ATTRIBUTION (BACKEND)</div>
                <div style={{fontSize:9,color:"#334155",marginBottom:8,display:"flex",justifyContent:"space-between"}}>
                  <span>baseline: {fmtPct(selected.shap_baseline||0)}</span>
                  <span>prediction: {fmtPct(selected.fraud_probability)}</span>
                </div>
                {(selected.top_factors||[]).slice(0,7).map(f => {
                  const pct = Math.min(100, Math.abs(f.shap) * 500);
                  const pos = f.shap > 0;
                  return (
                    <div key={f.feature} style={{marginBottom:6}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:2}}>
                        <span style={{color:"#94a3b8"}}>{FEATURE_DESC[f.feature]||f.feature}</span>
                        <span style={{color:pos?"#ff6b2d":"#30d158",fontWeight:500}}>{pos?"+":""}{Number(f.shap).toFixed(5)}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{flex:1,height:4,background:"#1a2035",borderRadius:2,overflow:"hidden"}}>
                          <div className="shap-bar" style={{width:`${pct}%`,height:"100%",borderRadius:2,background:pos?"linear-gradient(90deg,#ff6b2d,#ff2d55)":"linear-gradient(90deg,#30d158,#00c6a7)"}}/>
                        </div>
                        <span style={{fontSize:9,color:"#475569",minWidth:52,textAlign:"right"}}>val: {typeof f.value==="number"?Number(f.value).toFixed(2):f.value}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Raw features from backend */}
              <div>
                <div style={{fontSize:9,color:"#475569",letterSpacing:".15em",marginBottom:8}}>RAW FEATURES (FROM BACKEND)</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                  {Object.entries(selected.features||selected.model_features||{}).map(([k,v])=>(
                    <div key={k} style={{background:"#060912",padding:"4px 8px",borderRadius:2,display:"flex",justifyContent:"space-between",fontSize:9}}>
                      <span style={{color:"#334155",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:100}}>{k}</span>
                      <span style={{color:"#94a3b8",fontWeight:500}}>{typeof v==="number"?Number(v).toFixed(2):String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>}

        {/* ── ANALYTICS TAB ── */}
        {tab==="analytics" && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            {[
              {
                title:"RISK LEVEL DISTRIBUTION",
                chart: (
                  <BarChart data={["CRITICAL","HIGH","MEDIUM","LOW"].map(r=>({name:r,count:transactions.filter(t=>t.risk_level===r).length}))}>
                    <XAxis dataKey="name" tick={{fill:"#475569",fontSize:9}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fill:"#334155",fontSize:9}} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={{background:"#0d1117",border:"1px solid #1a2035",fontSize:10}} labelStyle={{color:"#94a3b8"}}/>
                    <Bar dataKey="count" radius={[2,2,0,0]}>{["CRITICAL","HIGH","MEDIUM","LOW"].map(r=><Cell key={r} fill={RISK_COLORS[r]}/>)}</Bar>
                  </BarChart>
                )
              },
              {
                title:"FRAUD PROBABILITY HISTOGRAM (BACKEND SCORES)",
                chart: (
                  <BarChart data={Array.from({length:10},(_,i)=>({bucket:`${i*10}–${(i+1)*10}%`,count:transactions.filter(t=>t.fraud_probability>=i*0.1&&t.fraud_probability<(i+1)*0.1).length}))}>
                    <XAxis dataKey="bucket" tick={{fill:"#334155",fontSize:7}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fill:"#334155",fontSize:9}} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={{background:"#0d1117",border:"1px solid #1a2035",fontSize:10}}/>
                    <Bar dataKey="count" radius={[2,2,0,0]}>{Array.from({length:10},(_,i)=><Cell key={i} fill={i>=8?"#ff2d55":i>=6?"#ff6b2d":i>=4?"#ffd60a":"#30d158"}/>)}</Bar>
                  </BarChart>
                )
              },
              {
                title:"FRAUD RATE BY MERCHANT CATEGORY",
                chart: (
                  <BarChart data={[0,1,2,3,4,5].map(cat=>({name:["Retail","Gas","Travel","Crypto","Remit","High-Risk"][cat],rate:Math.round(transactions.filter(t=>t.merchant_category===cat&&t.is_fraud).length/Math.max(transactions.filter(t=>t.merchant_category===cat).length,1)*100)}))}>
                    <XAxis dataKey="name" tick={{fill:"#475569",fontSize:8}} axisLine={false} tickLine={false}/>
                    <YAxis unit="%" tick={{fill:"#334155",fontSize:9}} axisLine={false} tickLine={false}/>
                    <Tooltip formatter={v=>`${v}%`} contentStyle={{background:"#0d1117",border:"1px solid #1a2035",fontSize:10}}/>
                    <Bar dataKey="rate" radius={[2,2,0,0]} fill="#ff6b2d"/>
                  </BarChart>
                )
              },
              {
                title:"AMOUNT DISTRIBUTION: LEGIT vs FRAUD",
                chart: (
                  <AreaChart data={Array.from({length:12},(_,i)=>({bucket:`$${Math.round(Math.exp(i*.5)*10)}`,legit:transactions.filter(t=>!t.is_fraud&&Math.log(Math.max(t.amount,1))>=i*.5&&Math.log(Math.max(t.amount,1))<(i+1)*.5).length,fraud:transactions.filter(t=>t.is_fraud&&Math.log(Math.max(t.amount,1))>=i*.5&&Math.log(Math.max(t.amount,1))<(i+1)*.5).length}))}>
                    <defs>
                      <linearGradient id="lg2" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#30d158" stopOpacity={.3}/><stop offset="1" stopColor="#30d158" stopOpacity={0}/></linearGradient>
                      <linearGradient id="fg2" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#ff2d55" stopOpacity={.3}/><stop offset="1" stopColor="#ff2d55" stopOpacity={0}/></linearGradient>
                    </defs>
                    <XAxis dataKey="bucket" tick={{fill:"#334155",fontSize:7}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fill:"#334155",fontSize:9}} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={{background:"#0d1117",border:"1px solid #1a2035",fontSize:10}}/>
                    <Area type="monotone" dataKey="legit" stroke="#30d158" fill="url(#lg2)" strokeWidth={1.5}/>
                    <Area type="monotone" dataKey="fraud" stroke="#ff2d55" fill="url(#fg2)" strokeWidth={1.5}/>
                  </AreaChart>
                )
              },
            ].map(({title,chart})=>(
              <div key={title} style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,padding:20}}>
                <div style={{fontSize:9,color:"#475569",letterSpacing:".15em",marginBottom:16}}>{title}</div>
                <ResponsiveContainer width="100%" height={200}>{chart}</ResponsiveContainer>
              </div>
            ))}
          </div>
        )}

        {/* ── MODEL TAB ── */}
        {tab==="model" && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <div style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,padding:20}}>
              <div style={{fontSize:9,color:"#475569",letterSpacing:".15em",marginBottom:4}}>GLOBAL FEATURE IMPORTANCES (FROM BACKEND)</div>
              <div style={{fontSize:9,color:"#334155",marginBottom:16}}>
                {featureInfo ? `AUC: ${Number(featureInfo.auc).toFixed(6)} · Threshold: ${featureInfo.threshold}` : "Loading from backend…"}
              </div>
              {featureInfo && featureInfo.features.map((f,i) => {
                const imp = featureInfo.importances[i];
                const maxImp = Math.max(...featureInfo.importances);
                return (
                  <div key={f} style={{marginBottom:7}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:2}}>
                      <span style={{color:"#94a3b8"}}>{featureInfo.feature_descriptions?.[f]||f}</span>
                      <span style={{color:"#60a5fa"}}>{(imp*100).toFixed(2)}%</span>
                    </div>
                    <div style={{height:3,background:"#1a2035",borderRadius:2}}>
                      <div style={{width:`${(imp/maxImp)*100}%`,height:"100%",background:"linear-gradient(90deg,#3b82f6,#60a5fa)",borderRadius:2}}/>
                    </div>
                  </div>
                );
              })}
              {!featureInfo && <div style={{color:"#475569",fontSize:11}}>Fetching /feature-info from backend…</div>}
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,padding:20}}>
                <div style={{fontSize:9,color:"#475569",letterSpacing:".15em",marginBottom:16}}>LIVE BACKEND METRICS</div>
                {[
                  ["Total Processed", (m.total_processed||0).toLocaleString()],
                  ["Total Fraud", (m.total_fraud||0).toLocaleString()],
                  ["Overall Fraud Rate", fmtPct(m.fraud_rate||0)],
                  ["Avg Inference Latency", `${m.avg_latency_ms||0}ms`],
                  ["Window Transactions (60s)", m.window_transactions||0],
                  ["Window Fraud Rate (60s)", fmtPct(m.window_fraud_rate||0)],
                  ["Window Avg Amount", fmt$(m.window_avg_amount||0)],
                  ["Amount at Risk (window)", fmt$(m.window_amount_at_risk||0)],
                  ["CRITICAL alerts", m.risk_distribution?.CRITICAL||0],
                  ["HIGH alerts", m.risk_distribution?.HIGH||0],
                  ["MEDIUM alerts", m.risk_distribution?.MEDIUM||0],
                  ["LOW (clean)", m.risk_distribution?.LOW||0],
                ].map(([k,v],i) => (
                  <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #0d1520",fontSize:10}}>
                    <span style={{color:"#475569"}}>{k}</span>
                    <span style={{color:"#94a3b8",fontWeight:500}}>{String(v)}</span>
                  </div>
                ))}
              </div>

              <div style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,padding:20}}>
                <div style={{fontSize:9,color:"#475569",letterSpacing:".15em",marginBottom:12}}>BACKEND API ENDPOINTS</div>
                {[
                  ["GET /health","Readiness probe"],
                  ["GET /metrics","Aggregate pipeline stats"],
                  ["GET /transactions","History (limit, fraud_only params)"],
                  ["GET /feature-info","Feature names + importances"],
                  ["GET /poll?since=N","Polling stream (used by this UI)"],
                  ["POST /score","Manual transaction scoring"],
                ].map(([ep,desc])=>(
                  <div key={ep} style={{marginBottom:8}}>
                    <div style={{fontSize:10,color:"#7dd3fc",fontWeight:600}}>{ep}</div>
                    <div style={{fontSize:9,color:"#475569"}}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── ALERTS TAB ── */}
        {tab==="alerts" && (
          <div>
            <div style={{marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:9,color:"#475569",letterSpacing:".15em"}}>FRAUD ALERTS — FLAGGED BY BACKEND ML MODEL</div>
              <div style={{fontSize:10,color:"#ff2d55"}}>{fraudTxns.length} flagged</div>
            </div>
            {fraudTxns.length===0 && (
              <div style={{textAlign:"center",padding:60,color:"#334155",fontSize:12}}>
                {connStatus==="ok" ? "No fraud detected yet in this session." : `Backend: ${connStatus}`}
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
              {fraudTxns.slice(0,30).map(t=>(
                <div key={t.transaction_id} onClick={()=>{setSelected(t);setTab("stream");}}
                  style={{background:"#0d1117",border:`1px solid ${RISK_COLORS[t.risk_level]}44`,borderRadius:4,padding:16,cursor:"pointer"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <span style={{color:"#60a5fa",fontSize:10,fontWeight:600}}>{t.transaction_id?.slice(0,16)}</span>
                    <span style={{background:RISK_BG[t.risk_level],color:RISK_COLORS[t.risk_level],fontSize:9,padding:"2px 8px",borderRadius:2,fontWeight:700}}>{t.risk_level}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div>
                      <div style={{fontSize:18,fontFamily:"'Syne',sans-serif",fontWeight:800,color:"#fff"}}>${Number(t.amount).toFixed(2)}</div>
                      <div style={{fontSize:10,color:"#475569"}}>{t.merchant_name} · {t.country}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:18,fontFamily:"'Syne',sans-serif",fontWeight:800,color:RISK_COLORS[t.risk_level]}}>{fmtPct(t.fraud_probability)}</div>
                      <div style={{fontSize:9,color:"#475569"}}>fraud probability</div>
                    </div>
                  </div>
                  {t.top_factors?.[0] && (
                    <div style={{fontSize:9,color:"#334155",marginBottom:6}}>
                      TOP SIGNAL: {FEATURE_DESC[t.top_factors[0].feature]||t.top_factors[0].feature}
                      {" "}({t.top_factors[0].shap>0?"+":""}{Number(t.top_factors[0].shap).toFixed(5)})
                    </div>
                  )}
                  <div style={{height:2,background:"#1a2035",borderRadius:1}}>
                    <div style={{width:`${t.fraud_probability*100}%`,height:"100%",background:`linear-gradient(90deg,${RISK_COLORS[t.risk_level]}88,${RISK_COLORS[t.risk_level]})`,borderRadius:1}}/>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}