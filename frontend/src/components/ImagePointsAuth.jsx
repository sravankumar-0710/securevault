import React from "react";
import { useState, useRef, useEffect } from "react";

const API = "https://127.0.0.1:5000";

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
    marginBottom: 12,
  },
  imageGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 8,
    marginBottom: 16,
  },
  imgThumb: (selected) => ({
    width: "100%",
    aspectRatio: "4/3",
    objectFit: "cover",
    borderRadius: 6,
    border: `2px solid ${selected ? "#3a7a3a" : "#2a2d3a"}`,
    cursor: "pointer",
    transition: "border 0.15s",
  }),
  imageWrap: {
    position: "relative",
    width: "100%",
    userSelect: "none",
    marginBottom: 12,
    borderRadius: 8,
    overflow: "hidden",
    border: "1px solid #2a2d3a",
    cursor: "crosshair",
  },
  image: {
    display: "block",
    width: "100%",
  },
  dot: (index, x, y) => ({
    position: "absolute",
    left: `${x * 100}%`,
    top:  `${y * 100}%`,
    transform: "translate(-50%, -50%)",
    width: 22,
    height: 22,
    borderRadius: "50%",
    background: "#1e3a1e",
    border: "2px solid #6dbf6d",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    color: "#6dbf6d",
    fontFamily: "'Courier New', monospace",
    pointerEvents: "none",
    boxShadow: "0 0 8px rgba(61,180,61,0.4)",
  }),
  row: {
    display: "flex",
    gap: 10,
    marginBottom: 12,
    alignItems: "center",
  },
  input: {
    background: "#0f1117",
    border: "1px solid #2a2d3a",
    borderRadius: 6,
    padding: "8px 12px",
    color: "#e8e8e8",
    fontSize: 13,
    fontFamily: "'Courier New', monospace",
    width: 80,
    outline: "none",
  },
  btn: (color) => ({
    padding: "9px 18px",
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
  hint: {
    fontSize: 11,
    color: "#444",
    letterSpacing: "0.05em",
    marginTop: 4,
  },
  status: (ok) => ({
    fontSize: 12,
    color: ok ? "#6dbf6d" : "#cf6868",
    letterSpacing: "0.05em",
    minHeight: 18,
    marginTop: 6,
  }),
  uploadLabel: {
    display: "inline-block",
    padding: "8px 14px",
    background: "#1a1c24",
    border: "1px solid #2a2d3a",
    borderRadius: 6,
    color: "#888",
    fontSize: 12,
    fontFamily: "'Courier New', monospace",
    cursor: "pointer",
    letterSpacing: "0.06em",
  },
  divider: {
    border: "none",
    borderTop: "1px solid #1e2028",
    margin: "16px 0",
  },
};

// ─────────────────────────────────────────────────────────────
// SETUP MODE
// ─────────────────────────────────────────────────────────────

export function ImagePointsSetup({ sessionToken, onSaved }) {

  const [builtinImages, setBuiltinImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);  // { id, url }
  const [points, setPoints]               = useState([]);
  const [tolerance, setTolerance]         = useState(5);     // percentage
  const [status, setStatus]               = useState("");
  const [loading, setLoading]             = useState(false);
  const imgRef = useRef(null);

  // Load built-in images
  useEffect(() => {
    fetch(`${API}/imagepoints/images`)
      .then(r => r.json())
      .then(d => setBuiltinImages(d.images || []))
      .catch(() => setBuiltinImages([]));
  }, []);

  // Handle click on image → record point as percentage
  const handleImageClick = (e) => {
    if (!selectedImage) return;

    const rect = imgRef.current.getBoundingClientRect();
    const x    = (e.clientX - rect.left)  / rect.width;
    const y    = (e.clientY - rect.top)   / rect.height;

    setPoints(prev => [...prev, { x, y }]);
  };

  const undoPoint = () => setPoints(prev => prev.slice(0, -1));
  const clearPoints = () => setPoints([]);

  // Upload custom image
  const handleUploadImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append("image", file);

    try {
      const res  = await fetch(`${API}/imagepoints/upload-image`, {
        method: "POST",
        headers: { Authorization: sessionToken },
        body: formData
      });
      const data = await res.json();

      if (data.error) {
        setStatus("Upload error: " + data.error);
      } else {
        setSelectedImage({ id: data.image_id, url: data.url });
        setPoints([]);
        setStatus("Image uploaded — now click your points");
      }
    } catch {
      setStatus("Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedImage) { setStatus("Select an image first"); return; }
    if (points.length < 2) { setStatus("Click at least 2 points on the image"); return; }

    setLoading(true);
    setStatus("");

    try {
      const res  = await fetch(`${API}/imagepoints/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  sessionToken
        },
        body: JSON.stringify({
          points:    points,
          image_id:  selectedImage.id,
          tolerance: tolerance / 100   // convert % to 0-1
        })
      });
      const data = await res.json();

      if (data.error) {
        setStatus("Error: " + data.error);
      } else {
        setStatus("Image points profile saved!");
        onSaved && onSaved(selectedImage.id);
      }
    } catch {
      setStatus("Could not reach server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.wrap}>
      <span style={s.label}>Image Points — Register</span>

      {/* Built-in image grid */}
      <span style={{ ...s.label, marginBottom: 8 }}>Choose an image</span>
      {builtinImages.length > 0 ? (
        <div style={s.imageGrid}>
          {builtinImages.map(img => (
            <img
              key={img.id}
              src={img.url}
              alt={img.id}
              style={s.imgThumb(selectedImage?.id === img.id)}
              onClick={() => { setSelectedImage(img); setPoints([]); }}
            />
          ))}
        </div>
      ) : (
        <div style={{
          background: "#0f1117", border: "1px dashed #2a2d3a", borderRadius: 8,
          padding: "16px", fontSize: 11, color: "#444", marginBottom: 12,
          letterSpacing: "0.06em", lineHeight: 1.8
        }}>
          No built-in images found. Add JPG files to{" "}
          <span style={{ color: "#3a6a3a" }}>backend/static/images/</span>{" "}
          named: city.jpg, nature.jpg, room.jpg, map.jpg, abstract.jpg
          <br />Or upload your own image below.
        </div>
      )}

      {/* Upload custom image */}
      <div style={{ marginBottom: 16 }}>
        <label style={s.uploadLabel}>
          📁 Upload Your Own Image
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleUploadImage}
          />
        </label>
      </div>

      <hr style={s.divider} />

      {/* Image with click overlay */}
      {selectedImage && (
        <>
          <span style={s.label}>
            Click {points.length} point{points.length !== 1 ? "s" : ""} — click in the order you want to enter them
          </span>

          <div style={s.imageWrap} onClick={handleImageClick}>
            <img
              ref={imgRef}
              src={selectedImage.url}
              alt="auth"
              style={s.image}
              draggable={false}
            />
            {points.map((p, i) => (
              <div key={i} style={s.dot(i, p.x, p.y)}>
                {i + 1}
              </div>
            ))}
          </div>

          {/* Controls */}
          <div style={s.row}>
            <button style={s.btn("default")} onClick={undoPoint} disabled={points.length === 0}>
              ↩ Undo
            </button>
            <button style={s.btn("red")} onClick={clearPoints} disabled={points.length === 0}>
              ✕ Clear
            </button>
            <span style={{ ...s.hint, marginLeft: "auto" }}>
              {points.length} point{points.length !== 1 ? "s" : ""} selected
            </span>
          </div>

          <hr style={s.divider} />

          {/* Tolerance control */}
          <div style={s.row}>
            <span style={s.label}>Click tolerance: {tolerance}%</span>
            <input
              type="range"
              min={2}
              max={15}
              value={tolerance}
              onChange={e => setTolerance(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </div>
          <div style={s.hint}>
            Higher = more forgiving (recommended: 5%). Lower = more precise.
          </div>

          <hr style={s.divider} />

          <button
            style={{ ...s.btn("green"), width: "100%", padding: 12 }}
            onClick={handleSave}
            disabled={loading || points.length < 2}
          >
            {loading ? "Saving..." : "✓ Save Image Points Profile"}
          </button>
        </>
      )}

      <div style={s.status(status.includes("saved"))}>
        {status}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LOGIN MODE
// ─────────────────────────────────────────────────────────────

export function ImagePointsLogin({ username, imageId, pointCount, onResult }) {

  const [points,  setPoints]  = useState([]);
  const [status,  setStatus]  = useState("");
  const [loading, setLoading] = useState(false);
  const [imgUrl,  setImgUrl]  = useState("");
  const imgRef = useRef(null);

  useEffect(() => {
    setImgUrl(`${API}/static/images/${imageId}`);
    setStatus(`Click ${pointCount} point${pointCount !== 1 ? "s" : ""} in order`);
  }, [imageId, pointCount]);

  const handleImageClick = (e) => {
    if (points.length >= pointCount) return;

    const rect = imgRef.current.getBoundingClientRect();
    const x    = (e.clientX - rect.left)  / rect.width;
    const y    = (e.clientY - rect.top)   / rect.height;

    const updated = [...points, { x, y }];
    setPoints(updated);

    if (updated.length === pointCount) {
      setStatus("All points selected — click Verify");
    } else {
      setStatus(`${updated.length}/${pointCount} points — keep clicking`);
    }
  };

  const undoPoint  = () => setPoints(prev => prev.slice(0, -1));
  const clearPoints = () => { setPoints([]); setStatus(`Click ${pointCount} points in order`); };

  const handleVerify = async () => {
    if (points.length !== pointCount) {
      setStatus(`Need exactly ${pointCount} points`);
      return;
    }

    setLoading(true);
    setStatus("Verifying...");

    try {
      const res  = await fetch(`${API}/imagepoints/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, points, image_id: imageId })
      });
      const data = await res.json();

      if (data.success) {
        setStatus("Points matched!");
        onResult && onResult(true, data.unlock_token);
      } else {
        setStatus("Points did not match — try again");
        clearPoints();
        onResult && onResult(false, null);
      }
    } catch {
      setStatus("Could not reach server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.wrap}>
      <span style={s.label}>Image Points — Authenticate</span>

      <div style={s.imageWrap} onClick={handleImageClick}>
        <img
          ref={imgRef}
          src={imgUrl}
          alt="auth"
          style={s.image}
          draggable={false}
        />
        {points.map((p, i) => (
          <div key={i} style={s.dot(i, p.x, p.y)}>
            {i + 1}
          </div>
        ))}
      </div>

      <div style={{ ...s.row, marginBottom: 8 }}>
        <button style={s.btn("default")} onClick={undoPoint} disabled={points.length === 0}>
          ↩ Undo
        </button>
        <button style={s.btn("red")} onClick={clearPoints} disabled={points.length === 0}>
          ✕ Clear
        </button>
        <button
          style={{ ...s.btn("green"), marginLeft: "auto" }}
          onClick={handleVerify}
          disabled={loading || points.length !== pointCount}
        >
          {loading ? "Checking..." : "✓ Verify"}
        </button>
      </div>

      <div style={s.status(status.includes("matched"))}>
        {status}
      </div>
      <div style={s.hint}>
        Points must be clicked in the same order as registration
      </div>
    </div>
  );
}