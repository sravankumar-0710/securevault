import React from "react";
import { useState, useRef } from "react";
import { AirGestureSetup } from "../components/AirGestureCapture";
import { ImagePointsSetup } from "../components/ImagePointsAuth";

const API = "https://127.0.0.1:5000";

// ── Shared styles ────────────────────────────────────────────
const st = {
  page: {
    minHeight: "100vh",
    background: "#0f1117",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Courier New', monospace",
    padding: "40px 20px",
  },
  card: {
    background: "#16181f",
    border: "1px solid #2a2d3a",
    borderRadius: 12,
    padding: "40px",
    width: "100%",
    maxWidth: 560,
    boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: "#e8e8e8",
    marginBottom: 6,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  subtitle: {
    fontSize: 12,
    color: "#555",
    marginBottom: 32,
    letterSpacing: "0.08em",
  },
  section: { marginBottom: 24 },
  label: {
    display: "block",
    fontSize: 11,
    color: "#666",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  input: {
    width: "100%",
    background: "#0f1117",
    border: "1px solid #2a2d3a",
    borderRadius: 6,
    padding: "10px 14px",
    color: "#e8e8e8",
    fontSize: 14,
    fontFamily: "'Courier New', monospace",
    boxSizing: "border-box",
    outline: "none",
  },
  methodGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 8,
  },
  methodCard: (active, disabled) => ({
    background: active ? "#1a2a1a" : "#0f1117",
    border: `1px solid ${active ? "#3a7a3a" : "#2a2d3a"}`,
    borderRadius: 8,
    padding: "10px 6px",
    cursor: disabled ? "not-allowed" : "pointer",
    textAlign: "center",
    transition: "all 0.15s ease",
    opacity: disabled ? 0.5 : 1,
  }),
  methodIcon: { fontSize: 18, marginBottom: 4 },
  methodLabel: (active) => ({
    fontSize: 10,
    color: active ? "#6dbf6d" : "#555",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  }),
  methodDone: {
    fontSize: 9,
    color: "#3a7a3a",
    marginTop: 3,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  },
  select: {
    width: "100%",
    background: "#0f1117",
    border: "1px solid #2a2d3a",
    borderRadius: 6,
    padding: "10px 14px",
    color: "#e8e8e8",
    fontSize: 13,
    fontFamily: "'Courier New', monospace",
    outline: "none",
    boxSizing: "border-box",
  },
  numberInput: {
    width: "100%",
    background: "#0f1117",
    border: "1px solid #2a2d3a",
    borderRadius: 6,
    padding: "10px 14px",
    color: "#e8e8e8",
    fontSize: 14,
    fontFamily: "'Courier New', monospace",
    outline: "none",
    boxSizing: "border-box",
  },
  canvas: {
    background: "#0a0c10",
    border: "1px solid #2a2d3a",
    borderRadius: 8,
    cursor: "crosshair",
    display: "block",
    width: "100%",
  },
  progressRow: { display: "flex", gap: 8, marginTop: 10 },
  dot: (filled) => ({
    flex: 1,
    height: 4,
    borderRadius: 2,
    background: filled ? "#3a7a3a" : "#2a2d3a",
    transition: "background 0.3s ease",
  }),
  hint: {
    fontSize: 11,
    color: "#444",
    marginTop: 8,
    letterSpacing: "0.06em",
  },
  button: {
    width: "100%",
    padding: "13px",
    background: "#1e3a1e",
    border: "1px solid #3a7a3a",
    borderRadius: 8,
    color: "#6dbf6d",
    fontSize: 13,
    fontFamily: "'Courier New', monospace",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    cursor: "pointer",
  },
  error: {
    background: "#2a1515",
    border: "1px solid #5a2020",
    borderRadius: 6,
    padding: "10px 14px",
    color: "#cf6868",
    fontSize: 12,
    marginBottom: 20,
    letterSpacing: "0.04em",
  },
  success: {
    background: "#152a15",
    border: "1px solid #3a6a3a",
    borderRadius: 6,
    padding: "10px 14px",
    color: "#6dbf6d",
    fontSize: 12,
    marginBottom: 20,
    letterSpacing: "0.04em",
  },
  divider: {
    border: "none",
    borderTop: "1px solid #1e2028",
    margin: "24px 0",
  },
  infoBox: {
    background: "#12151c",
    border: "1px solid #2a2d3a",
    borderRadius: 6,
    padding: "10px 14px",
    fontSize: 11,
    color: "#555",
    letterSpacing: "0.04em",
    marginTop: 8,
  },
};

// ── All available methods ────────────────────────────────────
const ALL_METHODS = [
  { id: "password",    icon: "🔑", label: "Password",   disabled: true  },
  { id: "keystroke",   icon: "⌨",  label: "Keystroke"                   },
  { id: "mouse",       icon: "🖱",  label: "Gesture"                     },
  { id: "airgesture",  icon: "✋",  label: "Air"                         },
  { id: "imagepoints", icon: "🖼",  label: "Image"                       },
];

export default function Setup({ onSuccess }) {

  // ── Core credentials ─────────────────────────────────────
  const [username, setUsername]   = useState("");
  const [password, setPassword]   = useState("");
  const [error, setError]         = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // ── Policy ───────────────────────────────────────────────
  const [enabledMethods, setEnabledMethods] = useState(["password"]);
  const [threshold, setThreshold]           = useState(1);
  const [primary, setPrimary]               = useState("password");

  // ── Keystroke ────────────────────────────────────────────
  const [keystrokeSamples, setKeystrokeSamples] = useState([]);
  const [currentKeystroke, setCurrentKeystroke] = useState([]);
  const keyDownTimesRef = useRef({});

  // ── Mouse gesture ────────────────────────────────────────
  const [mouseSamples, setMouseSamples]     = useState([]);
  const [currentPoints, setCurrentPoints]   = useState([]);
  const [drawing, setDrawing]               = useState(false);
  const canvasRef = useRef(null);

  // ── Air gesture ──────────────────────────────────────────
  // Becomes ready after AirGestureSetup calls onSaved
  // We store it AFTER initial account creation (needs session token)
  const [airGestureReady, setAirGestureReady] = useState(false);
  const [sessionToken, setSessionToken]       = useState(null);
  const [airGestureTracking, setAirGestureTracking] = useState(null);

  // ── Image points ─────────────────────────────────────────
  const [imagePointsReady, setImagePointsReady] = useState(false);

  // ── Step tracking ────────────────────────────────────────
  // "credentials" → "biometrics" → "done"
  const [step, setStep] = useState("credentials");

  // ────────────────────────────────────────────────────────
  // METHOD TOGGLE
  // ────────────────────────────────────────────────────────
  const toggleMethod = (method) => {
    setEnabledMethods(prev => {
      const next = prev.includes(method)
        ? prev.filter(m => m !== method)
        : [...prev, method];
      // Only count methods registered NOW (not air/image which are post-setup)
      const coreCount = next.filter(m => !["airgesture","imagepoints"].includes(m)).length;
      setThreshold(t => Math.min(t, Math.max(1, coreCount)));
      return next;
    });
  };

  // ────────────────────────────────────────────────────────
  // MOUSE GESTURE HANDLERS
  // ────────────────────────────────────────────────────────
  const handleMouseDown = () => {
    setDrawing(true);
    setCurrentPoints([]);
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const handleMouseMove = (e) => {
    if (!drawing) return;
    const rect   = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width  / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top)  * scaleY;
    const ctx = canvasRef.current.getContext("2d");
    const newPoints = [...currentPoints, [x, y]];
    if (newPoints.length > 1) {
      const prev = newPoints[newPoints.length - 2];
      ctx.strokeStyle = "#3a7a3a";
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(prev[0], prev[1]);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    setCurrentPoints(newPoints);
  };

  const handleMouseUp = () => {
    setDrawing(false);
    if (currentPoints.length > 5 && mouseSamples.length < 3) {
      setMouseSamples(prev => [...prev, currentPoints]);
    }
    setCurrentPoints([]);
  };

  // ────────────────────────────────────────────────────────
  // KEYSTROKE HANDLERS
  // ────────────────────────────────────────────────────────
  const handleKeyDown = (e) => {
    keyDownTimesRef.current[e.key] = Date.now();
  };

  const handleKeyUp = (e) => {
    const upTime   = Date.now();
    const downTime = keyDownTimesRef.current[e.key];
    if (!downTime) return;
    const dwell = upTime - downTime;
    if (dwell > 0) {
      setCurrentKeystroke(prev => [
        ...prev,
        { key: e.key, down: downTime, up: upTime, dwell }
      ]);
    }
    delete keyDownTimesRef.current[e.key];
  };

  const handlePasswordBlur = () => {
    if (currentKeystroke.length > 0 && keystrokeSamples.length < 3) {
      setKeystrokeSamples(prev => [...prev, currentKeystroke]);
      setCurrentKeystroke([]);
    }
  };

  // ────────────────────────────────────────────────────────
  // STEP 1 — Create account (password + mouse + keystroke)
  // Air gesture and image points are set up AFTER login
  // because they need a session token
  // ────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setError("");
    setSuccessMsg("");

    if (!username || !password) {
      setError("Username and password are required");
      return;
    }

    if (enabledMethods.includes("mouse") && mouseSamples.length < 3) {
      setError("Draw your gesture 3 times to register it");
      return;
    }

    if (enabledMethods.includes("keystroke") && keystrokeSamples.length < 1) {
      setError("Type your password and click away from the field to save your keystroke profile");
      return;
    }

    try {
      const res = await fetch(`${API}/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          mouse_samples:     enabledMethods.includes("mouse")     ? mouseSamples      : null,
          keystroke_samples: enabledMethods.includes("keystroke") ? keystrokeSamples  : null,
          // Air gesture and image points are registered post-login
          enabled:   enabledMethods.filter(m => !["airgesture","imagepoints"].includes(m)),
          threshold: threshold,
          primary:   primary === "airgesture" || primary === "imagepoints" ? "password" : primary,
        })
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      // If air gesture or image points are selected, go to step 2
      // We store the password and use it to get a session token for step 2
      if (enabledMethods.includes("airgesture") || enabledMethods.includes("imagepoints")) {
        // Build the correct login payload — include biometrics that were just registered
        const loginPayload = { username, password, keystroke: [], mouse: [] };

        // Include keystroke data if it was registered (use first sample)
        if (enabledMethods.includes("keystroke") && keystrokeSamples.length > 0) {
          loginPayload.keystroke = keystrokeSamples[0];
        }

        // Include mouse data if it was registered (use last drawn gesture)
        if (enabledMethods.includes("mouse") && mouseSamples.length > 0) {
          loginPayload.mouse = mouseSamples[mouseSamples.length - 1];
        }

        const loginRes = await fetch(`${API}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(loginPayload)
        });
        const loginData = await loginRes.json();

        if (loginData.session_token) {
          setSessionToken(loginData.session_token);
          setStep("biometrics");
          setSuccessMsg("Account created — now register your remaining methods below");
        } else {
          // Login failed — show error but account was created, user can log in manually
          console.error("Auto-login failed:", loginData);
          setError("Account created but auto-login failed: " + (loginData.error || "unknown error") + ". Please log in manually to set up remaining methods.");
        }
      } else {
        setSuccessMsg("Account created — you can now log in");
        setTimeout(() => onSuccess && onSuccess(), 1500);
      }

    } catch {
      setError("Could not reach server");
    }
  };

  // ────────────────────────────────────────────────────────
  // STEP 2 — Register air gesture / image points
  // Called when both optional biometrics are done
  // ────────────────────────────────────────────────────────
  const handleBiometricsDone = () => {
    setSuccessMsg("All methods registered — redirecting to login");
    setTimeout(() => onSuccess && onSuccess(), 1500);
  };

  const needsAir    = enabledMethods.includes("airgesture");
  const needsImg    = enabledMethods.includes("imagepoints");
  const biometricsDone =
    (!needsAir || airGestureReady) &&
    (!needsImg || imagePointsReady);

  // ────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────
  return (
    <div style={st.page}>
      <div style={st.card}>

        <div style={st.title}>Create Account</div>
        <div style={st.subtitle}>SecureVault — Multi-Factor Registration</div>

        {error      && <div style={st.error}>{error}</div>}
        {successMsg && <div style={st.success}>{successMsg}</div>}

        {/* ── STEP 1: Credentials + policy ── */}
        {step === "credentials" && (<>

          {/* Username */}
          <div style={st.section}>
            <label style={st.label}>Username</label>
            <input
              style={st.input}
              placeholder="enter username"
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
          </div>

          {/* Password */}
          <div style={st.section}>
            <label style={st.label}>Password</label>
            <input
              type="password"
              style={st.input}
              placeholder="type naturally — keystroke rhythm is captured"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onBlur={handlePasswordBlur}
            />
            {enabledMethods.includes("keystroke") && (
              <div style={st.hint}>
                Keystroke samples: {keystrokeSamples.length} — click away from field to save
              </div>
            )}
          </div>

          <hr style={st.divider} />

          {/* Method selection */}
          <div style={st.section}>
            <label style={st.label}>Authentication Methods</label>
            <div style={st.methodGrid}>
              {ALL_METHODS.map(m => (
                <div
                  key={m.id}
                  style={st.methodCard(enabledMethods.includes(m.id), m.disabled)}
                  onClick={() => !m.disabled && toggleMethod(m.id)}
                >
                  <div style={st.methodIcon}>{m.icon}</div>
                  <div style={st.methodLabel(enabledMethods.includes(m.id))}>{m.label}</div>
                  {m.disabled && <div style={{ fontSize: 9, color: "#444", marginTop: 2 }}>required</div>}
                  {(m.id === "airgesture" || m.id === "imagepoints") && enabledMethods.includes(m.id) && (
                    <div style={st.methodDone}>setup after</div>
                  )}
                </div>
              ))}
            </div>
            {(enabledMethods.includes("airgesture") || enabledMethods.includes("imagepoints")) && (
              <div style={st.infoBox}>
                ✋ Air gesture and 🖼 Image points require camera/image setup after initial account creation.
                You will be guided through this automatically.
              </div>
            )}
          </div>

          {/* Threshold + Primary */}
          <div style={{ ...st.section, ...st.row }}>
            <div>
              <label style={st.label}>Required Methods</label>
              <input
                type="number"
                style={st.numberInput}
                min={1}
                max={enabledMethods.filter(m => !["airgesture","imagepoints"].includes(m)).length}
                value={threshold}
                onChange={e => {
                  const max = enabledMethods.filter(m => !["airgesture","imagepoints"].includes(m)).length;
                  setThreshold(Math.min(Math.max(1, Number(e.target.value)), max));
                }}
              />
              <div style={st.hint}>
                {threshold} of {enabledMethods.filter(m => !["airgesture","imagepoints"].includes(m)).length} core methods must pass
                {(enabledMethods.includes("airgesture") || enabledMethods.includes("imagepoints")) &&
                  <span style={{color: "#3a5a3a"}}> (air/image verified separately)</span>}
              </div>
            </div>
            <div>
              <label style={st.label}>Primary Method</label>
              <select
                style={st.select}
                value={primary}
                onChange={e => setPrimary(e.target.value)}
              >
                {enabledMethods.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <hr style={st.divider} />

          {/* Mouse gesture */}
          {enabledMethods.includes("mouse") && (
            <div style={st.section}>
              <label style={st.label}>
                Register Gesture — {3 - mouseSamples.length} more time{3 - mouseSamples.length !== 1 ? "s" : ""}
              </label>
              <canvas
                ref={canvasRef}
                width={460}
                height={160}
                style={st.canvas}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => setDrawing(false)}
              />
              <div style={st.progressRow}>
                {[0,1,2].map(i => <div key={i} style={st.dot(i < mouseSamples.length)} />)}
              </div>
              <div style={st.hint}>Draw the same gesture 3 times</div>
            </div>
          )}

          <button
            style={st.button}
            onClick={handleSubmit}
            onMouseOver={e => e.currentTarget.style.background = "#243a24"}
            onMouseOut={e  => e.currentTarget.style.background = "#1e3a1e"}
          >
            Create Account
          </button>

        </>)}

        {/* ── STEP 2: Post-login biometric registration ── */}
        {step === "biometrics" && (<>

          {needsAir && !airGestureReady && (
            <div style={st.section}>
              <AirGestureSetup
                username={username}
                sessionToken={sessionToken}
                onSaved={(tracking) => {
                  setAirGestureTracking(tracking);
                  setAirGestureReady(true);
                }}
              />
            </div>
          )}

          {needsImg && !imagePointsReady && (
            <div style={st.section}>
              <ImagePointsSetup
                sessionToken={sessionToken}
                onSaved={() => setImagePointsReady(true)}
              />
            </div>
          )}

          {biometricsDone && (
            <button
              style={st.button}
              onClick={handleBiometricsDone}
            >
              Continue to Login
            </button>
          )}

        </>)}

      </div>
    </div>
  );
}