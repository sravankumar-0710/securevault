import { useState, useRef, useCallback, useEffect } from "react";
import { AirGestureLogin  } from "../components/AirGestureCapture";
import { ImagePointsLogin } from "../components/ImagePointsAuth";

const API = "https://127.0.0.1:5000";

export default function Login({ onSuccess, onGoSetup, logoutMessage }) {
  const [username,  setUsername]  = useState("");
  const [password,  setPassword]  = useState("");
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [ksCount,   setKsCount]   = useState(0);
  const [policy,    setPolicy]    = useState(null);
  const [airResult, setAirResult] = useState(null);
  const [imgResult, setImgResult] = useState(null);
  const [points,    setPoints]    = useState([]);
  const [visible,   setVisible]   = useState(false);

  const keyDownRef   = useRef({});
  const keystrokeRef = useRef([]);
  const drawingRef   = useRef(false);
  const pointsRef    = useRef([]);
  const canvasRef    = useRef(null);

  useEffect(() => { const t = setTimeout(() => setVisible(true), 30); return () => clearTimeout(t); }, []);

  const loadPolicy = async () => {
    if (!username) return;
    try {
      const res  = await fetch(`${API}/user-policy/${username}`);
      const data = await res.json();
      if (!data.error) setPolicy(data);
    } catch {}
  };

  const handleKeyDown = useCallback((e) => { keyDownRef.current[e.key] = Date.now(); }, []);
  const handleKeyUp   = useCallback((e) => {
    const up = Date.now(), down = keyDownRef.current[e.key];
    if (!down) return;
    const dwell = up - down;
    delete keyDownRef.current[e.key];
    if (dwell <= 0 || dwell > 2000) return;
    keystrokeRef.current = [...keystrokeRef.current, { key: e.key, down, up, dwell }];
    setKsCount(keystrokeRef.current.length);
  }, []);

  const handlePasswordChange = useCallback((e) => {
    setPassword(e.target.value);
    if (!e.target.value) { keystrokeRef.current = []; keyDownRef.current = {}; setKsCount(0); }
  }, []);

  const handleMouseDown = useCallback(() => {
    drawingRef.current = true; pointsRef.current = []; setPoints([]);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!drawingRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
    const y = (e.clientY - rect.top)  * (canvasRef.current.height / rect.height);
    pointsRef.current = [...pointsRef.current, [x, y]];
    setPoints([...pointsRef.current]);
    const ctx = canvasRef.current.getContext("2d");
    const pts = pointsRef.current;
    if (pts.length > 1) {
      const prev = pts[pts.length - 2];
      ctx.strokeStyle = "#a78bfa"; ctx.lineWidth = 2.5;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(x, y); ctx.stroke();
    }
  }, []);

  const handleTouchStart = useCallback((e) => { e.preventDefault(); handleMouseDown(); }, [handleMouseDown]);
  const handleTouchMove  = useCallback((e) => {
    e.preventDefault();
    const t = e.touches[0];
    handleMouseMove({ clientX: t.clientX, clientY: t.clientY });
  }, [handleMouseMove]);

  const resetBiometrics = () => {
    keystrokeRef.current = []; keyDownRef.current = {};
    pointsRef.current = []; setKsCount(0); setPoints([]);
    setAirResult(null); setImgResult(null);
    if (canvasRef.current) {
      canvasRef.current.getContext("2d").clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const handleLogin = async () => {
    if (!username || !password) { setError("Username and password are required"); return; }
    setError(""); setLoading(true);
    try {
      const body = { username, password, keystroke: [...keystrokeRef.current], mouse: [...pointsRef.current] };
      if (airResult?.ok) body.airgesture_token  = airResult.token;
      if (imgResult?.ok) body.imagepoints_token = imgResult.token;

      const res  = await fetch(`${API}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();

      if (res.status === 429) {
        let t = data.retry_after || 30;
        const tick = () => { setError(`Too many attempts — retry in ${t}s`); if (t-- > 0) setTimeout(tick, 1000); else setError(""); };
        tick(); resetBiometrics(); return;
      }
      if (data.error) { setError(data.error); resetBiometrics(); return; }
      onSuccess(data.session_token);
    } catch { setError("Could not reach server"); }
    finally { setLoading(false); }
  };

  const enabled = policy?.enabled || ["password", "keystroke", "mouse"];
  const ksOk    = ksCount >= 4;
  const mouseOk = points.length > 10;


  // ── Cursor light ──────────────────────────────────────────
  const [cursorPos, setCursorPos] = useState({ x: -999, y: -999, on: false });
  useEffect(() => {
    const move  = e => setCursorPos({ x: e.clientX, y: e.clientY, on: true });
    const leave = () => setCursorPos(c => ({ ...c, on: false }));
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseleave", leave);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseleave", leave); };
  }, []);
  return (
    <div className="sv-page-center">
      {/* Cursor light */}
      <div style={{
        position:"fixed",pointerEvents:"none",zIndex:9999,
        left:cursorPos.x,top:cursorPos.y,
        width:280,height:280,transform:"translate(-50%,-50%)",
        background:"radial-gradient(circle,rgba(167,139,250,0.11) 0%,rgba(139,110,245,0.04) 45%,transparent 70%)",
        borderRadius:"50%",mixBlendMode:"screen",
        opacity:cursorPos.on?1:0,transition:"opacity 0.35s ease",
      }} />
      <div className="sv-bg-grid" />
      <div className="sv-bg-orb-1" />
      <div className="sv-bg-orb-2" />

      <div className="sv-inner-sm" style={{
        position: "relative", zIndex: 1,
        opacity: visible ? 1 : 0, transform: visible ? "none" : "translateY(24px)",
        transition: "opacity 0.5s cubic-bezier(0.4,0,0.2,1), transform 0.5s cubic-bezier(0.4,0,0.2,1)",
      }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }} className="sv-anim-fade-up">
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56, borderRadius: 16, marginBottom: 16,
            background: "var(--green-dim)", border: "1px solid rgba(0,255,136,0.2)",
            fontSize: 24, boxShadow: "0 0 32px var(--green-glow)",
            animation: "sv-pulse-border 3s ease infinite",
          }}>🔐</div>
          <div className="sv-display" style={{ fontSize: 26, color: "var(--t1)", marginBottom: 6 }}>SecureVault</div>
          <div style={{ fontSize: 10, color: "var(--t3)", letterSpacing: "0.18em", textTransform: "uppercase" }}>
            Behavioral Authentication
          </div>
        </div>

        {/* Card */}
        <div className="sv-card-glass sv-corners sv-anim-fade-up" style={{ animationDelay: "0.1s", padding: "32px 32px 28px" }}>

          {/* Error / logout message */}
          {(error || logoutMessage) && (
            <div className="sv-alert sv-alert-error" style={{ marginBottom: 20 }}>
              <span style={{ flexShrink: 0 }}>⚠</span>
              <span>{error || logoutMessage}</span>
            </div>
          )}

          {/* Username */}
          <div style={{ marginBottom: 16 }}>
            <label className="sv-label">Username</label>
            <div className="sv-input-group">
              <span className="sv-input-icon">◈</span>
              <input className="sv-input" placeholder="your username" value={username}
                onChange={e => setUsername(e.target.value)} onBlur={loadPolicy}
                autoComplete="username" />
            </div>
          </div>

          {/* Password */}
          <div style={{ marginBottom: 6 }}>
            <label className="sv-label">Password</label>
            <div className="sv-input-group">
              <span className="sv-input-icon">◉</span>
              <input type="password" className="sv-input" placeholder="type at natural speed"
                value={password} onChange={handlePasswordChange}
                onKeyDown={handleKeyDown} onKeyUp={handleKeyUp}
                onKeyPress={e => e.key === "Enter" && handleLogin()}
                autoComplete="current-password" />
            </div>
          </div>

          {/* Keystroke bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
            <div className="sv-progress" style={{ flex: 1 }}>
              <div className={`sv-progress-bar${ksOk ? "" : " amber"}`}
                style={{ width: `${Math.min(ksCount / 8 * 100, 100)}%` }} />
            </div>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap",
              color: ksOk ? "var(--green)" : "var(--t3)",
              transition: "color 0.3s",
            }}>
              {ksOk ? `✓ ${ksCount} keys` : `${ksCount} / 4`}
            </span>
          </div>

          {/* Mouse gesture */}
          {enabled.includes("mouse") && (
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <label className="sv-label" style={{ margin: 0 }}>Mouse Gesture</label>
                <span className={`sv-badge ${mouseOk ? "sv-badge-green" : "sv-badge-ghost"}`}>
                  {mouseOk ? "captured" : "draw below"}
                </span>
              </div>
              <canvas ref={canvasRef} width={416} height={110}
                className={`sv-canvas${mouseOk ? " done" : ""}`}
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
                onMouseUp={() => (drawingRef.current = false)} onMouseLeave={() => (drawingRef.current = false)}
                onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={() => (drawingRef.current = false)}
              />
            </div>
          )}

          {/* Air gesture */}
          {enabled.includes("airgesture") && (
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <label className="sv-label" style={{ margin: 0 }}>Air Gesture</label>
                <span className={`sv-badge ${airResult?.ok ? "sv-badge-green" : "sv-badge-ghost"}`}>
                  {airResult?.ok ? "matched" : "pending"}
                </span>
              </div>
              <AirGestureLogin username={username} tracking={policy?.airgesture_tracking || ["one_hand"]}
                onResult={(ok, token) => setAirResult({ ok, token })} />
            </div>
          )}

          {/* Image points */}
          {enabled.includes("imagepoints") && policy?.imagepoints_image_id && (
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <label className="sv-label" style={{ margin: 0 }}>Image Points</label>
                <span className={`sv-badge ${imgResult?.ok ? "sv-badge-green" : "sv-badge-ghost"}`}>
                  {imgResult?.ok ? "matched" : "pending"}
                </span>
              </div>
              <ImagePointsLogin username={username} imageId={policy.imagepoints_image_id}
                pointCount={policy.imagepoints_point_count || 3}
                onResult={(ok, token) => setImgResult({ ok, token })} />
            </div>
          )}

          <hr className="sv-divider" />

          {/* Submit */}
          <button className={`sv-btn sv-btn-primary sv-btn-xl sv-btn-full${loading ? " sv-btn-loading" : ""}`}
            onClick={handleLogin} disabled={loading}>
            {loading ? <><div className="sv-spinner sv-spinner-sm" /> Authenticating...</> : "Authenticate →"}
          </button>

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <span style={{ fontSize: 11, color: "var(--t3)" }}>No account? </span>
            <span onClick={() => onGoSetup?.()}
              style={{ fontSize: 11, color: "var(--green-mid)", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, transition: "color 0.15s" }}
              onMouseEnter={e => e.target.style.color = "var(--green)"}
              onMouseLeave={e => e.target.style.color = "var(--green-mid)"}>
              Create one
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}