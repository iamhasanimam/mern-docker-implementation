import React, { useEffect, useState } from "react";

const API = `${process.env.REACT_APP_API_BASE || ""}/api`;

const styles = {
  page: { maxWidth: 800, margin: "40px auto", fontFamily: "system-ui, sans-serif" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  composer: { display: "flex", gap: 8, marginBottom: 16 },
  input: { flex: 1, padding: "10px 12px", border: "1px solid #ccc", borderRadius: 6, boxSizing: "border-box" },
  btn: { height: 36, padding: "0 12px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", cursor: "pointer" },
  btnPrimary: { border: "1px solid #111", background: "#111", color: "#fff" },
  list: { listStyle: "none", padding: 0, margin: 0, borderTop: "1px solid #eee" },

  // NEW: rock-solid row layout
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 0",
    borderBottom: "1px solid #eee",
    width: "100%",
  },
  checkCell: { width: 28, display: "flex", justifyContent: "center" },
  titleCell: { flex: 1, minWidth: 0 }, // prevents overflow, lets input shrink
  actionsCell: { display: "flex", gap: 8, flexShrink: 0 },

  title: { padding: "8px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  titleDone: { textDecoration: "line-through", color: "#888" },
  titleInput: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #bbb",
    borderRadius: 6,
    boxSizing: "border-box",
  },

  muted: { color: "#666", fontSize: 12, marginTop: 16 },
  error: { color: "crimson", marginBottom: 12 },
};

function App() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");

  const fetchJSON = async (url, opts = {}) => {
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const data = await res.json(); msg = data?.error || data?.message || msg; } catch {}
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  };

  const load = async () => {
    setErr("");
    try { setTasks(await fetchJSON(`${API}/tasks`)); }
    catch (e) { setErr(e.message); }
  };

  const create = async () => {
    const t = title.trim();
    if (!t) return;
    setBusy(true); setErr("");
    try {
      await fetchJSON(`${API}/tasks`, { method: "POST", body: JSON.stringify({ title: t, done: false }) });
      setTitle(""); await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const toggle = async (task) => {
    if (editingId) return;
    setBusy(true); setErr("");
    try { await fetchJSON(`${API}/tasks/${task.id}`, { method: "PUT", body: JSON.stringify({ done: !task.done }) }); await load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const remove = async (task) => {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    setBusy(true); setErr("");
    try { await fetchJSON(`${API}/tasks/${task.id}`, { method: "DELETE" }); await load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const startEdit = (task) => { setEditingId(task.id); setEditTitle(task.title); };
  const cancelEdit = () => { setEditingId(null); setEditTitle(""); };

  const saveEdit = async (id) => {
    const newTitle = editTitle.trim();
    if (!newTitle) return;
    setBusy(true); setErr("");
    try { await fetchJSON(`${API}/tasks/${id}`, { method: "PUT", body: JSON.stringify({ title: newTitle }) }); cancelEdit(); await load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const health = async () => {
    try { const h = await fetchJSON(`${API}/health`); alert(`API OK\nDriver: ${h.driver}\nUptime: ${Math.round(h.uptime)}s`); }
    catch (e) { alert(e.message); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={{ margin: 0 }}>Tasks</h1>
        <button style={styles.btn} onClick={health}>Health</button>
      </header>

      <div style={styles.composer}>
        <input
          style={styles.input}
          placeholder="Add a task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          disabled={busy}
        />
        <button
          style={{ ...styles.btn, ...styles.btnPrimary, opacity: title.trim() ? 1 : 0.6 }}
          onClick={create}
          disabled={busy || !title.trim()}
        >
          Add
        </button>
      </div>

      {err && <div style={styles.error}>{err}</div>}

      <ul style={styles.list}>
        {tasks.length === 0 && <li style={{ padding: "10px 0", color: "#666" }}>No tasks yet.</li>}
        {tasks.map((t) => {
          const isEditing = editingId === t.id;
          return (
            <li key={t.id} style={styles.row}>
              {/* checkbox cell */}
              <div style={styles.checkCell}>
                <input
                  type="checkbox"
                  checked={!!t.done}
                  onChange={() => toggle(t)}
                  disabled={busy || isEditing}
                  style={{ width: 18, height: 18 }}
                />
              </div>

              {/* title cell */}
              <div style={styles.titleCell}>
                {isEditing ? (
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(t.id)}
                    style={styles.titleInput}
                    disabled={busy}
                  />
                ) : (
                  <div style={{ ...styles.title, ...(t.done ? styles.titleDone : null) }}>
                    {t.title}
                  </div>
                )}
              </div>

              {/* actions cell */}
              <div style={styles.actionsCell}>
                {isEditing ? (
                  <>
                    <button
                      style={{ ...styles.btn, ...styles.btnPrimary, minWidth: 70 }}
                      onClick={() => saveEdit(t.id)}
                      disabled={busy || !editTitle.trim()}
                    >
                      Save
                    </button>
                    <button style={{ ...styles.btn, minWidth: 76 }} onClick={cancelEdit} disabled={busy}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button style={{ ...styles.btn, minWidth: 56 }} onClick={() => startEdit(t)} disabled={busy}>
                      Edit
                    </button>
                    <button style={{ ...styles.btn, minWidth: 68 }} onClick={() => remove(t)} disabled={busy}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div style={styles.muted}>API: <code>{API}</code></div>
    </div>
  );
}

export default App;
