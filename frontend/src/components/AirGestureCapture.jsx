import React from "react";
import { useState, useRef, useEffect, useCallback } from "react";

const WS_BASE = "wss://127.0.0.1:5000";

const TRACKING_OPTIONS = [
  { id: "one_hand",  label: "One Hand",       icon: "✋" },
  { id: "two_hands", label: "Two Hands",       icon: "🙌" },
  { id: "face",      label: "Face",            icon: "😐" },
];

const s = {
  wrap: {
    background: "#16181f",
    border: "1px solid #2a2d3a",
    borderRadius: 10,
    padding: 24,
    fontFamily: "'Courier New', monospace",
  },
  label: {
    fontSize: 11,
    color: "#666",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    display: "block",
    marginBottom: 10,
  },
  trackingRow: {
    display: "flex",
    gap: 8,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  trackBtn: (active) => ({
    padding: "8px 14px",
    background: active ? "#1e3a1e" : "#0f1117",
    border: `1px solid ${active ? "#3a7a3a" : "#2a2d3a"}`,
    borderRadius: 6,
    color: active ? "#6dbf6d" : "#555",
    fontSize: 12,
    fontFamily: "'Courier New', monospace",
    cursor: "pointer",
    letterSpacing: "0.06em",
  }),
  videoWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "4/3",
    background: "#0a0c10",
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 12,
  },
  video: {
    position: "absolute",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)", // mirror
    opacity: 0,              // hidden — we show the annotated canvas
  },
  canvas: {
    position: "absolute",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)",
  },
  overlay: {
    position: "absolute",
    top: 10,
    left: 10,
    background: "rgba(0,0,0,0.6)",
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 11,
    color: "#6dbf6d",
    letterSpacing: "0.08em",
  },
  progress: {
    display: "flex",
    gap: 6,
    marginBottom: 12,
  },
  dot: (filled) => ({
    flex: 1,
    height: 4,
    borderRadius: 2,
    background: filled ? "#3a7a3a" : "#2a2d3a",
    transition: "background 0.3s",
  }),
  btnRow: {
    display: "flex",
    gap: 10,
    marginBottom: 12,
  },
  btn: (color) => ({
    flex: 1,
    padding: "10px",
    background: color === "green" ? "#1e3a1e" : color === "red" ? "#3a1e1e" : "#1a1c24",
    border: `1px solid ${color === "green" ? "#3a7a3a" : color === "red" ? "#7a3a3a" : "#2a2d3a"}`,
    borderRadius: 6,
    color: color === "green" ? "#6dbf6d" : color === "red" ? "#cf6868" : "#888",
    fontSize: 12,
    fontFamily: "'Courier New', monospace",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
  }),
  status: (ok) => ({
    fontSize: 12,
    color: ok ? "#6dbf6d" : "#cf6868",
    letterSpacing: "0.05em",
    marginTop: 6,
    minHeight: 18,
  }),
  hint: {
    fontSize: 11,
    color: "#444",
    letterSpacing: "0.05em",
    marginTop: 4,
  },
};

// ─────────────────────────────────────────────────────────────
// SETUP MODE — records 3 samples
// ─────────────────────────────────────────────────────────────

export function AirGestureSetup({ username, sessionToken, onSaved }) {

  const [tracking, setTracking]     = useState(["one_hand"]);
  const [sampleCount, setSampleCount] = useState(0);
  const [recording, setRecording]   = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [status, setStatus]         = useState("");
  const [camReady, setCamReady]     = useState(false);

  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const wsRef      = useRef(null);
  const streamRef  = useRef(null);
  const intervalRef = useRef(null);

  // ── Start webcam ─────────────────────────────────────────
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCamReady(true);

        // Open WebSocket
        const ws = new WebSocket(`${WS_BASE}/ws/airgesture/setup`);
        ws.onopen = () => setStatus("Camera ready — configure tracking then record");
        ws.onmessage = (e) => handleWsMessage(JSON.parse(e.data));
        ws.onerror = () => setStatus("WebSocket error");
        wsRef.current = ws;
      })
      .catch(() => setStatus("Camera access denied"));

    return () => {
      stopAll();
    };
  }, []);

  const stopAll = () => {
    clearInterval(intervalRef.current);
    if (wsRef.current) wsRef.current.close();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
  };

  const handleWsMessage = (data) => {
    if (data.annotated) {
      // Draw annotated frame on canvas
      const img = new Image();
      img.onload = () => {
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) ctx.drawImage(img, 0, 0, canvasRef.current.width, canvasRef.current.height);
      };
      img.src = "data:image/jpeg;base64," + data.annotated;
    }
    if (data.frame_count !== undefined) setFrameCount(data.frame_count);
    if (data.status === "sample_saved") {
      setSampleCount(data.sample_count);
      setStatus(`Sample ${data.sample_count}/3 saved — ${3 - data.sample_count} more to go`);
    }
    if (data.status === "saved") {
      setStatus("Air gesture profile saved!");
      stopAll();
      onSaved && onSaved(tracking);
    }
    if (data.error) setStatus("Error: " + data.error);
  };

  const toggleTracking = (id) => {
    setTracking(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    // Cap at 320x240 — MediaPipe works fine at this resolution
    // and it drastically reduces WebSocket payload size
    const W = 320, H = 240;
    const canvas = document.createElement("canvas");
    canvas.width  = W;
    canvas.height = H;
    canvas.getContext("2d").drawImage(video, 0, 0, W, H);
    return canvas.toDataURL("image/jpeg", 0.4).split(",")[1];
  }, []);

  const startRecording = () => {
    if (sampleCount >= 3) return;
    wsRef.current.send(JSON.stringify({
      action: "start", username, tracking, sample_index: sampleCount
    }));
    setRecording(true);
    setFrameCount(0);
    setStatus("Recording... perform your gesture");

    intervalRef.current = setInterval(() => {
      const frame = captureFrame();
      wsRef.current?.send(JSON.stringify({ action: "frame", frame, tracking }));
    }, 160); // 6fps — enough for gesture capture, much lighter than 10fps
  };

  const stopRecording = () => {
    clearInterval(intervalRef.current);
    setRecording(false);
    wsRef.current?.send(JSON.stringify({ action: "stop" }));
    setStatus("Processing sample...");
  };

  const saveProfile = () => {
    if (sampleCount < 2) {
      setStatus("Need at least 2 samples");
      return;
    }
    wsRef.current?.send(JSON.stringify({
      action: "save", username, tracking, session_token: sessionToken
    }));
    setStatus("Saving profile...");
  };

  return (
    <div style={s.wrap}>
      <span style={s.label}>Air Gesture — Register</span>

      {/* Tracking selector */}
      <div style={s.trackingRow}>
        {TRACKING_OPTIONS.map(opt => (
          <button
            key={opt.id}
            style={s.trackBtn(tracking.includes(opt.id))}
            onClick={() => toggleTracking(opt.id)}
          >
            {opt.icon} {opt.label}
          </button>
        ))}
      </div>

      {/* Video feed */}
      <div style={s.videoWrap}>
        <video ref={videoRef} style={s.video} muted playsInline />
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          style={s.canvas}
        />
        {recording && (
          <div style={s.overlay}>
            ● REC — {frameCount} frames
          </div>
        )}
      </div>

      {/* Sample progress */}
      <div style={s.progress}>
        {[0, 1, 2].map(i => (
          <div key={i} style={s.dot(i < sampleCount)} />
        ))}
      </div>

      {/* Controls */}
      <div style={s.btnRow}>
        {!recording ? (
          <button
            style={s.btn("green")}
            onClick={startRecording}
            disabled={!camReady || sampleCount >= 3}
          >
            ● Record Sample {sampleCount + 1}
          </button>
        ) : (
          <button style={s.btn("red")} onClick={stopRecording}>
            ■ Stop Recording
          </button>
        )}
        <button
          style={s.btn("green")}
          onClick={saveProfile}
          disabled={sampleCount < 2}
        >
          ✓ Save Profile
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

// ─────────────────────────────────────────────────────────────
// LOGIN MODE — records gesture and verifies
// ─────────────────────────────────────────────────────────────

export function AirGestureLogin({ username, tracking, onResult }) {

  const [recording, setRecording]   = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [status, setStatus]         = useState("");
  const [camReady, setCamReady]     = useState(false);

  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const wsRef       = useRef(null);
  const streamRef   = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCamReady(true);

        const ws = new WebSocket(`${WS_BASE}/ws/airgesture/login`);
        ws.onopen  = () => setStatus("Camera ready — perform your gesture");
        ws.onmessage = (e) => handleWsMessage(JSON.parse(e.data));
        ws.onerror = () => setStatus("WebSocket error");
        wsRef.current = ws;
      })
      .catch(() => setStatus("Camera access denied"));

    return () => {
      clearInterval(intervalRef.current);
      if (wsRef.current) wsRef.current.close();
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleWsMessage = (data) => {
    if (data.annotated) {
      const img = new Image();
      img.onload = () => {
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) ctx.drawImage(img, 0, 0, canvasRef.current.width, canvasRef.current.height);
      };
      img.src = "data:image/jpeg;base64," + data.annotated;
    }
    if (data.frame_count !== undefined) setFrameCount(data.frame_count);
    if (data.result === "success") {
      setStatus("Gesture matched!");
      onResult && onResult(true, data.unlock_token);
    }
    if (data.result === "fail") {
      setStatus("Gesture mismatch — try again");
      onResult && onResult(false, null);
    }
    if (data.error) setStatus("Error: " + data.error);
  };

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const W = 320, H = 240;
    const canvas = document.createElement("canvas");
    canvas.width  = W;
    canvas.height = H;
    canvas.getContext("2d").drawImage(video, 0, 0, W, H);
    return canvas.toDataURL("image/jpeg", 0.4).split(",")[1];
  }, []);

  const startRecording = () => {
    wsRef.current?.send(JSON.stringify({ action: "start", username, tracking }));
    setRecording(true);
    setFrameCount(0);
    setStatus("Recording gesture...");

    intervalRef.current = setInterval(() => {
      const frame = captureFrame();
      wsRef.current?.send(JSON.stringify({ action: "frame", frame }));
    }, 160); // 6fps
  };

  const stopAndVerify = () => {
    clearInterval(intervalRef.current);
    setRecording(false);
    setStatus("Verifying...");
    wsRef.current?.send(JSON.stringify({ action: "verify", username, tracking }));
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
        {recording && (
          <div style={s.overlay}>● REC — {frameCount} frames</div>
        )}
      </div>

      <div style={s.btnRow}>
        {!recording ? (
          <button
            style={s.btn("green")}
            onClick={startRecording}
            disabled={!camReady}
          >
            ● Start Gesture
          </button>
        ) : (
          <button style={s.btn("red")} onClick={stopAndVerify}>
            ■ Stop + Verify
          </button>
        )}
      </div>

      <div style={s.status(status.includes("matched"))}>
        {status}
      </div>
    </div>
  );
}
