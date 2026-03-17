import { useState, useEffect, useRef } from "react";
import { AirGestureSetup  } from "../components/AirGestureCapture";
import { ImagePointsSetup } from "../components/ImagePointsAuth";

const API = "https://securevault-production.up.railway.app";

const ALL_METHODS = [
  { id:"password",    icon:"🔑", label:"Password",  disabled:true },
  { id:"keystroke",   icon:"⌨",  label:"Keystroke"               },
  { id:"mouse",       icon:"🖱",  label:"Gesture"                 },
  { id:"airgesture",  icon:"✋",  label:"Air"                     },
  { id:"imagepoints", icon:"🖼",  label:"Image"                   },
];

export default function Setup({ onSuccess, onGoLogin }) {

  // ── State ─────────────────────────────────────────────────
  const [username, setUsername]   = useState("");
  const [password, setPassword]   = useState("");
  const [error,    setError]      = useState("");
  const [success,  setSuccess]    = useState("");
  const [loading,  setLoading]    = useState(false);
  const [step,     setStep]       = useState("credentials");
  const [visible,  setVisible]    = useState(false);

  const [enabledMethods, setEnabledMethods] = useState(["password"]);
  const [threshold,      setThreshold]      = useState(1);
  const [primary,        setPrimary]        = useState("password");

  const [keystrokeSamples, setKeystrokeSamples] = useState([]);
  const [currentKeystroke, setCurrentKeystroke] = useState([]);
  const [mouseSamples,     setMouseSamples]     = useState([]);
  const [currentPoints,    setCurrentPoints]    = useState([]);
  const [drawing,          setDrawing]          = useState(false);

  const [sessionToken,     setSessionToken]     = useState(null);
  const [airGestureReady,  setAirGestureReady]  = useState(false);
  const [imagePointsReady, setImagePointsReady] = useState(false);

  const [cursor, setCursor] = useState({ x:-999, y:-999, on:false });

  const keyDownRef = useRef({});
  const canvasRef  = useRef(null);
  const pageRef    = useRef(null);

  // ── Effects ───────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const move  = (e) => setCursor({ x:e.clientX, y:e.clientY, on:true });
    const leave = ()  => setCursor(c => ({ ...c, on:false }));
    window.addEventListener("mousemove",  move);
    window.addEventListener("mouseleave", leave);
    return () => {
      window.removeEventListener("mousemove",  move);
      window.removeEventListener("mouseleave", leave);
    };
  }, []);

  // ── Method toggle ─────────────────────────────────────────
  const toggleMethod = (id) => {
    setEnabledMethods(prev => {
      const next = prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id];
      const coreCount = next.filter(m => !["airgesture","imagepoints"].includes(m)).length;
      setThreshold(t => Math.min(t, Math.max(1, coreCount)));
      return next;
    });
  };

  // ── Mouse handlers ────────────────────────────────────────
  const handleMouseDown = () => {
    setDrawing(true);
    setCurrentPoints([]);
    canvasRef.current?.getContext("2d").clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };
  const handleMouseMove = (e) => {
    if (!drawing || !canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - r.left) * (canvasRef.current.width  / r.width);
    const y = (e.clientY - r.top)  * (canvasRef.current.height / r.height);
    const ctx = canvasRef.current.getContext("2d");
    const pts = [...currentPoints, [x, y]];
    if (pts.length > 1) {
      const p = pts[pts.length - 2];
      ctx.strokeStyle = "#a78bfa"; ctx.lineWidth = 2.5;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(x, y); ctx.stroke();
    }
    setCurrentPoints(pts);
  };
  const handleMouseUp = () => {
    setDrawing(false);
    if (currentPoints.length > 5 && mouseSamples.length < 3) {
      setMouseSamples(prev => [...prev, currentPoints]);
    }
    setCurrentPoints([]);
  };

  // ── Keystroke handlers ────────────────────────────────────
  const handleKeyDown = (e) => { keyDownRef.current[e.key] = Date.now(); };
  const handleKeyUp   = (e) => {
    const up = Date.now(), down = keyDownRef.current[e.key];
    if (!down) return;
    const dwell = up - down;
    if (dwell > 0) setCurrentKeystroke(prev => [...prev, { key:e.key, down, up, dwell }]);
    delete keyDownRef.current[e.key];
  };
  const handlePasswordBlur = () => {
    if (currentKeystroke.length > 0 && keystrokeSamples.length < 3) {
      setKeystrokeSamples(prev => [...prev, currentKeystroke]);
      setCurrentKeystroke([]);
    }
  };

  // ── Submit ────────────────────────────────────────────────
  const handleSubmit = async () => {
    setError(""); setSuccess("");
    if (!username || !password) { setError("Username and password are required"); return; }
    if (enabledMethods.includes("mouse") && mouseSamples.length < 3) {
      setError("Draw your gesture 3 times to register it"); return;
    }
    if (enabledMethods.includes("keystroke") && keystrokeSamples.length < 1) {
      setError("Type your password then click away from the field to save keystroke profile"); return;
    }
    setLoading(true);
    try {
      const res  = await fetch(`${API}/setup`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          username, password,
          mouse_samples:     enabledMethods.includes("mouse")     ? mouseSamples     : null,
          keystroke_samples: enabledMethods.includes("keystroke") ? keystrokeSamples : null,
          enabled:   enabledMethods.filter(m => !["airgesture","imagepoints"].includes(m)),
          threshold,
          primary: (primary === "airgesture" || primary === "imagepoints") ? "password" : primary,
        }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }

      if (enabledMethods.includes("airgesture") || enabledMethods.includes("imagepoints")) {
        const lres  = await fetch(`${API}/login`, {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({
            username, password,
            keystroke: keystrokeSamples[0] || [],
            mouse:     mouseSamples[mouseSamples.length - 1] || [],
          }),
        });
        const ldata = await lres.json();
        if (ldata.session_token) {
          setSessionToken(ldata.session_token);
          setStep("biometrics");
          setSuccess("Account created — register your remaining methods below");
        } else {
          setError("Account created but auto-login failed. Please log in manually to complete setup.");
        }
      } else {
        setSuccess("Account created — redirecting to login...");
        setTimeout(() => onSuccess?.(), 1400);
      }
    } catch { setError("Could not reach server"); }
    finally  { setLoading(false); }
  };

  const needsAir  = enabledMethods.includes("airgesture");
  const needsImg  = enabledMethods.includes("imagepoints");
  const allDone   = (!needsAir || airGestureReady) && (!needsImg || imagePointsReady);
  const coreCount = enabledMethods.filter(m => !["airgesture","imagepoints"].includes(m)).length;

  // ─────────────────────────────────────────────────────────
  return (
    <div className="sv-page-center" ref={pageRef}>

      {/* Cursor light */}
      <div style={{
        position:"fixed", pointerEvents:"none", zIndex:9999,
        left:cursor.x, top:cursor.y,
        width:280, height:280, transform:"translate(-50%,-50%)",
        background:"radial-gradient(circle, rgba(167,139,250,0.11) 0%, rgba(139,110,245,0.04) 45%, transparent 70%)",
        borderRadius:"50%", mixBlendMode:"screen",
        opacity:cursor.on ? 1 : 0, transition:"opacity 0.35s ease",
      }} />

      <div className="sv-bg-grid" />
      <div className="sv-bg-orb-1" />
      <div className="sv-bg-orb-2" />

      <div className="sv-inner-sm" style={{
        position:"relative", zIndex:1, maxWidth:580,
        opacity: visible ? 1 : 0, transform: visible ? "none" : "translateY(24px)",
        transition:"opacity 0.5s ease, transform 0.5s ease",
      }}>

        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:32 }} className="sv-anim-fade-up">
          <div style={{
            display:"inline-flex", alignItems:"center", justifyContent:"center",
            width:56, height:56, borderRadius:16, marginBottom:16,
            background:"var(--green-dim)", border:"1px solid rgba(167,139,250,0.25)",
            fontSize:24, animation:"sv-pulse-border 3s ease infinite",
          }}>🔐</div>
          <div className="sv-display" style={{ fontSize:26, color:"var(--t1)", marginBottom:6 }}>
            {step === "biometrics" ? "Register Biometrics" : "Create Account"}
          </div>
          <div style={{ fontSize:11, color:"var(--t3)", letterSpacing:"0.16em", textTransform:"uppercase" }}>
            SecureVault — Multi-Factor Registration
          </div>
        </div>

        {/* Card */}
        <div className="sv-card-glass sv-corners sv-anim-fade-up" style={{ animationDelay:"0.1s", padding:"36px 36px 32px" }}>

          {error   && <div className="sv-alert sv-alert-error"   style={{ marginBottom:20 }}><span>⚠</span><span>{error}</span></div>}
          {success && <div className="sv-alert sv-alert-success" style={{ marginBottom:20 }}><span>✓</span><span>{success}</span></div>}

          {/* ══ STEP 1: Credentials ══ */}
          {step === "credentials" && (
            <>
              {/* Username */}
              <div style={{ marginBottom:18 }}>
                <label className="sv-label">Username</label>
                <div className="sv-input-group">
                  <span className="sv-input-icon">◈</span>
                  <input className="sv-input" placeholder="choose a username"
                    value={username} onChange={e => setUsername(e.target.value)}
                    autoComplete="username" />
                </div>
              </div>

              {/* Password */}
              <div style={{ marginBottom:8 }}>
                <label className="sv-label">Password</label>
                <div className="sv-input-group">
                  <span className="sv-input-icon">◉</span>
                  <input type="password" className="sv-input"
                    placeholder="type at your natural speed — rhythm is captured"
                    value={password} onChange={e => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} onBlur={handlePasswordBlur}
                    autoComplete="new-password" />
                </div>
              </div>

              {/* Keystroke progress */}
              {enabledMethods.includes("keystroke") && (
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:22 }}>
                  <div className="sv-progress" style={{ flex:1 }}>
                    <div className="sv-progress-bar"
                      style={{ width:`${Math.min(keystrokeSamples.length / 3 * 100, 100)}%` }} />
                  </div>
                  <span style={{
                    fontSize:10, fontWeight:700, letterSpacing:"0.1em",
                    textTransform:"uppercase", whiteSpace:"nowrap",
                    color: keystrokeSamples.length >= 1 ? "var(--green)" : "var(--t3)",
                  }}>
                    {keystrokeSamples.length}/3 samples
                  </span>
                </div>
              )}

              <hr className="sv-divider" />

              {/* Method selection */}
              <div style={{ marginBottom:20 }}>
                <label className="sv-label">Authentication Methods</label>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:8 }}>
                  {ALL_METHODS.map(m => {
                    const active    = enabledMethods.includes(m.id);
                    const postSetup = m.id === "airgesture" || m.id === "imagepoints";
                    return (
                      <div key={m.id}
                        onClick={() => !m.disabled && toggleMethod(m.id)}
                        style={{
                          background: active ? "var(--green-dim2)" : "var(--obsidian2)",
                          border:`1px solid ${active ? "rgba(167,139,250,0.4)" : "var(--b1)"}`,
                          borderRadius:"var(--r)", padding:"12px 6px",
                          cursor: m.disabled ? "default" : "pointer",
                          textAlign:"center", transition:"all 0.18s ease",
                          opacity: m.disabled ? 0.7 : 1,
                        }}
                      >
                        <div style={{ fontSize:18, marginBottom:5 }}>{m.icon}</div>
                        <div style={{
                          fontSize:10, fontWeight:700, letterSpacing:"0.08em",
                          textTransform:"uppercase",
                          color: active ? "var(--green)" : "var(--t3)",
                        }}>{m.label}</div>
                        <div style={{ fontSize:9, marginTop:3, color:"var(--t3)" }}>
                          {m.disabled ? "required" : (postSetup && active ? "after login" : "")}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {(needsAir || needsImg) && (
                  <div style={{
                    marginTop:10, padding:"10px 14px",
                    background:"var(--obsidian2)", border:"1px solid var(--b1)",
                    borderRadius:"var(--r-sm)", fontSize:11, color:"var(--t2)", lineHeight:1.6,
                  }}>
                    ✋ Air gesture &amp; 🖼 Image Points are set up after account creation — you&apos;ll be guided automatically.
                  </div>
                )}
              </div>

              {/* Threshold + Primary */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:20 }}>
                <div>
                  <label className="sv-label">Methods Required</label>
                  <input type="number" className="sv-input"
                    min={1} max={coreCount} value={threshold}
                    onChange={e => setThreshold(Math.min(Math.max(1, Number(e.target.value)), coreCount))} />
                  <div style={{ fontSize:11, color:"var(--t3)", marginTop:6 }}>
                    {threshold} of {coreCount} must pass
                  </div>
                </div>
                <div>
                  <label className="sv-label">Primary Method</label>
                  <select className="sv-input" value={primary} onChange={e => setPrimary(e.target.value)}
                    style={{ cursor:"pointer" }}>
                    {enabledMethods.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <hr className="sv-divider" />

              {/* Mouse gesture canvas */}
              {enabledMethods.includes("mouse") && (
                <div style={{ marginBottom:22 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                    <label className="sv-label" style={{ margin:0 }}>Register Gesture</label>
                    <span className={`sv-badge ${mouseSamples.length >= 3 ? "sv-badge-green" : "sv-badge-ghost"}`}>
                      {mouseSamples.length >= 3 ? "✓ ready" : `${mouseSamples.length} / 3`}
                    </span>
                  </div>
                  <canvas ref={canvasRef} width={480} height={120} className="sv-canvas"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={() => setDrawing(false)} />
                  <div style={{ display:"flex", gap:6, marginTop:8 }}>
                    {[0,1,2].map(i => (
                      <div key={i} style={{
                        flex:1, height:3, borderRadius:2,
                        background: i < mouseSamples.length ? "var(--green-mid)" : "var(--b1)",
                        transition:"background 0.3s",
                      }} />
                    ))}
                  </div>
                  <div style={{ fontSize:11, color:"var(--t3)", marginTop:6 }}>
                    Draw the same gesture 3 times to register your profile
                  </div>
                </div>
              )}

              <button
                className={`sv-btn sv-btn-primary sv-btn-xl sv-btn-full${loading ? " sv-btn-loading" : ""}`}
                onClick={handleSubmit} disabled={loading}>
                {loading
                  ? <><div className="sv-spinner sv-spinner-sm" /> Creating account...</>
                  : "Create Account →"}
              </button>

              {/* Already have an account */}
              <div style={{ textAlign:"center", marginTop:20 }}>
                <span style={{ fontSize:12, color:"var(--t3)" }}>Already have an account? </span>
                <span
                  onClick={() => onGoLogin?.()}
                  style={{
                    fontSize:12, color:"var(--green-mid)", cursor:"pointer",
                    textDecoration:"underline", textUnderlineOffset:3, transition:"color 0.15s",
                  }}
                  onMouseEnter={e => e.target.style.color = "var(--green)"}
                  onMouseLeave={e => e.target.style.color = "var(--green-mid)"}
                >
                  Log in
                </span>
              </div>
            </>
          )}

          {/* ══ STEP 2: Biometrics ══ */}
          {step === "biometrics" && (
            <>
              {needsAir && !airGestureReady && (
                <div style={{ marginBottom:24 }}>
                  <AirGestureSetup username={username} sessionToken={sessionToken}
                    onSaved={() => setAirGestureReady(true)} />
                </div>
              )}
              {needsImg && !imagePointsReady && (
                <div style={{ marginBottom:24 }}>
                  <ImagePointsSetup sessionToken={sessionToken}
                    onSaved={() => setImagePointsReady(true)} />
                </div>
              )}
              {allDone && (
                <button className="sv-btn sv-btn-primary sv-btn-xl sv-btn-full"
                  onClick={() => {
                    setSuccess("All methods registered!");
                    setTimeout(() => onSuccess?.(), 1200);
                  }}>
                  Continue to Login →
                </button>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}