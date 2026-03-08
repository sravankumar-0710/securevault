import { useState, useEffect, useRef, useCallback } from "react";

const API          = "https://127.0.0.1:5000";
const IDLE_TIMEOUT = 900;
const WARN_AT      = 120;

const formatSize = (bytes) => {
  if (bytes === 0 || bytes == null) return "0 B";
  if (bytes < 1024)      return `${bytes} B`;
  if (bytes < 1024**2)   return `${(bytes/1024).toFixed(1)} KB`;
  if (bytes < 1024**3)   return `${(bytes/1024**2).toFixed(1)} MB`;
  return `${(bytes/1024**3).toFixed(2)} GB`;
};

const PREV_EXT = new Set(["jpg","jpeg","png","gif","webp","svg","pdf","txt","md","csv","json","py","js","css","html"]);
const getExt   = (n) => n.includes(".") ? n.split(".").pop().toLowerCase() : "";
const getType  = (e) => {
  if (["jpg","jpeg","png","gif","webp","svg"].includes(e)) return "image";
  if (e === "pdf") return "pdf";
  if (["txt","md","csv","json","py","js","css","html"].includes(e)) return "text";
  return null;
};
const fmtBytes = (b) => {
  if (!b) return "0 B";
  if (b < 1024)    return `${b} B`;
  if (b < 1024**2) return `${(b/1024).toFixed(1)} KB`;
  if (b < 1024**3) return `${(b/1024**2).toFixed(1)} MB`;
  return `${(b/1024**3).toFixed(2)} GB`;
};
const fmtTime = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;

// ── Toast ─────────────────────────────────────────────────
let _toastId = 0;
function ToastContainer({ toasts, remove }) {
  return (
    <div className="sv-toast-container">
      {toasts.map(t => (
        <div key={t.id}
          className={`sv-toast sv-toast-${t.type}${t.exiting ? " exiting" : ""}`}
          onClick={() => remove(t.id)}>
          <span>{t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}</span>
          <span style={{ flex:1 }}>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard({ token, onLogout, onSettings }) {
  const [folders,        setFolders]        = useState([]);
  const [files,          setFiles]          = useState([]);
  const [allFolders,     setAllFolders]     = useState([]);
  const [currentFolder,  setCurrentFolder]  = useState("");
  const [navHistory,     setNavHistory]     = useState([""]);
  const [navIndex,       setNavIndex]       = useState(0);
  const [selected,       setSelected]       = useState(new Set());
  const [uploadProgress, setUploadProgress] = useState("");
  const [showNewFolder,  setShowNewFolder]  = useState(false);
  const [newFolderName,  setNewFolderName]  = useState("");
  const [showMove,       setShowMove]       = useState(false);
  const [moveTarget,     setMoveTarget]     = useState("");
  const [movingItems,    setMovingItems]    = useState([]);
  const [timeLeft,       setTimeLeft]       = useState(IDLE_TIMEOUT);
  const [showWarn,       setShowWarn]       = useState(false);
  const [activeTab,      setActiveTab]      = useState("files");
  const [auditLog,       setAuditLog]       = useState([]);
  const [auditLoading,   setAuditLoading]   = useState(false);
  const [preview,        setPreview]        = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [renaming,       setRenaming]       = useState(null);
  const [renameValue,    setRenameValue]    = useState("");
  const [dragging,       setDragging]       = useState(false);
  const [storage,        setStorage]        = useState(null);
  const [sort,           setSort]           = useState({ key:"name", dir:"asc" });
  const [toasts,         setToasts]         = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [cursor,         setCursor]         = useState({ x:-999, y:-999, visible:false });

  const fileInputRef   = useRef(null);
  const folderInputRef = useRef(null);
  const timerRef     = useRef(null);
  const lastActive   = useRef(Date.now());
  const loggedOut    = useRef(false);
  const dragCounter  = useRef(0);
  const pageRef      = useRef(null);

  // ── Toast helpers ─────────────────────────────────────────
  const toast = useCallback((msg, type = "success") => {
    const id = ++_toastId;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting:true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 280);
    }, 3200);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting:true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 280);
  }, []);

  // ── Session ───────────────────────────────────────────────
  const doLogout = useCallback(async (reason) => {
    if (loggedOut.current) return;
    loggedOut.current = true;
    clearInterval(timerRef.current);
    try { await fetch(`${API}/logout`, { method:"POST", headers:{ Authorization:token } }); } catch {}
    onLogout(reason);
  }, [token, onLogout]);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      const idle = Math.floor((Date.now() - lastActive.current) / 1000);
      const left = Math.max(0, IDLE_TIMEOUT - idle);
      setTimeLeft(left);
      setShowWarn(left > 0 && left <= WARN_AT);
      if (left === 0) doLogout("Session expired — please log in again");
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [doLogout]);

  useEffect(() => {
    const reset = () => { lastActive.current = Date.now(); };
    window.addEventListener("mousemove", reset);
    window.addEventListener("keydown",   reset);
    return () => {
      window.removeEventListener("mousemove", reset);
      window.removeEventListener("keydown",   reset);
    };
  }, []);

  // ── Cursor light ──────────────────────────────────────────
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const onMove  = (e) => setCursor({ x:e.clientX, y:e.clientY, visible:true });
    const onLeave = ()  => setCursor(c => ({ ...c, visible:false }));
    el.addEventListener("mousemove",  onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove",  onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  // ── API helpers ───────────────────────────────────────────
  const authHdr = useCallback(() => ({ Authorization: token }), [token]);
  const chk401  = useCallback((res) => {
    if (res.status === 401) { doLogout("Session expired"); return true; }
    return false;
  }, [doLogout]);

  // ── Fetch files ───────────────────────────────────────────
  const fetchFiles = useCallback(async (folder = currentFolder) => {
    setSelected(new Set());
    try {
      const res  = await fetch(`${API}/files?folder=${encodeURIComponent(folder)}`, { headers:authHdr() });
      if (chk401(res)) return;
      const data = await res.json();
      setFolders(data.folders || []);
      setFiles(data.files    || []);
    } catch { toast("Could not reach server", "error"); }
    finally  { setLoading(false); }
  }, [currentFolder, authHdr, chk401, toast]);

  useEffect(() => { setLoading(true); fetchFiles(currentFolder); }, [currentFolder]);

  // ── Fetch audit ───────────────────────────────────────────
  const fetchAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res  = await fetch(`${API}/audit?limit=100`, { headers:authHdr() });
      if (chk401(res)) return;
      setAuditLog((await res.json()).entries || []);
    } catch { toast("Could not load audit log", "error"); }
    finally  { setAuditLoading(false); }
  }, [authHdr, chk401, toast]);

  useEffect(() => { if (activeTab === "audit") fetchAudit(); }, [activeTab]);

  // ── Storage ───────────────────────────────────────────────
  const fetchStorage = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/storage/usage`, { headers:authHdr() });
      if (chk401(res)) return;
      setStorage(await res.json());
    } catch {}
  }, [authHdr, chk401]);

  useEffect(() => { fetchStorage(); }, []);

  // ── Sorting ───────────────────────────────────────────────
  // files is [{name, size}]
  const _dir = sort.dir === "asc" ? 1 : -1;
  const sorted = [...files].sort((a, b) => {
    if (sort.key === "size") return (a.size - b.size) * _dir;
    if (sort.key === "ext")  return (getExt(a.name)||"").localeCompare(getExt(b.name)||"") * _dir;
    return a.name.localeCompare(b.name) * _dir;
  });
  const sortedFolders = [...folders].sort((a, b) => {
    const c = a.localeCompare(b);
    return sort.key === "name" && sort.dir === "desc" ? -c : c;
  });
  const handleSort = (key) => setSort(prev =>
    prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir:"asc" }
  );
  const sortIcon = (key) => sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";

  // ── Preview ───────────────────────────────────────────────
  const openPreview = async (filename) => {
    const ext = getExt(filename), type = getType(ext);
    if (!type) return;
    const fp = currentFolder ? `${currentFolder}/${filename}` : filename;
    setPreviewLoading(true);
    setPreview({ name:filename, url:null, type, text:null });
    try {
      const res = await fetch(`${API}/preview/${encodeURIComponent(fp)}`, { headers:authHdr() });
      if (!res.ok) { setPreviewLoading(false); setPreview(null); return; }
      if (type === "text") {
        setPreview({ name:filename, url:null, type, text: await res.text() });
      } else {
        setPreview({ name:filename, url:URL.createObjectURL(await res.blob()), type, text:null });
      }
    } catch { setPreview(null); }
    finally  { setPreviewLoading(false); }
  };

  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  // ── Drag & drop ───────────────────────────────────────────
  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  };
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const handleDrop = async (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);

    // Collect files — preserving webkitRelativePath when dragging a folder
    const items = e.dataTransfer.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      const entries = Array.from(items).map(i => i.webkitGetAsEntry()).filter(Boolean);
      const files = await readEntries(entries);
      if (files.length) await uploadFiles(files);
    } else {
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length) await uploadFiles(dropped);
    }
  };

  // Recursively walk FileSystemEntry tree → flat [{file, relativePath}]
  const readEntries = (entries) => new Promise((resolve) => {
    const results = [];
    let pending = 0;
    const done = () => { if (--pending === 0) resolve(results); };
    const walk = (entry, path) => {
      pending++;
      if (entry.isFile) {
        entry.getFile(file => {
          file._relativePath = path || file.name;
          results.push(file);
          done();
        }, done);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const readAll = (accumulated) => {
          reader.readEntries(batch => {
            if (!batch.length) {
              accumulated.forEach(e => walk(e, `${path || entry.name}/${e.name}`));
              done();
            } else {
              readAll([...accumulated, ...batch]);
            }
          }, done);
        };
        readAll([]);
      } else done();
    };
    if (entries.length === 0) return resolve([]);
    entries.forEach(e => walk(e, e.name));
  });

  // ── Upload ────────────────────────────────────────────────
  // Each file may have ._relativePath (set by folder picker or drag-drop dir walk)
  const uploadFiles = async (list) => {
    let done = 0;
    setUploadProgress(`0 / ${list.length}`);
    for (const file of list) {
      const form = new FormData();
      form.append("file", file);

      // Determine target folder: combine currentFolder + any relative subfolder
      const relPath   = file._relativePath || file.webkitRelativePath || "";
      // relPath is like "FolderName/sub/file.txt" — strip the filename to get subdir
      const relDir    = relPath.includes("/") ? relPath.split("/").slice(0, -1).join("/") : "";
      const targetDir = [currentFolder, relDir].filter(Boolean).join("/");
      if (targetDir) form.append("folder", targetDir);
      // Also send the original relative path so backend can auto-create subfolders
      if (relDir)    form.append("relative_path", relDir);

      try {
        const res = await fetch(`${API}/upload`, { method:"POST", headers:authHdr(), body:form });
        if (chk401(res)) return;
      } catch {}
      done++;
      setUploadProgress(`${done} / ${list.length}`);
    }
    setUploadProgress("");
    toast(`${done} file${done !== 1 ? "s" : ""} uploaded`);
    fetchFiles();
    fetchStorage();
  };

  const handleUpload = async (e) => {
    const list = Array.from(e.target.files);
    if (!list.length) return;
    // webkitRelativePath is set automatically when webkitdirectory is used
    await uploadFiles(list);
    fileInputRef.current.value = "";
  };

  const handleFolderUpload = async (e) => {
    const list = Array.from(e.target.files);
    if (!list.length) return;
    await uploadFiles(list);
    folderInputRef.current.value = "";
  };

  // ── Download ──────────────────────────────────────────────
  const handleDownload = async (filename) => {
    const fp = currentFolder ? `${currentFolder}/${filename}` : filename;
    try {
      const res = await fetch(`${API}/download/${encodeURIComponent(fp)}`, { headers:authHdr() });
      if (chk401(res)) return;
      if (!res.ok) { toast("Download failed", "error"); return; }
      const url = URL.createObjectURL(await res.blob());
      const a   = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch { toast("Download failed", "error"); }
  };

  const handleDownloadSelected = async () => {
    for (const f of selected) await handleDownload(f);
  };

  // ── Delete ────────────────────────────────────────────────
  const handleDeleteFile = async (filename) => {
    if (!confirm(`Delete "${filename}"?`)) return;
    const fp = currentFolder ? `${currentFolder}/${filename}` : filename;
    try {
      const res = await fetch(`${API}/delete/${encodeURIComponent(fp)}`, { method:"DELETE", headers:authHdr() });
      if (chk401(res)) return;
      toast(`"${filename}" deleted`);
      fetchFiles(); fetchStorage();
    } catch { toast("Delete failed", "error"); }
  };

  const handleDeleteSelected = async () => {
    if (!confirm(`Delete ${selected.size} file(s)?`)) return;
    for (const filename of selected) {
      const fp = currentFolder ? `${currentFolder}/${filename}` : filename;
      try { await fetch(`${API}/delete/${encodeURIComponent(fp)}`, { method:"DELETE", headers:authHdr() }); } catch {}
    }
    toast(`${selected.size} file(s) deleted`);
    fetchFiles(); fetchStorage();
  };

  const handleDeleteFolder = async (folderName) => {
    const fp = currentFolder ? `${currentFolder}/${folderName}` : folderName;
    if (!confirm(`Delete folder "${folderName}" and ALL its contents?`)) return;
    try {
      const res = await fetch(`${API}/folders/${encodeURIComponent(fp)}`, { method:"DELETE", headers:authHdr() });
      if (chk401(res)) return;
      toast(`Folder "${folderName}" deleted`);
      fetchFiles();
    } catch { toast("Delete failed", "error"); }
  };

  // ── Move ──────────────────────────────────────────────────
  const fetchAllFolders = useCallback(async () => {
    const collect = async (path, acc) => {
      try {
        const res  = await fetch(`${API}/files?folder=${encodeURIComponent(path)}`, { headers:authHdr() });
        const data = await res.json();
        for (const f of (data.folders || [])) {
          const full = path ? `${path}/${f}` : f;
          acc.push(full);
          await collect(full, acc);
        }
      } catch {}
    };
    const acc = [];
    await collect("", acc);
    setAllFolders(acc);
  }, [authHdr]);

  const openMove = async (filenames) => {
    setMovingItems(filenames);
    setMoveTarget(currentFolder);
    await fetchAllFolders();
    setShowMove(true);
  };

  const handleMove = async () => {
    for (const filename of movingItems) {
      const op = currentFolder ? `${currentFolder}/${filename}` : filename;
      const np = moveTarget    ? `${moveTarget}/${filename}`    : filename;
      if (op === np) continue;
      try {
        await fetch(`${API}/move`, {
          method:"POST",
          headers:{ ...authHdr(), "Content-Type":"application/json" },
          body: JSON.stringify({ old_path:op, new_path:np }),
        });
      } catch {}
    }
    setShowMove(false);
    setMovingItems([]);
    toast(`${movingItems.length} file(s) moved`);
    fetchFiles();
  };

  // ── Create folder ─────────────────────────────────────────
  const handleCreateFolder = async () => {
    const name = newFolderName.trim().replace(/[/\\]/g, "");
    if (!name) return;
    const fp = currentFolder ? `${currentFolder}/${name}` : name;
    try {
      const res = await fetch(`${API}/folders`, {
        method:"POST",
        headers:{ ...authHdr(), "Content-Type":"application/json" },
        body: JSON.stringify({ folder:fp }),
      });
      if (chk401(res)) return;
      setNewFolderName("");
      setShowNewFolder(false);
      toast(`Folder "${name}" created`);
      fetchFiles();
    } catch { toast("Could not create folder", "error"); }
  };

  // ── Rename ────────────────────────────────────────────────
  const startRename  = (f) => { setRenaming(f); setRenameValue(f); };
  const cancelRename = ()  => { setRenaming(null); setRenameValue(""); };
  const submitRename = async (oldName) => {
    const newName = renameValue.trim();
    if (!newName || newName === oldName) { cancelRename(); return; }
    const op = currentFolder ? `${currentFolder}/${oldName}` : oldName;
    const np = currentFolder ? `${currentFolder}/${newName}` : newName;
    try {
      const res = await fetch(`${API}/move`, {
        method:"POST",
        headers:{ ...authHdr(), "Content-Type":"application/json" },
        body: JSON.stringify({ old_path:op, new_path:np }),
      });
      if (chk401(res)) return;
      const d = await res.json();
      if (d.error) toast(d.error, "error");
      else { toast(`Renamed to "${newName}"`); fetchFiles(); }
    } catch { toast("Rename failed", "error"); }
    finally  { cancelRename(); }
  };

  // ── Navigation ────────────────────────────────────────────
  const navigateTo = (folder) => {
    setNavHistory(prev => [...prev.slice(0, navIndex + 1), folder]);
    setNavIndex(i => i + 1);
    setCurrentFolder(folder);
  };
  const navBack    = () => { if (navIndex <= 0) return; const i = navIndex - 1; setNavIndex(i); setCurrentFolder(navHistory[i]); };
  const navForward = () => { if (navIndex >= navHistory.length - 1) return; const i = navIndex + 1; setNavIndex(i); setCurrentFolder(navHistory[i]); };

  const breadcrumbs = () => {
    const parts = currentFolder ? currentFolder.split("/") : [];
    const c = [{ label:"Home", path:"" }];
    parts.forEach((p, i) => c.push({ label:p, path:parts.slice(0, i + 1).join("/") }));
    return c;
  };

  // ── Selection ─────────────────────────────────────────────
  const toggleSelect = (name) => setSelected(prev => {
    const n = new Set(prev);
    n.has(name) ? n.delete(name) : n.add(name);
    return n;
  });
  const toggleAll = () => {
    if (selected.size === files.length && files.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map(f => f.name)));
    }
  };

  // ── Derived values ────────────────────────────────────────
  const crumbs      = breadcrumbs();
  const isEmpty     = sortedFolders.length === 0 && sorted.length === 0;
  const allSelected = files.length > 0 && selected.size === files.length;
  const moveOptions = ["", ...allFolders].filter(f => f !== currentFolder || movingItems.length > 0);
  const storagePct  = storage ? Math.min((storage.bytes / (100 * 1024 * 1024)) * 100, 100) : 0;

  // ─────────────────────────────────────────────────────────
  return (
    <div
      className="sv-page"
      ref={pageRef}
      style={{ paddingTop: showWarn ? 60 : 24 }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Cursor light */}
      <div style={{
        position:"fixed", pointerEvents:"none", zIndex:9999,
        left:cursor.x, top:cursor.y,
        width:300, height:300, transform:"translate(-50%,-50%)",
        background:"radial-gradient(circle, rgba(167,139,250,0.10) 0%, rgba(139,110,245,0.04) 45%, transparent 70%)",
        borderRadius:"50%", mixBlendMode:"screen",
        opacity:cursor.visible ? 1 : 0, transition:"opacity 0.3s ease",
      }} />

      {/* Background */}
      <div className="sv-bg-grid" />
      <div className="sv-bg-orb-1" />
      <div className="sv-bg-orb-2" />

      {/* Toasts */}
      <ToastContainer toasts={toasts} remove={removeToast} />

      {/* Drag overlay */}
      {dragging && (
        <div className="sv-drop-overlay">
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:48, marginBottom:16, opacity:0.7 }}>⬆</div>
            <div style={{ fontSize:18, fontWeight:700, color:"var(--green)", letterSpacing:"0.1em", textTransform:"uppercase" }}>
              Drop to upload{currentFolder ? ` into "${currentFolder.split("/").pop()}"` : ""}
            </div>
          </div>
        </div>
      )}

      {/* Session warning */}
      {showWarn && (
        <div className="sv-session-warn">
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ color:"var(--amber)", fontSize:14 }}>⚠</span>
            <span style={{ fontSize:12, color:"var(--amber)" }}>
              Session expires in <strong>{fmtTime(timeLeft)}</strong>
            </span>
          </div>
          <button className="sv-btn sv-btn-ghost sv-btn-sm"
            onClick={() => { lastActive.current = Date.now(); setShowWarn(false); fetchFiles(); }}>
            Stay logged in
          </button>
        </div>
      )}

      <div className="sv-inner" style={{ position:"relative", zIndex:1 }}>

        {/* ── Header ── */}
        <header className="sv-page-header sv-anim-fade-up">
          <div className="sv-logo">
            <div className="sv-logo-icon">🔐</div>
            <div>
              <div className="sv-logo-name">SecureVault</div>
              <div className="sv-logo-sub">Encrypted File Storage</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            {uploadProgress && (
              <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, color:"var(--green)" }}>
                <div className="sv-spinner sv-spinner-sm" />
                {uploadProgress} uploading
              </div>
            )}
            <button className="sv-btn sv-btn-ghost sv-btn-sm" onClick={onSettings}>⚙ Settings</button>
            <button className="sv-btn sv-btn-danger sv-btn-sm" onClick={() => doLogout()}>Sign Out</button>
          </div>
        </header>

        {/* ── Storage bar ── */}
        {storage !== null && (
          <div className="sv-storage sv-card sv-anim-fade-up" style={{ padding:"12px 20px", marginBottom:16 }}>
            <span style={{ fontSize:12, color:"var(--t2)", fontWeight:600 }}>{fmtBytes(storage.bytes)}</span>
            <div className="sv-storage-track">
              <div className="sv-progress">
                <div
                  className={`sv-progress-bar${storagePct > 80 ? " red" : storagePct > 50 ? " amber" : ""}`}
                  style={{ width:`${storagePct}%` }}
                />
              </div>
            </div>
            <span style={{ whiteSpace:"nowrap", fontSize:11, color:"var(--t3)" }}>
              {storage.file_count} file{storage.file_count !== 1 ? "s" : ""}
              {storage.folder_count > 0 && ` · ${storage.folder_count} folder${storage.folder_count !== 1 ? "s" : ""}`}
            </span>
          </div>
        )}

        {/* ── Tabs ── */}
        <div style={{ marginBottom:16 }} className="sv-anim-fade-up">
          <div className="sv-tabs">
            <button className={`sv-tab${activeTab === "files" ? " active" : ""}`} onClick={() => setActiveTab("files")}>📁 Files</button>
            <button className={`sv-tab${activeTab === "audit" ? " active" : ""}`} onClick={() => setActiveTab("audit")}>📋 History</button>
          </div>
        </div>

        {/* ══════════ FILES TAB ══════════ */}
        {activeTab === "files" && (
          <div className="sv-card sv-anim-fade-up" style={{ overflow:"hidden" }}>

            {/* Breadcrumb + Toolbar */}
            <div style={{
              padding:"14px 20px", borderBottom:"1px solid var(--b2)",
              display:"flex", alignItems:"center", justifyContent:"space-between",
              flexWrap:"wrap", gap:10,
            }}>
              <div className="sv-breadcrumb">
                {crumbs.map((c, i) => (
                  <span key={c.path} style={{ display:"flex", alignItems:"center", gap:5 }}>
                    {i > 0 && <span className="sv-crumb-sep">›</span>}
                    <span
                      className={`sv-crumb${i === crumbs.length - 1 ? " current" : ""}`}
                      onClick={() => i < crumbs.length - 1 && navigateTo(c.path)}
                    >
                      {c.label}
                    </span>
                  </span>
                ))}
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <button className="sv-btn sv-btn-ghost sv-btn-xs" onClick={navBack}
                  disabled={navIndex <= 0}
                  style={{ opacity:navIndex <= 0 ? 0.3 : 1, padding:"5px 10px" }}>‹</button>
                <button className="sv-btn sv-btn-ghost sv-btn-xs" onClick={navForward}
                  disabled={navIndex >= navHistory.length - 1}
                  style={{ opacity:navIndex >= navHistory.length - 1 ? 0.3 : 1, padding:"5px 10px" }}>›</button>

                <label className="sv-btn sv-btn-primary sv-btn-sm" style={{ cursor:"pointer" }} title="Upload files (or drag & drop anywhere)">
                  ⬆ Upload Files
                  <input type="file" multiple ref={fileInputRef} onChange={handleUpload} style={{ display:"none" }} />
                </label>

                <label className="sv-btn sv-btn-ghost sv-btn-sm" style={{ cursor:"pointer" }} title="Upload an entire folder — all subfolders preserved">
                  📁 Upload Folder
                  <input
                    type="file"
                    ref={folderInputRef}
                    onChange={handleFolderUpload}
                    style={{ display:"none" }}
                    webkitdirectory=""
                    directory=""
                  />
                </label>

                {/* Inline folder creation */}
                {showNewFolder ? (
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div className="sv-input-group" style={{ width:180 }}>
                      <span className="sv-input-icon" style={{ fontSize:12 }}>📁</span>
                      <input
                        className="sv-input"
                        style={{ padding:"5px 10px 5px 32px", fontSize:12, height:32 }}
                        placeholder="Folder name"
                        value={newFolderName}
                        autoFocus
                        onChange={e => setNewFolderName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter")  handleCreateFolder();
                          if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
                        }}
                      />
                    </div>
                    <button className="sv-btn sv-btn-primary sv-btn-xs" onClick={handleCreateFolder}>Create</button>
                    <button className="sv-btn sv-btn-ghost sv-btn-xs" onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}>✕</button>
                  </div>
                ) : (
                  <button className="sv-btn sv-btn-ghost sv-btn-sm" onClick={() => setShowNewFolder(true)}>
                    + Folder
                  </button>
                )}

                {currentFolder && (
                  <button className="sv-btn sv-btn-ghost sv-btn-sm"
                    onClick={() => navigateTo(crumbs[crumbs.length - 2].path)}>↑ Up</button>
                )}
              </div>
            </div>

            {/* Bulk action bar */}
            {selected.size > 0 && (
              <div className="sv-bulk-bar">
                <span style={{ fontSize:11, color:"var(--green)", fontWeight:600, marginRight:4 }}>{selected.size} selected</span>
                <button className="sv-btn sv-btn-primary sv-btn-xs" onClick={handleDownloadSelected}>⬇ Download</button>
                <button className="sv-btn sv-btn-ghost sv-btn-xs"   onClick={() => openMove([...selected])}>↗ Move</button>
                <button className="sv-btn sv-btn-danger sv-btn-xs"  onClick={handleDeleteSelected}>🗑 Delete</button>
                <button className="sv-btn sv-btn-ghost sv-btn-xs"   onClick={() => setSelected(new Set())}>✕ Clear</button>
              </div>
            )}

            {/* File table */}
            {loading ? (
              <div style={{ padding:"48px 20px", textAlign:"center" }}>
                <div className="sv-spinner sv-spinner-lg" style={{ margin:"0 auto" }} />
              </div>
            ) : isEmpty ? (
              <div className="sv-empty">
                <span className="sv-empty-icon">📂</span>
                <div className="sv-empty-title">This folder is empty</div>
                <div className="sv-empty-sub">Upload files or create a subfolder to get started</div>
              </div>
            ) : (
              <div style={{ overflowX:"auto" }}>
                <table className="sv-table">
                  <thead>
                    <tr>
                      <th style={{ width:40, padding:"10px 14px" }}>
                        {files.length > 0 && (
                          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                        )}
                      </th>
                      <th className={`sortable${sort.key === "name" ? " sort-active" : ""}`}
                        onClick={() => handleSort("name")}>
                        Name{sortIcon("name")}
                      </th>
                      <th className={`sortable sv-hide-mobile${sort.key === "size" ? " sort-active" : ""}`}
                        style={{ width:90 }} onClick={() => handleSort("size")}>
                        Size{sortIcon("size")}
                      </th>
                      <th className={`sortable sv-hide-mobile${sort.key === "ext" ? " sort-active" : ""}`}
                        onClick={() => handleSort("ext")}>
                        Type{sortIcon("ext")}
                      </th>
                      <th style={{ textAlign:"right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>

                    {/* ── Folders ── */}
                    {sortedFolders.map(folder => (
                      <tr key={`d_${folder}`}>
                        <td></td>
                        <td>
                          {renaming === `__folder__${folder}` ? (
                            <input className="sv-rename-input" value={renameValue} autoFocus
                              onChange={e => setRenameValue(e.target.value)}
                              onKeyDown={async e => {
                                if (e.key === "Escape") { cancelRename(); return; }
                                if (e.key === "Enter") {
                                  const nn = renameValue.trim();
                                  if (!nn || nn === folder) { cancelRename(); return; }
                                  const op = currentFolder ? `${currentFolder}/${folder}` : folder;
                                  const np = currentFolder ? `${currentFolder}/${nn}` : nn;
                                  try {
                                    await fetch(`${API}/folders/rename`, {
                                      method:"POST",
                                      headers:{ ...authHdr(), "Content-Type":"application/json" },
                                      body: JSON.stringify({ old_path:op, new_path:np }),
                                    });
                                    toast(`Renamed to "${nn}"`);
                                    fetchFiles();
                                  } catch { toast("Rename failed", "error"); }
                                  cancelRename();
                                }
                              }}
                              onBlur={cancelRename}
                              onClick={e => e.stopPropagation()}
                            />
                          ) : (
                            <span style={{ display:"flex", alignItems:"center", gap:10 }}>
                              <span style={{ fontSize:16, opacity:0.7 }}>📁</span>
                              <span
                                style={{ color:"var(--green-mid)", cursor:"pointer", fontWeight:500 }}
                                onClick={() => navigateTo(currentFolder ? `${currentFolder}/${folder}` : folder)}
                              >
                                {folder}
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="sv-hide-mobile" style={{ color:"var(--t3)", fontSize:11 }}>—</td>
                        <td className="sv-hide-mobile" style={{ color:"var(--t3)", fontSize:11 }}>folder</td>
                        <td>
                          <div className="sv-file-actions" style={{ justifyContent:"flex-end" }}>
                            <button className="sv-btn sv-btn-ghost sv-btn-xs"
                              onClick={() => navigateTo(currentFolder ? `${currentFolder}/${folder}` : folder)}>
                              Open
                            </button>
                            <button className="sv-btn sv-btn-ghost sv-btn-xs"
                              onClick={() => { setRenaming(`__folder__${folder}`); setRenameValue(folder); }}>
                              ✏
                            </button>
                            <button className="sv-btn sv-btn-danger sv-btn-xs"
                              onClick={() => handleDeleteFolder(folder)}>
                              🗑
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                    {/* ── Files ── */}
                    {sorted.map(fileObj => (
                      <tr key={`f_${fileObj.name}`} className={selected.has(fileObj.name) ? "sv-row-selected" : ""}>
                        <td>
                          <input type="checkbox"
                            checked={selected.has(fileObj.name)}
                            onChange={() => toggleSelect(fileObj.name)}
                          />
                        </td>
                        <td title={fileObj.name}>
                          {renaming === fileObj.name ? (
                            <input className="sv-rename-input" value={renameValue} autoFocus
                              onChange={e => setRenameValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter")  submitRename(fileObj.name);
                                if (e.key === "Escape") cancelRename();
                              }}
                              onBlur={() => submitRename(fileObj.name)}
                              onClick={e => e.stopPropagation()}
                            />
                          ) : (
                            <span style={{ display:"flex", alignItems:"center", gap:10 }}>
                              <span style={{ fontSize:15, opacity:0.6 }}>📄</span>
                              <span
                                style={{
                                  cursor: PREV_EXT.has(getExt(fileObj.name)) ? "pointer" : "default",
                                  color:"var(--t1)",
                                }}
                                onClick={() => PREV_EXT.has(getExt(fileObj.name)) && openPreview(fileObj.name)}
                              >
                                {fileObj.name}
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="sv-hide-mobile" style={{ color:"var(--t2)", fontSize:11, fontVariantNumeric:"tabular-nums" }}>
                          {formatSize(fileObj.size)}
                        </td>
                        <td className="sv-hide-mobile" style={{ color:"var(--t3)", fontSize:11 }}>
                          {getExt(fileObj.name) || "—"}
                        </td>
                        <td>
                          <div className="sv-file-actions" style={{ justifyContent:"flex-end" }}>
                            {PREV_EXT.has(getExt(fileObj.name)) && (
                              <button className="sv-btn sv-btn-ghost sv-btn-xs"
                                onClick={() => openPreview(fileObj.name)} title="Preview">👁</button>
                            )}
                            <button className="sv-btn sv-btn-primary sv-btn-xs"
                              onClick={() => handleDownload(fileObj.name)} title="Download">⬇</button>
                            <button className="sv-btn sv-btn-ghost sv-btn-xs"
                              onClick={() => startRename(fileObj.name)} title="Rename">✏</button>
                            <button className="sv-btn sv-btn-ghost sv-btn-xs"
                              onClick={() => openMove([fileObj.name])} title="Move">↗</button>
                            <button className="sv-btn sv-btn-danger sv-btn-xs"
                              onClick={() => handleDeleteFile(fileObj.name)} title="Delete">🗑</button>
                          </div>
                        </td>
                      </tr>
                    ))}

                  </tbody>
                </table>
              </div>
            )}

            <div style={{
              padding:"12px 20px", borderTop:"1px solid var(--b3)",
              display:"flex", justifyContent:"space-between", alignItems:"center",
            }}>
              <span style={{ fontSize:11, color:"var(--t3)" }}>
                {sortedFolders.length} folder{sortedFolders.length !== 1 ? "s" : ""} · {sorted.length} file{sorted.length !== 1 ? "s" : ""}
              </span>
              <button className="sv-btn sv-btn-ghost sv-btn-xs" onClick={() => fetchFiles()}>↺ Refresh</button>
            </div>
          </div>
        )}

        {/* ══════════ AUDIT TAB ══════════ */}
        {activeTab === "audit" && (
          <div className="sv-card sv-anim-fade-up" style={{ overflow:"hidden" }}>
            <div style={{
              padding:"14px 20px", borderBottom:"1px solid var(--b2)",
              display:"flex", justifyContent:"space-between", alignItems:"center",
            }}>
              <span style={{ fontSize:11, fontWeight:600, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--t3)" }}>
                Login History
              </span>
              <button className="sv-btn sv-btn-ghost sv-btn-xs" onClick={fetchAudit}>↺ Refresh</button>
            </div>

            {auditLoading && (
              <div style={{ padding:"48px", textAlign:"center" }}>
                <div className="sv-spinner sv-spinner-lg" style={{ margin:"0 auto" }} />
              </div>
            )}
            {!auditLoading && auditLog.length === 0 && (
              <div className="sv-empty">
                <span className="sv-empty-icon">📋</span>
                <div className="sv-empty-title">No history yet</div>
              </div>
            )}
            {!auditLoading && auditLog.length > 0 && (
              <div style={{ overflowX:"auto" }}>
                <table className="sv-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Event</th>
                      <th>Status</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((entry, i) => (
                      <tr key={i}>
                        <td style={{ whiteSpace:"nowrap", fontSize:11, color:"var(--t3)" }}>{entry.ts_str}</td>
                        <td style={{ color:"var(--t2)" }}>{entry.label}</td>
                        <td>
                          <span className={`sv-badge sv-badge-${entry.color === "green" ? "green" : entry.color === "red" ? "red" : "amber"}`}>
                            {entry.status}
                          </span>
                        </td>
                        <td style={{ fontSize:11, color:"var(--t3)" }}>{entry.ip || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Preview modal ── */}
      {(preview || previewLoading) && (
        <div className="sv-overlay" onClick={e => e.target === e.currentTarget && closePreview()}>
          <div className="sv-modal" style={{ width:"90vw", maxWidth:900 }}>
            <div className="sv-modal-header" style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"70%" }}>
                👁 {preview?.name || "Loading..."}
              </span>
              <button className="sv-btn sv-btn-danger sv-btn-sm" onClick={closePreview}>✕ Close</button>
            </div>
            <div className="sv-modal-body" style={{ overflow:"auto", maxHeight:"75vh", display:"flex", alignItems:"flex-start", justifyContent:"center" }}>
              {previewLoading && <div className="sv-spinner sv-spinner-lg" style={{ margin:"40px auto" }} />}
              {!previewLoading && preview?.type === "image" && (
                <img src={preview.url} alt={preview.name}
                  style={{ maxWidth:"100%", maxHeight:"65vh", borderRadius:8, objectFit:"contain" }} />
              )}
              {!previewLoading && preview?.type === "pdf" && (
                <iframe src={preview.url} title={preview.name}
                  style={{ width:"100%", height:"65vh", border:"none", borderRadius:8 }} />
              )}
              {!previewLoading && preview?.type === "text" && (
                <pre style={{
                  width:"100%", background:"var(--obsidian)", border:"1px solid var(--b1)",
                  borderRadius:8, padding:16, color:"var(--t2)", fontSize:12,
                  fontFamily:"var(--font-mono)", lineHeight:1.7,
                  whiteSpace:"pre-wrap", wordBreak:"break-word", margin:0,
                }}>{preview.text}</pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Move modal ── */}
      {showMove && (
        <div className="sv-overlay" onClick={e => e.target === e.currentTarget && setShowMove(false)}>
          <div className="sv-modal">
            <div className="sv-modal-header">
              Move {movingItems.length} file{movingItems.length !== 1 ? "s" : ""} to...
            </div>
            <div className="sv-modal-body">
              <div style={{ maxHeight:280, overflowY:"auto" }}>
                {moveOptions.map(folder => (
                  <div key={folder || "__root__"}
                    className={`sv-folder-opt${moveTarget === folder ? " selected" : ""}`}
                    onClick={() => setMoveTarget(folder)}>
                    {folder ? `📁 ${folder}` : "📂 Root"}
                  </div>
                ))}
                {moveOptions.length === 0 && (
                  <div style={{ fontSize:12, color:"var(--t3)", padding:"8px 0" }}>
                    No other folders — create one first
                  </div>
                )}
              </div>
            </div>
            <div className="sv-modal-footer">
              <button className="sv-btn sv-btn-ghost"   onClick={() => setShowMove(false)}>Cancel</button>
              <button className="sv-btn sv-btn-primary" onClick={handleMove}>Move Here</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}