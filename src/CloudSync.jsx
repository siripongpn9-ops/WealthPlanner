/* ---------------------------------------------------------
   CLOUD SYNC — keeps one copy of the data in Supabase so every
   device (home, clinic, phone) reads and edits the same file.

   How it works
   - Sign in with email + password (Supabase Auth).
   - One row per user in table `wealth_data` holds the whole data object.
   - Every edit is saved ~1 second later. Each save carries a version number;
     if another device saved in the meantime, the save is refused and you
     choose which copy to keep — nothing is silently overwritten.
   - When you come back to a tab (or every 45 s) it checks for newer data
     from other devices and loads it automatically if you have no unsaved edits.
   - This browser's localStorage is kept only as an offline cache.
--------------------------------------------------------- */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TABLE = "wealth_data";
const SAVE_DELAY_MS = 1000;
const POLL_MS = 45000;

export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabase = cloudConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const C = {
  bg: "#101820", surface: "#17212B", raised: "#1E2A38", border: "#2A3949",
  text: "#EAE7E0", muted: "#8A93A0", gold: "#C9A227", green: "#4FA37B", red: "#C1554A", blue: "#5B84B1",
};

function deviceLabel() {
  try {
    const saved = localStorage.getItem("wv_device_name");
    if (saved) return saved;
  } catch (e) {}
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "อุปกรณ์อื่น";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return `${os} · ${br}`;
}

function fmtTime(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  } catch (e) {
    return iso;
  }
}

function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function summarize(d) {
  if (!d) return "ไม่มีข้อมูล";
  const n = (k) => (Array.isArray(d[k]) ? d[k].length : 0);
  return `หุ้น/กองทุน ${n("offshoreStocks") + n("domesticFunds")} · หนี้ ${n("liabilities")} · ประกัน ${n("insurancePolicies")} · รายการเงิน ${n("transactions")}`;
}

/* ---------------- sync engine (plain JS, outside React state) ---------------- */

function createEngine({ userId, row, normalize, onStatus, onConflict }) {
  const s = {
    version: row.version,
    lastSyncedJson: JSON.stringify(normalize(row.data)),
    lastRemote: { updated_at: row.updated_at, updated_by: row.updated_by },
    pendingJson: null,
    saving: false,
    conflict: null,
    timer: null,
    listeners: new Set(),
    stopped: false,
  };

  const status = (st) => onStatus({ state: st, ...s.lastRemote });

  function schedule(ms) {
    clearTimeout(s.timer);
    s.timer = setTimeout(flush, ms);
  }

  async function flush() {
    if (s.stopped || s.saving || !s.pendingJson || s.conflict) return;
    s.saving = true;
    status("saving");
    const toSave = s.pendingJson;
    const now = new Date().toISOString();
    const { data: rows, error } = await supabase
      .from(TABLE)
      .update({ data: JSON.parse(toSave), version: s.version + 1, updated_at: now, updated_by: deviceLabel() })
      .eq("user_id", userId)
      .eq("version", s.version) // only succeeds if nobody else saved since we last synced
      .select("version, updated_at, updated_by");
    s.saving = false;
    if (error) {
      status("offline");
      schedule(10000);
      return;
    }
    if (!rows || rows.length === 0) {
      await raiseConflict();
      return;
    }
    s.version = rows[0].version;
    s.lastRemote = { updated_at: rows[0].updated_at, updated_by: rows[0].updated_by };
    s.lastSyncedJson = toSave;
    if (s.pendingJson === toSave) s.pendingJson = null;
    if (s.pendingJson) {
      status("dirty");
      schedule(300);
    } else {
      status("saved");
    }
  }

  async function fetchRow() {
    const { data, error } = await supabase.from(TABLE).select("data, version, updated_at, updated_by").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function raiseConflict(known) {
    let remote = known;
    if (!remote) {
      try {
        remote = await fetchRow();
      } catch (e) {
        status("offline");
        schedule(10000);
        return;
      }
    }
    if (!remote) return;
    s.conflict = remote;
    status("conflict");
    onConflict(remote);
  }

  function applyRemote(remote) {
    const normalized = normalize(remote.data);
    s.version = remote.version;
    s.lastRemote = { updated_at: remote.updated_at, updated_by: remote.updated_by };
    s.lastSyncedJson = JSON.stringify(normalized);
    s.pendingJson = null;
    s.conflict = null;
    s.listeners.forEach((fn) => fn(normalized));
    status("saved");
  }

  async function checkRemote() {
    if (s.stopped || s.saving || s.conflict) return;
    let remote;
    try {
      remote = await fetchRow();
    } catch (e) {
      status("offline");
      return;
    }
    if (!remote || remote.version <= s.version) {
      if (!s.pendingJson) status("saved");
      return;
    }
    if (s.pendingJson) await raiseConflict(remote); // both sides changed
    else applyRemote(remote); // only the other device changed — just take it
  }

  return {
    initialData: normalize(row.data),
    queueSave(data) {
      const json = JSON.stringify(data);
      if (json === s.lastSyncedJson) {
        s.pendingJson = null;
        return;
      }
      s.pendingJson = json;
      if (s.conflict) return;
      status("dirty");
      schedule(SAVE_DELAY_MS);
    },
    subscribe(fn) {
      s.listeners.add(fn);
      return () => s.listeners.delete(fn);
    },
    flushNow() {
      clearTimeout(s.timer);
      return flush();
    },
    checkRemote,
    hasUnsaved: () => Boolean(s.pendingJson),
    // conflict resolution
    keepRemote() {
      if (s.conflict) applyRemote(s.conflict);
    },
    keepLocal() {
      if (!s.conflict) return;
      s.version = s.conflict.version;
      s.lastRemote = { updated_at: s.conflict.updated_at, updated_by: s.conflict.updated_by };
      s.conflict = null;
      if (!s.pendingJson) s.pendingJson = s.lastSyncedJson;
      flush();
    },
    pendingData: () => (s.pendingJson ? JSON.parse(s.pendingJson) : null),
    stop() {
      s.stopped = true;
      clearTimeout(s.timer);
      s.listeners.clear();
    },
  };
}

/* ---------------- UI pieces ---------------- */

function Shell({ children }) {
  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "Inter, system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 440, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
        {children}
      </div>
    </div>
  );
}

function Btn({ children, onClick, kind = "primary", disabled, type = "button" }) {
  const styles = {
    primary: { background: C.gold, color: C.bg, border: `1px solid ${C.gold}` },
    ghost: { background: "transparent", color: C.text, border: `1px solid ${C.border}` },
    danger: { background: "transparent", color: C.red, border: `1px solid ${C.red}` },
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{ ...styles, width: "100%", padding: "10px 14px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1, marginTop: 10 }}
    >
      {children}
    </button>
  );
}

function Title({ children, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: "1.35rem" }}>{children}</div>
      {sub && <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>{sub}</div>}
    </div>
  );
}

function InfoBox({ label, children }) {
  return (
    <div style={{ background: C.raised, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", marginTop: 10, fontSize: 12.5, lineHeight: 1.6 }}>
      <div style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      {children}
    </div>
  );
}

const thaiAuthError = (msg = "") => {
  if (/Invalid login credentials/i.test(msg)) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (/Email not confirmed/i.test(msg)) return "ยังไม่ได้ยืนยันอีเมล — กดลิงก์ในอีเมลที่ Supabase ส่งไปก่อน";
  if (/already registered/i.test(msg)) return "อีเมลนี้มีบัญชีอยู่แล้ว — กดเข้าสู่ระบบแทน";
  if (/Signups not allowed/i.test(msg)) return "ระบบปิดการสมัครบัญชีใหม่แล้ว";
  if (/Password should be/i.test(msg)) return "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร (แนะนำ 12+)";
  if (/fetch|network/i.test(msg)) return "เชื่อมต่อไม่ได้ — ตรวจสอบอินเทอร์เน็ต";
  return msg || "เกิดข้อผิดพลาด";
};

function LoginScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setMsg({ err: true, text: thaiAuthError(error.message) });
    } else {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) setMsg({ err: true, text: thaiAuthError(error.message) });
      else if (!data.session) setMsg({ err: false, text: "สร้างบัญชีแล้ว — เปิดอีเมลเพื่อกดยืนยัน แล้วกลับมาเข้าสู่ระบบ" });
    }
    setBusy(false);
  }

  const input = { width: "100%", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", color: C.text, fontSize: 14, marginTop: 6, outline: "none" };
  return (
    <Shell>
      <Title sub="ข้อมูลเก็บไว้ที่เดียวบน cloud — เข้าสู่ระบบด้วยบัญชีเดียวกัน แล้วที่บ้าน คลินิก หรือมือถือ จะเห็นและแก้ไขข้อมูลชุดเดียวกัน">
        {mode === "login" ? "เข้าสู่ระบบ Wealth Vitality" : "สร้างบัญชี"}
      </Title>
      <form onSubmit={submit}>
        <label style={{ fontSize: 12.5, color: C.muted }}>อีเมล</label>
        <input style={input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <div style={{ height: 12 }} />
        <label style={{ fontSize: 12.5, color: C.muted }}>รหัสผ่าน</label>
        <input style={input} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        {msg && <div style={{ marginTop: 12, fontSize: 13, color: msg.err ? C.red : C.green, lineHeight: 1.5 }}>{msg.text}</div>}
        <Btn type="submit" disabled={busy}>{busy ? "กำลังดำเนินการ…" : mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชี"}</Btn>
      </form>
      <div style={{ textAlign: "center", marginTop: 14, fontSize: 12.5, color: C.muted }}>
        {mode === "login" ? "ยังไม่มีบัญชี? " : "มีบัญชีแล้ว? "}
        <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMsg(null); }} style={{ color: C.gold, background: "none", border: "none", cursor: "pointer", fontSize: 12.5 }}>
          {mode === "login" ? "สร้างบัญชี" : "เข้าสู่ระบบ"}
        </button>
      </div>
    </Shell>
  );
}

/* First connection on a device: decide what goes up to / comes down from the cloud. */
function SetupScreen({ remote, local, normalize, onChoose, email, onSignOut }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        run(() => onChoose("upload", normalize(parsed)));
      } catch (err) {
        alert("ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลที่ถูกต้อง");
      }
    };
    reader.readAsText(file);
  }

  const footer = (
    <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: C.muted }}>
      {email} ·{" "}
      <button onClick={onSignOut} style={{ color: C.gold, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>ออกจากระบบ</button>
    </div>
  );
  const fileInput = <input ref={fileRef} type="file" accept=".json,application/json" onChange={pickFile} style={{ display: "none" }} />;

  if (!remote) {
    return (
      <Shell>
        <Title sub="นี่คือการเชื่อมต่อครั้งแรก เลือกข้อมูลตั้งต้นที่จะเก็บไว้บน cloud — หลังจากนี้ทุกเครื่องจะใช้ชุดนี้">ยังไม่มีข้อมูลบน cloud</Title>
        <Btn disabled={busy} onClick={() => fileRef.current.click()}>นำเข้าจากไฟล์สำรอง (.json) — แนะนำ</Btn>
        {local && (
          <>
            <InfoBox label="ข้อมูลในเบราว์เซอร์เครื่องนี้">{summarize(local)}</InfoBox>
            <Btn kind="ghost" disabled={busy} onClick={() => run(() => onChoose("upload", local))}>อัปโหลดข้อมูลในเครื่องนี้</Btn>
          </>
        )}
        <Btn kind="ghost" disabled={busy} onClick={() => run(() => onChoose("upload", normalize(null)))}>เริ่มจากข้อมูลว่าง</Btn>
        {fileInput}
        {footer}
      </Shell>
    );
  }

  return (
    <Shell>
      <Title sub="เครื่องนี้มีข้อมูลเก่าเก็บไว้ และไม่ตรงกับข้อมูลบน cloud — เลือกว่าจะใช้ชุดไหน ระบบจะดาวน์โหลดไฟล์สำรองของชุดที่ไม่ได้เลือกให้อัตโนมัติ ไม่มีอะไรหาย">
        ข้อมูลในเครื่องนี้ไม่ตรงกับ cloud
      </Title>
      <InfoBox label={`บน cloud · แก้ล่าสุด ${fmtTime(remote.updated_at)}${remote.updated_by ? ` · ${remote.updated_by}` : ""}`}>{summarize(remote.data)}</InfoBox>
      <InfoBox label="ในเบราว์เซอร์เครื่องนี้">{summarize(local)}</InfoBox>
      <Btn
        disabled={busy}
        onClick={() => run(async () => {
          downloadJson(local, `wealth-vitality-this-device-${stamp()}.json`);
          await onChoose("useRemote");
        })}
      >
        ใช้ข้อมูลบน cloud (แนะนำ)
      </Btn>
      <Btn
        kind="danger"
        disabled={busy}
        onClick={() => {
          if (!window.confirm("ข้อมูลบน cloud จะถูกแทนด้วยข้อมูลเครื่องนี้ (ระบบจะดาวน์โหลดสำรองของ cloud ไว้ก่อน) ต้องการดำเนินการต่อหรือไม่?")) return;
          run(async () => {
            downloadJson(remote.data, `wealth-vitality-cloud-${stamp()}.json`);
            await onChoose("overwrite", local);
          });
        }}
      >
        ใช้ข้อมูลเครื่องนี้ทับ cloud
      </Btn>
      {footer}
    </Shell>
  );
}

function ConflictDialog({ remote, engine, onDone }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0008", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "Inter, system-ui, sans-serif", color: C.text }}>
      <div style={{ width: "100%", maxWidth: 440, background: C.surface, border: `1px solid ${C.gold}`, borderRadius: 16, padding: 22 }}>
        <Title sub="มีอีกเครื่องบันทึกข้อมูลระหว่างที่คุณกำลังแก้ไข การแก้ไขบนเครื่องนี้จึงยังไม่ถูกบันทึก เลือกว่าจะเก็บชุดไหน — ระบบจะดาวน์โหลดสำรองของชุดที่ไม่ได้เลือกให้อัตโนมัติ">
          ข้อมูลถูกแก้จากอีกเครื่อง
        </Title>
        <InfoBox label="อีกเครื่อง">
          บันทึกเมื่อ {fmtTime(remote.updated_at)}
          {remote.updated_by ? ` · ${remote.updated_by}` : ""}
        </InfoBox>
        <Btn
          onClick={() => {
            const mine = engine.pendingData();
            if (mine) downloadJson(mine, `wealth-vitality-my-unsaved-edits-${stamp()}.json`);
            engine.keepRemote();
            onDone();
          }}
        >
          โหลดข้อมูลล่าสุดจากอีกเครื่อง (แนะนำ)
        </Btn>
        <Btn
          kind="danger"
          onClick={() => {
            downloadJson(remote.data, `wealth-vitality-other-device-${stamp()}.json`);
            engine.keepLocal();
            onDone();
          }}
        >
          ใช้ข้อมูลเครื่องนี้ทับ
        </Btn>
      </div>
    </div>
  );
}

const STATUS_TEXT = {
  saved: { dot: C.green, text: "บันทึกบน cloud แล้ว" },
  dirty: { dot: C.gold, text: "รอบันทึก…" },
  saving: { dot: C.gold, text: "กำลังบันทึก…" },
  offline: { dot: C.red, text: "ออฟไลน์ — จะบันทึกเมื่อเชื่อมต่อได้" },
  conflict: { dot: C.red, text: "ข้อมูลชนกัน — ต้องเลือก" },
};

function StatusPill({ status, email, onRefresh, onSignOut }) {
  const [open, setOpen] = useState(false);
  const st = STATUS_TEXT[status.state] || STATUS_TEXT.saved;
  return (
    <div style={{ position: "fixed", left: 12, bottom: 12, zIndex: 900, fontFamily: "Inter, system-ui, sans-serif", fontSize: 12 }}>
      {open && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 8, width: 250, color: C.text, boxShadow: "0 8px 24px #0006" }}>
          <div style={{ color: C.muted, fontSize: 11 }}>เข้าสู่ระบบเป็น</div>
          <div style={{ marginBottom: 8, wordBreak: "break-all" }}>{email}</div>
          <div style={{ color: C.muted, fontSize: 11 }}>บันทึกล่าสุดบน cloud</div>
          <div style={{ marginBottom: 10 }}>
            {fmtTime(status.updated_at)}
            {status.updated_by ? ` · ${status.updated_by}` : ""}
          </div>
          <button onClick={() => { onRefresh(); setOpen(false); }} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: C.raised, color: C.text, border: `1px solid ${C.border}`, cursor: "pointer", marginBottom: 6 }}>
            ดึงข้อมูลล่าสุด
          </button>
          <button onClick={onSignOut} style={{ width: "100%", padding: "7px 10px", borderRadius: 8, background: "transparent", color: C.red, border: `1px solid ${C.red}`, cursor: "pointer" }}>
            ออกจากระบบ (ล้างข้อมูลในเครื่องนี้)
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        title="สถานะการบันทึกข้อมูล"
        style={{ display: "flex", alignItems: "center", gap: 7, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 999, padding: "6px 11px", color: C.text, cursor: "pointer", boxShadow: "0 4px 12px #0005" }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: st.dot, display: "inline-block" }} />
        {st.text}
      </button>
    </div>
  );
}

/* ---------------- gate: auth → first-link → app ---------------- */

export function CloudGate({ normalize, readLocal, clearLocal, children }) {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [phase, setPhase] = useState({ name: "loading" });
  const [status, setStatus] = useState({ state: "saved" });
  const [conflict, setConflict] = useState(null);
  const engineRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;
  const linkedKey = userId ? `wv_cloud_linked_${userId}` : null;

  function startEngine(row) {
    engineRef.current?.stop();
    const engine = createEngine({ userId, row, normalize, onStatus: setStatus, onConflict: setConflict });
    engineRef.current = engine;
    try {
      localStorage.setItem(linkedKey, "1");
    } catch (e) {}
    setStatus({ state: "saved", updated_at: row.updated_at, updated_by: row.updated_by });
    setPhase({ name: "ready", engine });
  }

  // After sign-in: load the cloud row and decide whether this device needs a first-link choice.
  useEffect(() => {
    if (!userId) {
      engineRef.current?.stop();
      engineRef.current = null;
      setPhase({ name: "loading" });
      return;
    }
    let cancelled = false;
    (async () => {
      setPhase({ name: "loading" });
      const { data: row, error } = await supabase.from(TABLE).select("data, version, updated_at, updated_by").eq("user_id", userId).maybeSingle();
      if (cancelled) return;
      if (error) {
        setPhase({ name: "error", message: error.message });
        return;
      }
      const local = readLocal();
      let linked = false;
      try {
        linked = localStorage.getItem(linkedKey) === "1";
      } catch (e) {}
      if (!row) {
        setPhase({ name: "setup", remote: null, local });
        return;
      }
      const differs = local && JSON.stringify(local) !== JSON.stringify(normalize(row.data));
      if (differs && !linked) setPhase({ name: "setup", remote: row, local });
      else startEngine(row);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function chooseSetup(action, payload) {
    const now = new Date().toISOString();
    if (action === "useRemote") {
      startEngine(phase.remote);
      return;
    }
    if (action === "upload") {
      const { data, error } = await supabase
        .from(TABLE)
        .insert({ user_id: userId, data: payload, version: 1, updated_at: now, updated_by: deviceLabel() })
        .select("data, version, updated_at, updated_by")
        .single();
      if (error) return alert(`อัปโหลดไม่สำเร็จ: ${error.message}`);
      startEngine(data);
      return;
    }
    if (action === "overwrite") {
      const { data, error } = await supabase
        .from(TABLE)
        .update({ data: payload, version: phase.remote.version + 1, updated_at: now, updated_by: deviceLabel() })
        .eq("user_id", userId)
        .eq("version", phase.remote.version)
        .select("data, version, updated_at, updated_by");
      if (error) return alert(`อัปโหลดไม่สำเร็จ: ${error.message}`);
      if (!data?.length) {
        alert("ข้อมูลบน cloud เพิ่งถูกแก้จากอีกเครื่อง — โหลดหน้าใหม่แล้วลองอีกครั้ง");
        return;
      }
      startEngine(data[0]);
    }
  }

  // Background checks + flush on leave.
  useEffect(() => {
    if (phase.name !== "ready") return;
    const engine = phase.engine;
    const onVis = () => {
      if (document.visibilityState === "visible") engine.checkRemote();
      else engine.flushNow();
    };
    const onOnline = () => {
      engine.flushNow();
      engine.checkRemote();
    };
    const onFocus = () => engine.checkRemote();
    const onBeforeUnload = (e) => {
      if (engine.hasUnsaved()) {
        engine.flushNow();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") engine.checkRemote();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [phase]);

  async function signOut() {
    const engine = engineRef.current;
    if (engine?.hasUnsaved()) {
      await engine.flushNow();
      if (engine.hasUnsaved() && !window.confirm("ยังมีการแก้ไขที่บันทึกขึ้น cloud ไม่สำเร็จ ออกจากระบบตอนนี้การแก้ไขนั้นจะหาย ต้องการออกหรือไม่?")) return;
    }
    engine?.stop();
    engineRef.current = null;
    clearLocal(); // don't leave a copy of the family's finances on a shared computer
    try {
      if (linkedKey) localStorage.removeItem(linkedKey);
    } catch (e) {}
    await supabase.auth.signOut();
  }

  const cloud = useMemo(() => (phase.name === "ready" ? phase.engine : null), [phase]);

  if (session === undefined || (session && phase.name === "loading")) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", color: C.muted, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, system-ui, sans-serif", fontSize: 14 }}>
        กำลังโหลดข้อมูล…
      </div>
    );
  }
  if (!session) return <LoginScreen />;
  if (phase.name === "error") {
    return (
      <Shell>
        <Title sub={phase.message}>โหลดข้อมูลจาก cloud ไม่สำเร็จ</Title>
        <Btn onClick={() => window.location.reload()}>ลองใหม่</Btn>
        <Btn kind="ghost" onClick={signOut}>ออกจากระบบ</Btn>
      </Shell>
    );
  }
  if (phase.name === "setup") {
    return <SetupScreen remote={phase.remote} local={phase.local} normalize={normalize} onChoose={chooseSetup} email={session.user.email} onSignOut={signOut} />;
  }

  return (
    <>
      {children(cloud)}
      <StatusPill status={status} email={session.user.email} onRefresh={() => cloud.checkRemote()} onSignOut={signOut} />
      {conflict && <ConflictDialog remote={conflict} engine={cloud} onDone={() => setConflict(null)} />}
    </>
  );
}

/* Shown only when the Supabase env vars are missing — app keeps working on this device alone. */
export function LocalOnlyBadge() {
  return (
    <div
      title="ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — ข้อมูลเก็บเฉพาะในเบราว์เซอร์เครื่องนี้"
      style={{ position: "fixed", left: 12, bottom: 12, zIndex: 900, display: "flex", alignItems: "center", gap: 7, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 999, padding: "6px 11px", color: C.muted, fontFamily: "Inter, system-ui, sans-serif", fontSize: 12 }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: C.gold, display: "inline-block" }} />
      เก็บเฉพาะเครื่องนี้ (ยังไม่เปิด cloud sync)
    </div>
  );
}
