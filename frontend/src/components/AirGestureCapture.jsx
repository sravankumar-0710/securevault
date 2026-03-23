import { useState, useRef, useEffect, useCallback } from "react";

const API = "https://securevault-production.up.railway.app";

const TRACKING_OPTIONS = [
  { id: "one_hand",  label: "One Hand",  icon: "✋" },
  { id: "two_hands", label: "Two Hands", icon: "🤲" },
  { id: "face",      label: "Face",      icon: "😐" },
];

const s = {
  wrap: {
    background: "#16181f", border: "1px solid #2a2d3a",
    borderRadius: 10, padding: 24, fontFamily: "'Courier New', monospace",
  },
  label: {
    fontSize: 11, color: "#666", letterSpacing: "0.12em",
    textTransform: "uppercase", display: "block", marginBottom: 10,
  },
  trackingRow: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  trackBtn: (active) => ({
    padding: "8px 14px",
    background: active ? "#1e3a1e" : "#0f1117",
    border: `1px solid ${active ? "#3a7a3a" : "#2a2d3a"}`,
    borderRadius: 6, color: active ? "#6dbf6d" : "#555",
    fontSize: 12, fontFamily: "'Courier New', monospace",
    cursor: "pointer", letterSpacing: "0.06em",
  }),
  videoWrap: {
    position: "relative", width: "100%", aspectRatio: "4/3",
    background: "#0a0c10", borderRadius: 8, overflow: "hidden", marginBottom: 12,
  },
  video: {
    position: "absolute", width: "100%", height: "100%",
    objectFit: "cover", transform: "scaleX(-1)", opacity: 0,
  },
  canvas: {
    position: "absolute", width: "100%", height: "100%",
    objectFit: "cover", transform: "scaleX(-1)",
  },
  overlay: {
    position: "absolute", top: 10, left: 10,
    background: "rgba(0,0,0,0.6)", borderRadius: 4,
    padding: "4px 10px", fontSize: 11, color: "#6dbf6d", letterSpacing: "0.08em",
  },
  progress: { display: "flex", gap: 6, marginBottom: 12 },
  dot: (filled) => ({
    flex: 1, height: 4, borderRadius: 2,
    background: filled ? "#3a7a3a" : "#2a2d3a", transition: "background 0.3s",
  }),
  btnRow: { display: "flex", gap: 10, marginBottom: 12 },
  btn: (color) => ({
    flex: 1, padding: "10px",
    background: color === "green" ? "#1e3a1e" : color === "red" ? "#3a1e1e" : "#1a1c24",
    border: `1px solid ${color === "green" ? "#3a7a3a" : color === "red" ? "#7a3a3a" : "#2a2d3a"}`,
    borderRadius: 6,
    color: color === "green" ? "#6dbf6d" : color === "red" ? "#cf6868" : "#888",
    fontSize: 12, fontFamily: "'Courier New', monospace",
    letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
  }),
  status: (ok) => ({
    fontSize: 12, color: ok ? "#6dbf6d" : "#cf6868",
    letterSpacing: "0.05em", marginTop: 6, minHeight: 18,
  }),
  hint: { fontSize: 11, color: "#444", letterSpacing: "0.05em", marginTop: 4 },
};

// ── SETUP MODE ────────────────────────────────────────────────────────────────

export function AirGestureSetup({ username, sessionToken, onSaved }) {
  const [tracking,     setTracking]     = useState(["one_hand"]);
  const [sampleCount,  setSampleCount]  = useState(0);
  const [recording,    setRecording]    = useState(false);
  const [frameCount,   setFrameCount]   = useState(0);
  const [status,       setStatus]       = useState("");
  const [camReady,     setCamReady]     = useState(false);
  const [saving,       setSaving]       = useState(false);

  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const streamRef   = useRef(null);
  const intervalRef = useRef(null);
  const samplesRef  = useRef([]);      // [{landmarks},...] per sample
  const framesBuf   = useRef([]);      // frames being recorded
  const lastAnnot   = useRef(null);    // last annotated frame to display

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCamReady(true);
        setStatus("Camera ready — configure tracking then record");
      })
      .catch(() => setStatus("Camera access denied"));

    return () => {
      clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;
    const W = 320, H = 240;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    c.getContext("2d").drawImage(video, 0, 0, W, H);
    return c.toDataURL("image/jpeg", 0.4).split(",")[1];
  }, []);

  const drawAnnotated = (b64) => {
    if (!b64 || !canvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, canvasRef.current.width, canvasRef.current.height);
    };
    img.src = "data:image/jpeg;base64," + b64;
  };

  // Send a batch of frames to backend every 500ms while recording
  const flushBatch = useCallback(async () => {
    if (framesBuf.current.length === 0) return;
    const batch = framesBuf.current.splice(0);
    try {
      const res = await fetch(`${API}/airgesture/frames`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: sessionToken },
        body: JSON.stringify({ frames: batch, tracking }),
      });
      const data = await res.json();
      if (data.annotated) drawAnnotated(data.annotated);
      if (data.landmarks?.length) {
        // Append landmarks to current sample buffer
        samplesRef.current[samplesRef.current.length - 1].push(...data.landmarks);
        setFrameCount(samplesRef.current[samplesRef.current.length - 1].length);
      }
    } catch { /* ignore flush errors */ }
  }, [tracking, sessionToken]);

  const startRecording = () => {
    if (sampleCount >= 3) return;
    samplesRef.current.push([]);           // new sample slot
    framesBuf.current = [];
    setFrameCount(0);
    setRecording(true);
    setStatus("Recording... perform your gesture");

    // Capture frames at 6fps
    intervalRef.current = setInterval(() => {
      const f = captureFrame();
      if (f) framesBuf.current.push(f);
      // Flush every ~500ms (3 frames at 6fps)
      if (framesBuf.current.length >= 3) flushBatch();
    }, 160);
  };

  const stopRecording = async () => {
    clearInterval(intervalRef.current);
    setRecording(false);
    // Flush remaining frames
    await flushBatch();
    const currentSample = samplesRef.current[samplesRef.current.length - 1];
    if (currentSample.length < 5) {
      samplesRef.current.pop();
      setStatus("Too few frames — move more slowly and try again");
      return;
    }
    const count = samplesRef.current.length;
    setSampleCount(count);
    setStatus(`Sample ${count}/3 saved — ${Math.max(0, 2 - count)} more needed`);
  };

  const saveProfile = async () => {
    if (samplesRef.current.length < 2) {
      setStatus("Need at least 2 samples"); return;
    }
    setSaving(true);
    setStatus("Saving profile...");
    try {
      const res = await fetch(`${API}/airgesture/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: sessionToken },
        body: JSON.stringify({
          tracking,
          samples: samplesRef.current,
          session_token: sessionToken,
        }),
      });
      const data = await res.json();
      if (data.error) { setStatus("Error: " + data.error); setSaving(false); return; }
      setStatus("Air gesture profile saved!");
      streamRef.current?.getTracks().forEach(t => t.stop());
      onSaved && onSaved(tracking);
    } catch {
      setStatus("Could not reach server");
      setSaving(false);
    }
  };

  const toggleTracking = (id) =>
    setTracking(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);

  return (
    <div style={s.wrap}>
      <span style={s.label}>Air Gesture — Register</span>

      <div style={s.trackingRow}>
        {TRACKING_OPTIONS.map(opt => (
          <button key={opt.id} style={s.trackBtn(tracking.includes(opt.id))}
            onClick={() => toggleTracking(opt.id)}>
            {opt.icon} {opt.label}
          </button>
        ))}
      </div>

      <div style={s.videoWrap}>
        <video ref={videoRef} style={s.video} muted playsInline />
        <canvas ref={canvasRef} width={640} height={480} style={s.canvas} />
        {recording && <div style={s.overlay}>⏺ REC — {frameCount} frames</div>}
      </div>

      <div style={s.progress}>
        {[0, 1, 2].map(i => <div key={i} style={s.dot(i < sampleCount)} />)}
      </div>

      <div style={s.btnRow}>
        {!recording ? (
          <button style={s.btn("green")} onClick={startRecording}
            disabled={!camReady || sampleCount >= 3 || saving}>
            ⏺ Record Sample {sampleCount + 1}
          </button>
        ) : (
          <button style={s.btn("red")} onClick={stopRecording}>
            ⏹ Stop Recording
          </button>
        )}
        <button style={s.btn("green")} onClick={saveProfile}
          disabled={sampleCount < 2 || saving}>
          {saving ? "Saving..." : "✓ Save Profile"}
        </button>
      </div>

      <div style={s.status(status.includes("saved") || status.includes("ready"))}>
        {status}
      </div>
      <div style={s.hint}>
        Tracking: {tracking.join(" + ")} — perform the same gesture each time
      </div>
    </div>
  );
}

// ── LOGIN MODE ────────────────────────────────────────────────────────────────

export function AirGestureLogin({ username, tracking, onResult }) {
  const [recording,  setRecording]  = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [status,     setStatus]     = useState("");
  const [camReady,   setCamReady]   = useState(false);

  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const streamRef   = useRef(null);
  const intervalRef = useRef(null);
  const framesBuf   = useRef([]);
  const landmarkBuf = useRef([]);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCamReady(true);
        setStatus("Camera ready — perform your gesture");
      })
      .catch(() => setStatus("Camera access denied"));

    return () => {
      clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;
    const W = 320, H = 240;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    c.getContext("2d").drawImage(video, 0, 0, W, H);
    return c.toDataURL("image/jpeg", 0.4).split(",")[1];
  }, []);

  const drawAnnotated = (b64) => {
    if (!b64 || !canvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, canvasRef.current.width, canvasRef.current.height);
    };
    img.src = "data:image/jpeg;base64," + b64;
  };

  const startRecording = () => {
    framesBuf.current   = [];
    landmarkBuf.current = [];
    setFrameCount(0);
    setRecording(true);
    setStatus("Recording gesture...");

    intervalRef.current = setInterval(() => {
      const f = captureFrame();
      if (f) framesBuf.current.push(f);
    }, 160);
  };

  const stopAndVerify = async () => {
    clearInterval(intervalRef.current);
    setRecording(false);
    setStatus("Processing...");

    // First extract landmarks from all captured frames
    try {
      const extractRes = await fetch(`${API}/airgesture/frames`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames: framesBuf.current, tracking: tracking || ["one_hand"] }),
      });
      const extractData = await extractRes.json();
      if (extractData.annotated) drawAnnotated(extractData.annotated);

      const frames = extractData.landmarks || [];
      if (frames.length < 5) {
        setStatus("Too few frames — perform gesture more slowly");
        onResult && onResult(false, null);
        return;
      }

      setStatus("Verifying...");
      const verifyRes = await fetch(`${API}/airgesture/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, tracking: tracking || ["one_hand"], frames }),
      });
      const verifyData = await verifyRes.json();

      if (verifyData.result === "success") {
        setStatus("Gesture matched!");
        streamRef.current?.getTracks().forEach(t => t.stop());
        onResult && onResult(true, verifyData.unlock_token);
      } else {
        setStatus("Gesture mismatch — try again");
        onResult && onResult(false, null);
      }
    } catch {
      setStatus("Could not reach server");
      onResult && onResult(false, null);
    }
  };

  return (
    <div style={s.wrap}>
      <span style={s.label}>Air Gesture — Authenticate</span>
      <div style={{ ...s.hint, marginBottom: 10 }}>
        Tracking: {(tracking || []).join(" + ")}
      </div>

      <div style={s.videoWrap}>
        <video ref={videoRef} style={s.video} muted playsInline />
        <canvas ref={canvasRef} width={640} height={480} style={s.canvas} />
        {recording && <div style={s.overlay}>⏺ REC — {frameCount} frames</div>}
      </div>

      <div style={s.btnRow}>
        {!recording ? (
          <button style={s.btn("green")} onClick={startRecording} disabled={!camReady}>
            ⏺ Start Gesture
          </button>
        ) : (
          <button style={s.btn("red")} onClick={stopAndVerify}>
            ⏹ Stop + Verify
          </button>
        )}
      </div>

      <div style={s.status(status.includes("matched"))}>
        {status}
      </div>
    </div>
  );
}