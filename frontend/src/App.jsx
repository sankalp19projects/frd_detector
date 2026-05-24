import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell, LineChart, Line
} from "recharts";

const API = import.meta.env.VITE_API_URL;

const RISK_COLORS = { CRITICAL:"#ff2d55", HIGH:"#ff6b2d", MEDIUM:"#ffd60a", LOW:"#30d158" };
const RISK_BG     = { CRITICAL:"rgba(255,45,85,0.12)", HIGH:"rgba(255,107,45,0.12)", MEDIUM:"rgba(255,214,10,0.10)", LOW:"rgba(48,209,88,0.10)" };
const fmt$   = v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${Number(v).toFixed(2)}`;
const fmtPct = v => `${(v*100).toFixed(1)}%`;
const fmtTime = s => new Date(s).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"});

const FEATURE_DESC = {
  amount:"Transaction amount", hour_of_day:"Hour of day", day_of_week:"Day of week",
  merchant_category:"Merchant category", distance_from_home:"Distance from home (km)",
  transaction_velocity_1h:"Txns last 1h", transaction_velocity_24h:"Txns last 24h",
  avg_amount_30d:"Avg spend 30d", amount_deviation:"Amount deviation",
  is_foreign:"Foreign txn", card_present:"Card present", recurring:"Recurring",
  high_risk_merchant:"High-risk merchant", account_age_days:"Account age (days)",
  failed_attempts_24h:"Failed attempts 24h",
};

export default function FraudDashboard() {
  const [transactions, setTransactions] = useState([]);
  const [metrics, setMetrics]           = useState(null);
  const [selected, setSelected]         = useState(null);
  const [tab, setTab]                   = useState("stream");
  const [connected, setConnected]       = useState(false);
  const [throughputData, setThroughputData] = useState([]);
  const [fraudRateData, setFraudRateData]   = useState([]);
  const [error, setError]               = useState(null);
  const pollRef = useRef(null);
  const seenIds = useRef(new Set());

  // ── Poll /poll endpoint every second ──────────────────────────────────────
  useEffect(() => {
    let lastIndex = 0;

    async function poll() {
      try {
        const [txRes, mRes] = await Promise.all([
          fetch(`${API}/poll?since=${lastIndex}&limit=20`),
          fetch(`${API}/metrics`)
        ]);

        if (!txRes.ok || !mRes.ok) throw new Error("Server error");
        setConnected(true);
        setError(null);

        const txData = await txRes.json();
        const mData  = await mRes.json();

        setMetrics(mData);

        const newTxns = (txData.transactions || []).filter(t => !seenIds.current.has(t.transaction_id));
        if (newTxns.length > 0) {
          newTxns.forEach(t => seenIds.current.add(t.transaction_id));
          lastIndex = txData.next_index ?? lastIndex;

          setTransactions(prev => [...newTxns, ...prev].slice(0, 300));

          const ts = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"});
          setThroughputData(p => [...p, {ts, value: mData.total_processed ?? 0}].slice(-30));
          setFraudRateData(p  => [...p, {ts, value: +((mData.fraud_rate ?? 0)*100).toFixed(1)}].slice(-30));
        }
      } catch (e) {
        setConnected(false);
        setError("Cannot reach backend at " + API + ". Make sure server.py is running.");
      }
    }

    poll();
    pollRef.current = setInterval(poll, 1000);
    return () => clearInterval(pollRef.current);
  }, []);

  const fraudTxns = transactions.filter(t => t.is_fraud || t.fraud_probability >= 0.5);

  // ── Connection error banner ────────────────────────────────────────────────
  if (error && !connected) return (
    <div style={{minHeight:"100vh",background:"#060912",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"monospace",color:"#ff2d55",padding:40,textAlign:"center"}}>
      <div>
        <div style={{fontSize:24,marginBottom:12}}>⚠ Backend Offline</div>
        <div style={{color:"#94a3b8",fontSize:13}}>{error}</div>
        <div style={{color:"#475569",fontSize:11,marginTop:12}}>Run: <span style={{color:"#60a5fa"}}>python backend/server.py</span></div>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#060912",fontFamily:"'IBM Plex Mono','Courier New',monospace",color:"#e2e8f0",overflowX:"auto"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#0d1117}
        ::-webkit-scrollbar-thumb{background:#2d3748;border-radius:2px}
        .txn-row:hover{background:rgba(255,255,255,0.04)!important;cursor:pointer;}
        .tab-btn{background:none;border:none;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:0.1em;padding:8px 16px;text-transform:uppercase;transition:all 0.15s;}
        @keyframes fadeSlide{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        .new-txn{animation:fadeSlide 0.25s ease-out;}
        .live-dot{animation:pulse 1.2s ease-in-out infinite;}
      `}</style>

      {/* Header */}
      <div style={{borderBottom:"1px solid #1a2035",padding:"16px 28px",display:"flex",alignItems:"center",gap:20,background:"rgba(6,9,18,0.95)",position:"sticky",top:0,zIndex:50}}>
        <div>
          <div style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,color:"#fff"}}>
            SENTINEL<span style={{color:"#ff2d55"}}>//</span>FDP
          </div>
          <div style={{fontSize:9,color:"#475569",letterSpacing:"0.2em",marginTop:1}}>FRAUD DETECTION PIPELINE — LIVE BACKEND</div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          {connected && <div className="live-dot" style={{width:6,height:6,borderRadius:"50%",background:"#30d158"}}/>}
          <span style={{fontSize:10,color:connected?"#30d158":"#ff2d55",letterSpacing:"0.15em"}}>
            {connected ? "LIVE" : "CONNECTING..."}
          </span>
          <span style={{fontSize:9,color:"#334155",marginLeft:8}}>{API}</span>
        </div>
      </div>

      {/* KPI Strip */}
      {metrics && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:1,background:"#1a2035",borderBottom:"1px solid #1a2035"}}>
          {[
            {label:"PROCESSED",   value:(metrics.total_processed||0).toLocaleString(), sub:"transactions"},
            {label:"FRAUD FLAGGED",value:(metrics.total_fraud||0).toLocaleString(),    sub:"alerts",  color:"#ff2d55"},
            {label:"FRAUD RATE",  value:fmtPct(metrics.fraud_rate||0),                sub:"of stream",color:(metrics.fraud_rate||0)>0.08?"#ff2d55":(metrics.fraud_rate||0)>0.05?"#ff6b2d":"#30d158"},
            {label:"VOLUME",      value:fmt$(metrics.total_amount||0),                sub:"total stream"},
            {label:"AT RISK",     value:fmt$(metrics.fraud_amount||0),                sub:"fraud amount",color:"#ff6b2d"},
            {label:"AVG LATENCY", value:`${(metrics.avg_latency_ms||0).toFixed(1)}ms`,sub:"per transaction",color:"#60a5fa"},
          ].map(k => (
            <div key={k.label} style={{background:"#060912",padding:"14px 20px"}}>
              <div style={{fontSize:9,color:"#475569",letterSpacing:"0.15em",marginBottom:4}}>{k.label}</div>
              <div style={{fontSize:22,fontWeight:600,color:k.color||"#e2e8f0",fontFamily:"'Syne',sans-serif"}}>{k.value}</div>
              <div style={{fontSize:9,color:"#334155",marginTop:2}}>{k.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{borderBottom:"1px solid #1a2035",padding:"0 20px",display:"flex",gap:4}}>
        {["stream","analytics","alerts"].map(t => (
          <button key={t} className="tab-btn" onClick={() => setTab(t)}
            style={{color:tab===t?"#60a5fa":"#475569",borderBottom:tab===t?"1px solid #60a5fa":"1px solid transparent",marginBottom:-1}}>
            {t}
          </button>
        ))}
        {metrics && (
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,fontSize:10,color:"#334155",padding:"0 4px"}}>
            <span>AUC: {metrics.model_auc ? Number(metrics.model_auc).toFixed(4) : "—"}</span>
            <span>THR: 0.50</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{padding:"20px 24px",display:"grid",gridTemplateColumns:selected&&tab==="stream"?"1fr 360px":"1fr",gap:16}}>

        {/* STREAM TAB */}
        {tab==="stream" && (
          <>
            <div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
                <div style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,padding:"12px 16px"}}>
                  <div style={{fontSize:9,color:"#475569",letterSpacing:"0.15em",marginBottom:8}}>TRANSACTION VOLUME</div>
                  <ResponsiveContainer width="100%" height={60}>
                    <AreaChart data={throughputData}>
                      <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3}/><stop offset="95%" stopColor="#60a5fa" stopOpacity={0}/>
                      </linearGradient></defs>
                      <Area type="monotone" dataKey="value" stroke="#60a5fa" fill="url(#tg)" strokeWidth={1.5} dot={false}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,padding:"12px 16px"}}>
                  <div style={{fontSize:9,color:"#475569",letterSpacing:"0.15em",marginBottom:8}}>FRAUD RATE % (ROLLING)</div>
                  <ResponsiveContainer width="100%" height={60}>
                    <LineChart data={fraudRateData}>
                      <Line type="monotone" dataKey="value" stroke="#ff2d55" strokeWidth={1.5} dot={false}/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,overflow:"hidden"}}>
                <div style={{display:"grid",gridTemplateColumns:"100px 80px 110px 1fr 80px 90px 70px 80px",padding:"8px 16px",borderBottom:"1px solid #1a2035",fontSize:9,color:"#334155",letterSpacing:"0.12em",textTransform:"uppercase"}}>
                  <span>TXN ID</span><span>USER</span><span>TIME</span><span>MERCHANT</span><span>AMOUNT</span><span>COUNTRY</span><span>RISK</span><span>PROB</span>
                </div>
                <div style={{maxHeight:"55vh",overflowY:"auto"}}>
                  {transactions.length === 0 && (
                    <div style={{textAlign:"center",padding:40,color:"#334155",fontSize:11}}>Waiting for transactions from backend…</div>
                  )}
                  {transactions.slice(0,100).map((t,i) => (
                    <div key={t.transaction_id} className={`txn-row${i===0?" new-txn":""}`}
                      onClick={() => setSelected(selected?.transaction_id===t.transaction_id ? null : t)}
                      style={{display:"grid",gridTemplateColumns:"100px 80px 110px 1fr 80px 90px 70px 80px",padding:"7px 16px",borderBottom:"1px solid #0d1520",fontSize:11,background:selected?.transaction_id===t.transaction_id?"rgba(96,165,250,0.06)":t.is_fraud?"rgba(255,45,85,0.04)":"transparent",transition:"background 0.1s"}}>
                      <span style={{color:"#60a5fa",fontWeight:500}}>{t.transaction_id?.slice(0,8)}</span>
                      <span style={{color:"#94a3b8"}}>{t.user_id}</span>
                      <span style={{color:"#475569",fontSize:10}}>{fmtTime(t.timestamp)}</span>
                      <span style={{color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.merchant_name || "—"}</span>
                      <span style={{color:"#e2e8f0",fontWeight:500}}>${Number(t.amount||0).toFixed(2)}</span>
                      <span style={{color:"#94a3b8"}}>{t.country || "US"}{t.is_foreign?"🌐":""}</span>
                      <span style={{color:RISK_COLORS[t.risk_level],background:RISK_BG[t.risk_level],padding:"1px 6px",borderRadius:2,fontSize:9,fontWeight:600}}>
                        {t.risk_level || "LOW"}
                      </span>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{flex:1,height:3,background:"#1a2035",borderRadius:2}}>
                          <div style={{width:`${(t.fraud_probability||0)*100}%`,height:"100%",background:RISK_COLORS[t.risk_level||"LOW"],borderRadius:2}}/>
                        </div>
                        <span style={{fontSize:10,color:RISK_COLORS[t.risk_level||"LOW"],minWidth:32}}>{fmtPct(t.fraud_probability||0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Detail Panel */}
            {selected && (
              <div style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,padding:20,overflowY:"auto",maxHeight:"calc(100vh - 240px)",position:"sticky",top:220}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                  <div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:800,color:"#fff"}}>{selected.transaction_id}</div>
                    <div style={{fontSize:10,color:"#475569",marginTop:2}}>{selected.user_id} · {selected.merchant_name}</div>
                  </div>
                  <button onClick={() => setSelected(null)} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:16}}>✕</button>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                  <div style={{background:"#060912",border:"1px solid #1a2035",borderRadius:3,padding:"10px 12px"}}>
                    <div style={{fontSize:9,color:"#475569",marginBottom:3}}>AMOUNT</div>
                    <div style={{fontSize:20,fontFamily:"'Syne',sans-serif",fontWeight:800}}>${Number(selected.amount||0).toFixed(2)}</div>
                  </div>
                  <div style={{background:RISK_BG[selected.risk_level],border:`1px solid ${RISK_COLORS[selected.risk_level||"LOW"]}33`,borderRadius:3,padding:"10px 12px"}}>
                    <div style={{fontSize:9,color:"#475569",marginBottom:3}}>FRAUD PROBABILITY</div>
                    <div style={{fontSize:20,fontFamily:"'Syne',sans-serif",fontWeight:800,color:RISK_COLORS[selected.risk_level||"LOW"]}}>{fmtPct(selected.fraud_probability||0)}</div>
                    <div style={{fontSize:9,color:RISK_COLORS[selected.risk_level||"LOW"],marginTop:2}}>{selected.risk_level}</div>
                  </div>
                </div>

                {selected.top_factors && selected.top_factors.length > 0 && (
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:9,color:"#475569",letterSpacing:"0.15em",marginBottom:10}}>SHAP FEATURE ATTRIBUTION</div>
                    <div style={{fontSize:9,color:"#334155",marginBottom:8,display:"flex",justifyContent:"space-between"}}>
                      <span>baseline: {fmtPct(selected.shap_baseline||0)}</span>
                      <span>prediction: {fmtPct(selected.fraud_probability||0)}</span>
                    </div>
                    {selected.top_factors.map(f => {
                      const pct = Math.min(100, Math.abs(f.shap||0)*500);
                      const pos = (f.shap||0) > 0;
                      return (
                        <div key={f.feature} style={{marginBottom:6}}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:2}}>
                            <span style={{color:"#94a3b8"}}>{FEATURE_DESC[f.feature]||f.feature}</span>
                            <span style={{color:pos?"#ff6b2d":"#30d158",fontWeight:500}}>
                              {pos?"+":""}{(f.shap||0).toFixed(4)}
                            </span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <div style={{flex:1,height:4,background:"#1a2035",borderRadius:2,overflow:"hidden"}}>
                              <div style={{width:`${pct}%`,height:"100%",borderRadius:2,background:pos?"linear-gradient(90deg,#ff6b2d,#ff2d55)":"linear-gradient(90deg,#30d158,#00c6a7)"}}/>
                            </div>
                            <span style={{fontSize:9,color:"#475569",minWidth:50,textAlign:"right"}}>
                              {typeof f.value==="number"?f.value.toFixed(2):f.value}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selected.features && (
                  <div>
                    <div style={{fontSize:9,color:"#475569",letterSpacing:"0.15em",marginBottom:8}}>RAW FEATURES</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                      {Object.entries(selected.features).map(([k,v]) => (
                        <div key={k} style={{background:"#060912",padding:"4px 8px",borderRadius:2,display:"flex",justifyContent:"space-between",fontSize:9}}>
                          <span style={{color:"#334155",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:100}}>{k}</span>
                          <span style={{color:"#94a3b8",fontWeight:500}}>{typeof v==="number"?v.toFixed(2):String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ANALYTICS TAB */}
        {tab==="analytics" && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <div style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,padding:20}}>
              <div style={{fontSize:9,color:"#475569",letterSpacing:"0.15em",marginBottom:16}}>RISK LEVEL DISTRIBUTION</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={["CRITICAL","HIGH","MEDIUM","LOW"].map(r=>({
                  name:r, count:transactions.filter(t=>t.risk_level===r).length
                }))}>
                  <XAxis dataKey="name" tick={{fill:"#475569",fontSize:9}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"#334155",fontSize:9}} axisLine={false} tickLine={false}/>
                  <Tooltip contentStyle={{background:"#0d1117",border:"1px solid #1a2035",fontSize:10}}/>
                  <Bar dataKey="count" radius={[2,2,0,0]}>
                    {["CRITICAL","HIGH","MEDIUM","LOW"].map(r=><Cell key={r} fill={RISK_COLORS[r]}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,padding:20}}>
              <div style={{fontSize:9,color:"#475569",letterSpacing:"0.15em",marginBottom:16}}>FRAUD PROBABILITY HISTOGRAM</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={Array.from({length:10},(_,i)=>({
                  bucket:`${i*10}-${(i+1)*10}%`,
                  count:transactions.filter(t=>(t.fraud_probability||0)>=i*0.1&&(t.fraud_probability||0)<(i+1)*0.1).length
                }))}>
                  <XAxis dataKey="bucket" tick={{fill:"#334155",fontSize:8}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"#334155",fontSize:9}} axisLine={false} tickLine={false}/>
                  <Tooltip contentStyle={{background:"#0d1117",border:"1px solid #1a2035",fontSize:10}}/>
                  <Bar dataKey="count" radius={[2,2,0,0]}>
                    {Array.from({length:10},(_,i)=><Cell key={i} fill={i>=8?"#ff2d55":i>=6?"#ff6b2d":i>=4?"#ffd60a":"#30d158"}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{background:"#0d1117",border:"1px solid #1a2035",borderRadius:4,padding:20,gridColumn:"span 2"}}>
              <div style={{fontSize:9,color:"#475569",letterSpacing:"0.15em",marginBottom:16}}>FRAUD RATE OVER TIME</div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={fraudRateData}>
                  <defs><linearGradient id="fg2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff2d55" stopOpacity={0.3}/><stop offset="95%" stopColor="#ff2d55" stopOpacity={0}/>
                  </linearGradient></defs>
                  <XAxis dataKey="ts" tick={{fill:"#334155",fontSize:8}} axisLine={false} tickLine={false}/>
                  <YAxis unit="%" tick={{fill:"#334155",fontSize:9}} axisLine={false} tickLine={false}/>
                  <Tooltip contentStyle={{background:"#0d1117",border:"1px solid #1a2035",fontSize:10}}/>
                  <Area type="monotone" dataKey="value" stroke="#ff2d55" fill="url(#fg2)" strokeWidth={1.5} dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ALERTS TAB */}
        {tab==="alerts" && (
          <div>
            <div style={{marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:9,color:"#475569",letterSpacing:"0.15em"}}>FRAUD ALERTS — HIGH & CRITICAL</div>
              <div style={{fontSize:10,color:"#ff2d55"}}>{fraudTxns.length} flagged</div>
            </div>
            {fraudTxns.length === 0 && (
              <div style={{textAlign:"center",padding:60,color:"#334155",fontSize:12}}>No fraud detected yet from backend…</div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:12}}>
              {fraudTxns.slice(0,30).map(t => (
                <div key={t.transaction_id} onClick={() => {setSelected(t); setTab("stream");}}
                  style={{background:"#0d1117",border:`1px solid ${RISK_COLORS[t.risk_level||"HIGH"]}44`,borderRadius:4,padding:16,cursor:"pointer"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <span style={{color:"#60a5fa",fontSize:11,fontWeight:600}}>{t.transaction_id?.slice(0,8)}</span>
                    <span style={{background:RISK_BG[t.risk_level],color:RISK_COLORS[t.risk_level||"HIGH"],fontSize:9,padding:"2px 8px",borderRadius:2,fontWeight:700}}>{t.risk_level}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div>
                      <div style={{fontSize:18,fontFamily:"'Syne',sans-serif",fontWeight:800,color:"#fff"}}>${Number(t.amount||0).toFixed(2)}</div>
                      <div style={{fontSize:10,color:"#475569"}}>{t.merchant_name} · {t.country}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:18,fontFamily:"'Syne',sans-serif",fontWeight:800,color:RISK_COLORS[t.risk_level||"HIGH"]}}>{fmtPct(t.fraud_probability||0)}</div>
                      <div style={{fontSize:9,color:"#475569"}}>fraud prob</div>
                    </div>
                  </div>
                  {t.top_factors?.[0] && (
                    <div style={{fontSize:9,color:"#334155"}}>
                      TOP SIGNAL: {t.top_factors[0].feature} ({(t.top_factors[0].shap||0)>0?"+":""}{(t.top_factors[0].shap||0).toFixed(4)})
                    </div>
                  )}
                  <div style={{height:2,background:"#1a2035",borderRadius:1,marginTop:8}}>
                    <div style={{width:`${(t.fraud_probability||0)*100}%`,height:"100%",background:RISK_COLORS[t.risk_level||"HIGH"],borderRadius:1}}/>
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