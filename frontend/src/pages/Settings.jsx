import { useState, useRef, useEffect, useCallback } from "react";
import { AirGestureSetup } from "../components/AirGestureCapture";
import { ImagePointsSetup } from "../components/ImagePointsAuth";

const API = "https://127.0.0.1:5000";

const METHODS = {
  password:    { icon: "🔑", label: "Password",      desc: "Master password and vault encryption key." },
  keystroke:   { icon: "⌨",  label: "Keystroke",     desc: "Typing rhythm biometric fingerprint." },
  mouse:       { icon: "🖱",  label: "Mouse Gesture", desc: "Hand-drawn gesture verified on login." },
  airgesture:  { icon: "✋",  label: "Air Gesture",   desc: "Camera-based hand gesture recognition." },
  imagepoints: { icon: "🖼",  label: "Image Points",  desc: "Click sequence on a registered image." },
};

let _tid = 0;
function Toasts({ items, remove }) {
  return (
    <div className="sv-toast-container">
      {items.map(t => (
        <div key={t.id} className={`sv-toast sv-toast-${t.type}${t.exiting?" exiting":""}`} onClick={() => remove(t.id)}>
          <span>{t.type==="success"?"✓":t.type==="error"?"✕":"ℹ"}</span>
          <span style={{ flex:1 }}>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

export default function Settings({ token, onBack }) {
  const [enabled,      setEnabled]      = useState([]);
  const [panel,        setPanel]        = useState(null);
  const [currentPw,    setCurrentPw]    = useState("");
  const [newPw,        setNewPw]        = useState("");
  const [confirmPw,    setConfirmPw]    = useState("");
  const [sessions,     setSessions]     = useState([]);
  const [sessOpen,     setSessOpen]     = useState(false);
  const [showDel,      setShowDel]      = useState(false);
  const [delPw,        setDelPw]        = useState("");
  const [delTyped,     setDelTyped]     = useState("");
  const [mouseSamples, setMouseSamples] = useState([]);
  const [curPoints,    setCurPoints]    = useState([]);
  const [drawing,      setDrawing]      = useState(false);
  const [ksSamples,    setKsSamples]    = useState([]);
  const [curKs,        setCurKs]        = useState([]);
  const [toasts,       setToasts]       = useState([]);
  const [visible,      setVisible]      = useState(false);

  const canvasRef = useRef(null);
  const kdRef     = useRef({});

  useEffect(() => { const t = setTimeout(() => setVisible(true), 40); return () => clearTimeout(t); }, []);
  const authH = useCallback(() => ({ Authorization: token }), [token]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/settings/methods`, { headers: authH() })
      .then(r => r.json()).then(d => setEnabled(d.enabled || []))
      .catch(() => addToast("Could not load settings", "error"));
  }, [token]);

  const addToast = (msg, type = "success") => {
    const id = ++_tid;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id===id ? { ...t, exiting:true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id!==id)), 280);
    }, 3200);
  };
  const removeToast = (id) => {
    setToasts(prev => prev.map(t => t.id===id ? { ...t, exiting:true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id!==id)), 280);
  };

  const openPanel = m => { setPanel(m); setMouseSamples([]); setCurPoints([]); setDrawing(false); setKsSamples([]); setCurKs([]); setCurrentPw(""); setNewPw(""); setConfirmPw(""); };
  const closePanel = () => setPanel(null);

  const onMD = () => { setDrawing(true); setCurPoints([]); const ctx=canvasRef.current?.getContext("2d"); if(ctx) ctx.clearRect(0,0,canvasRef.current.width,canvasRef.current.height); };
  const onMM = e => {
    if (!drawing||!canvasRef.current) return;
    const rect=canvasRef.current.getBoundingClientRect();
    const x=(e.clientX-rect.left)*(canvasRef.current.width/rect.width);
    const y=(e.clientY-rect.top)*(canvasRef.current.height/rect.height);
    const ctx=canvasRef.current.getContext("2d");
    const pts=[...curPoints,[x,y]];
    if(pts.length>1){const prev=pts[pts.length-2];ctx.strokeStyle="#a78bfa";ctx.lineWidth=2.5;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(prev[0],prev[1]);ctx.lineTo(x,y);ctx.stroke();}
    setCurPoints(pts);
  };
  const onMU = () => { setDrawing(false); if(curPoints.length>5&&mouseSamples.length<3) setMouseSamples(p=>[...p,curPoints]); setCurPoints([]); };

  const onKD   = e => { kdRef.current[e.key]=Date.now(); };
  const onKU   = e => { const up=Date.now(),down=kdRef.current[e.key]; if(!down) return; if(up-down>0) setCurKs(p=>[...p,{key:e.key,down,up,dwell:up-down}]); delete kdRef.current[e.key]; };
  const onKBlur= () => { if(curKs.length>0&&ksSamples.length<3){setKsSamples(p=>[...p,curKs]);setCurKs([]);} };

  const save = async method => {
    let body = { method };
    if (method==="password") {
      if(!currentPw||!newPw||!confirmPw){addToast("All fields required","error");return;}
      if(newPw!==confirmPw){addToast("Passwords don't match","error");return;}
      if(newPw.length<6){addToast("Min 6 characters","error");return;}
      body={method,current_password:currentPw,new_password:newPw};
    } else if (method==="mouse") {
      if(mouseSamples.length<3){addToast("Draw gesture 3 times","error");return;}
      body={method,mouse_samples:mouseSamples};
    } else if (method==="keystroke") {
      if(ksSamples.length<1){addToast("Type and click away at least once","error");return;}
      body={method,keystroke_samples:ksSamples};
    }
    try {
      const r=await fetch(`${API}/settings/reenroll`,{method:"POST",headers:{...authH(),"Content-Type":"application/json"},body:JSON.stringify(body)});
      const d=await r.json();
      if(d.error){addToast(d.error,"error");return;}
      addToast(`${METHODS[method]?.label} updated`); setPanel(null);
    } catch { addToast("Could not reach server","error"); }
  };

  const disable = async method => {
    if(method==="password"){addToast("Password cannot be disabled","error");return;}
    if(!confirm(`Disable ${METHODS[method]?.label}?`)) return;
    try {
      const r=await fetch(`${API}/settings/disable-method`,{method:"POST",headers:{...authH(),"Content-Type":"application/json"},body:JSON.stringify({method})});
      const d=await r.json();
      if(d.error){addToast(d.error,"error");return;}
      setEnabled(p=>p.filter(m=>m!==method)); addToast(`${METHODS[method]?.label} disabled`);
    } catch { addToast("Could not reach server","error"); }
  };

  const loadSessions = async () => {
    try{const r=await fetch(`${API}/sessions`,{headers:authH()});setSessions((await r.json()).sessions||[]);}
    catch{addToast("Could not load sessions","error");}
  };
  const revokeSession = async id => {
    try{await fetch(`${API}/sessions/${id}`,{method:"DELETE",headers:authH()});loadSessions();addToast("Session revoked");}
    catch{addToast("Could not revoke","error");}
  };
  const deleteAccount = async () => {
    if(delTyped!=="DELETE"){addToast("Type DELETE to confirm","error");return;}
    if(!delPw){addToast("Password required","error");return;}
    try {
      const r=await fetch(`${API}/account/delete`,{method:"POST",headers:{...authH(),"Content-Type":"application/json"},body:JSON.stringify({password:delPw})});
      const d=await r.json();
      if(d.error){addToast(d.error,"error");return;}
      onBack("deleted");
    } catch { addToast("Could not reach server","error"); }
  };

  const ordered = [...Object.keys(METHODS).filter(m=>enabled.includes(m)), ...Object.keys(METHODS).filter(m=>!enabled.includes(m))];

  const renderMethod = method => {
    const info=METHODS[method], active=enabled.includes(method), isOpen=panel===method;
    return (
      <div key={method} className={`sv-card sv-settings-method${isOpen?" open":""}`}
        style={{ marginBottom:8, animationDelay:`${ordered.indexOf(method)*0.05}s` }}>
        <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
          <div style={{ width:42,height:42,borderRadius:10,flexShrink:0,background:active?"var(--green-dim)":"var(--obsidian2)",border:`1px solid ${active?"rgba(167,139,250,0.25)":"var(--b1)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,transition:"all 0.3s var(--ease)",boxShadow:active?"0 0 16px var(--green-glow)":"none" }}>
            {info.icon}
          </div>
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ fontFamily:"var(--font-display)",fontSize:14,fontWeight:600,color:"var(--t1)",marginBottom:3 }}>{info.label}</div>
            <div style={{ fontSize:11,color:"var(--t3)",lineHeight:1.5 }}>{info.desc}</div>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:8,flexShrink:0 }}>
            <span className={`sv-badge ${active?"sv-badge-green":"sv-badge-ghost"}`}>{active?"enabled":"disabled"}</span>
            <button className={`sv-btn sv-btn-sm ${isOpen?"sv-btn-ghost":"sv-btn-primary"}`} onClick={() => isOpen?closePanel():openPanel(method)}>
              {isOpen?"Cancel":active?"Re-enroll":"Set Up"}
            </button>
            {active && method!=="password" && (
              <button className="sv-btn sv-btn-danger sv-btn-sm" onClick={() => disable(method)}>Disable</button>
            )}
          </div>
        </div>

        {isOpen && (
          <div style={{ borderTop:"1px solid var(--b2)",padding:"22px 20px",background:"rgba(0,0,0,0.15)",animation:"sv-fade-up 0.2s var(--ease) both" }}>

            {method==="password" && <>
              <div style={{ marginBottom:12 }}>
                <label className="sv-label">Current Password</label>
                <div className="sv-input-group"><span className="sv-input-icon">🔒</span>
                  <input type="password" className="sv-input" placeholder="Enter current password" value={currentPw} onChange={e=>setCurrentPw(e.target.value)} /></div>
              </div>
              <div style={{ marginBottom:12 }}>
                <label className="sv-label">New Password</label>
                <div className="sv-input-group"><span className="sv-input-icon">🔑</span>
                  <input type="password" className="sv-input" placeholder="Min 6 characters" value={newPw} onChange={e=>setNewPw(e.target.value)} onKeyDown={onKD} onKeyUp={onKU} onBlur={onKBlur} /></div>
              </div>
              <div style={{ marginBottom:18 }}>
                <label className="sv-label">Confirm New Password</label>
                <div className="sv-input-group"><span className="sv-input-icon">✓</span>
                  <input type="password" className="sv-input" placeholder="Re-enter new password" value={confirmPw} onChange={e=>setConfirmPw(e.target.value)} /></div>
              </div>
              <div style={{ display:"flex",flexDirection:"column",gap:7,marginBottom:20,padding:"14px 16px",background:"var(--obsidian2)",borderRadius:8,border:"1px solid var(--b2)" }}>
                {[[newPw.length>=6,"At least 6 characters"],[newPw&&confirmPw&&newPw===confirmPw,"Passwords match"],...(enabled.includes("keystroke")?[[ksSamples.length>0,`Keystroke: ${ksSamples.length}/3 samples`]]:[])].map(([ok,txt],i)=>(
                  <div key={i} style={{ display:"flex",alignItems:"center",gap:9,fontSize:11,color:ok?"var(--green)":"var(--t3)",transition:"color 0.25s" }}>
                    <div style={{ width:16,height:16,borderRadius:"50%",border:`1px solid ${ok?"var(--green)":"var(--b1)"}`,background:ok?"var(--green-dim)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,flexShrink:0,transition:"all 0.25s" }}>{ok&&"✓"}</div>
                    {txt}
                  </div>
                ))}
              </div>
              <button className="sv-btn sv-btn-primary sv-btn-lg sv-btn-full" style={{ opacity:newPw.length>=6&&newPw===confirmPw&&currentPw?1:0.35,transition:"opacity 0.2s" }} onClick={()=>save("password")}>Save New Password</button>
            </>}

            {method==="keystroke" && <>
              <label className="sv-label">Type your password — click away to capture sample</label>
              <input type="password" className="sv-input" style={{ marginBottom:14 }} placeholder="type your password naturally" onKeyDown={onKD} onKeyUp={onKU} onBlur={onKBlur} />
              <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:14 }}>
                <div className="sv-dots">{[0,1,2].map(i=><div key={i} className={`sv-dot${i<ksSamples.length?" filled":""}`}/>)}</div>
                <span className="sv-hint">{ksSamples.length}/3 samples captured (1 minimum)</span>
              </div>
              <button className="sv-btn sv-btn-primary sv-btn-lg sv-btn-full" onClick={()=>save("keystroke")}>Save Keystroke Profile</button>
            </>}

            {method==="mouse" && <>
              <label className="sv-label">Draw your gesture — {Math.max(0,3-mouseSamples.length)} more time{3-mouseSamples.length!==1?"s":""} needed</label>
              <canvas ref={canvasRef} width={500} height={140} className={`sv-canvas${mouseSamples.length>=3?" done":""}`} style={{ marginBottom:12 }}
                onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={()=>setDrawing(false)} />
              <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:14 }}>
                <div className="sv-dots">{[0,1,2].map(i=><div key={i} className={`sv-dot${i<mouseSamples.length?" filled":""}`}/>)}</div>
                <span className="sv-hint">Hold and drag to draw — same gesture 3 times</span>
              </div>
              <button className="sv-btn sv-btn-primary sv-btn-lg sv-btn-full" onClick={()=>save("mouse")}>Save Gesture Profile</button>
            </>}

            {method==="airgesture"  && <AirGestureSetup  username={null} sessionToken={token} onSaved={()=>{addToast("Air gesture updated");setPanel(null);}} />}
            {method==="imagepoints" && <ImagePointsSetup sessionToken={token}                 onSaved={()=>{addToast("Image points updated");setPanel(null);}} />}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="sv-page" style={{ opacity:visible?1:0, transform:visible?"none":"translateY(14px)", transition:"opacity 0.35s var(--ease), transform 0.35s var(--ease)" }}>
      <div className="sv-bg-grid" />
      <div className="sv-bg-orb-1" />
      <Toasts items={toasts} remove={removeToast} />

      <div className="sv-inner-md" style={{ position:"relative", zIndex:1 }}>

        <header className="sv-page-header sv-anim-fade-up">
          <div className="sv-logo">
            <div style={{ width:38,height:38,borderRadius:10,background:"var(--panel2)",border:"1px solid var(--b1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18 }}>⚙</div>
            <div>
              <div className="sv-logo-name">Settings</div>
              <div className="sv-logo-sub">Authentication & Account</div>
            </div>
          </div>
          <button className="sv-btn sv-btn-ghost sv-btn-sm" onClick={()=>onBack()}>← Back to Vault</button>
        </header>

        <div className="sv-section-label">Authentication Methods</div>
        <div className="sv-stagger">{ordered.map(renderMethod)}</div>

        <div className="sv-section-label" style={{ marginTop:28 }}>Active Sessions</div>
        <div className="sv-card sv-settings-method" style={{ marginBottom:8 }}>
          <div style={{ padding:"16px 20px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
            <div style={{ width:42,height:42,borderRadius:10,background:"var(--blue-dim)",border:"1px solid rgba(96,165,250,0.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>🖥</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"var(--font-display)",fontSize:14,fontWeight:600,color:"var(--t1)",marginBottom:3 }}>Device Sessions</div>
              <div style={{ fontSize:11,color:"var(--t3)" }}>View and revoke other active logins</div>
            </div>
            <button className="sv-btn sv-btn-ghost sv-btn-sm" onClick={()=>{if(!sessOpen)loadSessions();setSessOpen(v=>!v);}}>
              {sessOpen?"Hide":"View Sessions"}
            </button>
          </div>
          {sessOpen && (
            <div style={{ borderTop:"1px solid var(--b2)",padding:"16px 20px",animation:"sv-fade-up 0.2s var(--ease)" }}>
              {sessions.length===0
                ? <div className="sv-hint" style={{ textAlign:"center",padding:"12px 0" }}>No other active sessions</div>
                : sessions.map(s=>(
                  <div key={s.token_id} style={{ display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 0",borderBottom:"1px solid var(--b3)",gap:12,flexWrap:"wrap" }}>
                    <div>
                      {s.is_current ? <span className="sv-badge sv-badge-green">current session</span>
                        : <span style={{ fontSize:11,color:"var(--t3)",fontFamily:"var(--font-mono)" }}>{s.token_hint}…</span>}
                      {s.methods&&<div style={{ fontSize:10,color:"var(--t4)",marginTop:3 }}>{s.methods.join(", ")}</div>}
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                      <span style={{ fontSize:11,color:s.expires_in<120?"var(--red)":"var(--t3)" }}>{Math.floor(s.expires_in/60)}m left</span>
                      {!s.is_current&&<button className="sv-btn sv-btn-danger sv-btn-xs" onClick={()=>revokeSession(s.token_id)}>Revoke</button>}
                    </div>
                  </div>
                ))
              }
            </div>
          )}
        </div>

        <div className="sv-section-label" style={{ marginTop:28,color:"var(--red)" }}>Danger Zone</div>
        <div className="sv-card sv-danger-zone" style={{ marginBottom:40 }}>
          <div style={{ padding:"16px 20px",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap" }}>
            <div style={{ width:42,height:42,borderRadius:10,background:"var(--red-dim)",border:"1px solid rgba(248,113,113,0.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0 }}>⚠</div>
            <div style={{ flex:1,minWidth:0 }}>
              <div style={{ fontFamily:"var(--font-display)",fontSize:14,fontWeight:600,color:"var(--red)",marginBottom:3 }}>Delete Account</div>
              <div style={{ fontSize:11,color:"var(--t3)" }}>Permanently delete your vault and all encrypted data. Cannot be undone.</div>
            </div>
            {!showDel&&<button className="sv-btn sv-btn-danger sv-btn-sm" onClick={()=>setShowDel(true)}>Delete Account</button>}
          </div>
          {showDel&&(
            <div style={{ borderTop:"1px solid rgba(248,113,113,0.15)",padding:"22px 20px",animation:"sv-fade-up 0.2s var(--ease)" }}>
              <div style={{ marginBottom:12 }}>
                <label className="sv-label" style={{ color:"var(--red)" }}>Confirm Password</label>
                <input type="password" className="sv-input" style={{ borderColor:"rgba(248,113,113,0.25)" }} placeholder="Your current password" value={delPw} onChange={e=>setDelPw(e.target.value)} />
              </div>
              <div style={{ marginBottom:18 }}>
                <label className="sv-label" style={{ color:"var(--red)" }}>Type DELETE to confirm</label>
                <input className="sv-input" style={{ borderColor:"rgba(248,113,113,0.25)",letterSpacing:"0.1em" }} placeholder="DELETE" value={delTyped} onChange={e=>setDelTyped(e.target.value.toUpperCase())} />
              </div>
              <div style={{ display:"flex",gap:8 }}>
                <button className="sv-btn sv-btn-danger sv-btn-lg sv-btn-full" style={{ opacity:delTyped==="DELETE"&&delPw?1:0.35,transition:"opacity 0.2s" }} onClick={deleteAccount}>Permanently Delete Account</button>
                <button className="sv-btn sv-btn-ghost sv-btn-lg" onClick={()=>{setShowDel(false);setDelPw("");setDelTyped("");}}>Cancel</button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}