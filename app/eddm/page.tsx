"use client";

import { useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SAClient {
  name: string;
  matchedPhone: string;
  homePhone: string;
  workPhone: string;
  cellPhone: string;
  address: string;
}

interface FlyerResult {
  flyerName: string;
  trackingNumber: string;
  totalCalls: number;
  conversions: number;
  matchedClients: SAClient[];
}

interface MatchResponse {
  results: FlyerResult[];
  totalCalls: number;
  totalMatched: number;
  saClientsRead: number;
  error?: string;
}

// ─── Theme ────────────────────────────────────────────────────────────────────
const C = {
  bg:         "#f8fafc",
  card:       "#ffffff",
  border:     "#e2e8f0",
  text:       "#0f172a",
  textSec:    "#475569",
  textMuted:  "#94a3b8",
  blue:       "#2563eb",
  blueSoft:   "#eff6ff",
  green:      "#16a34a",
  greenSoft:  "#f0fdf4",
  orange:     "#ea580c",
  orangeSoft: "#fff7ed",
  purple:     "#7c3aed",
  purpleSoft: "#f5f3ff",
  red:        "#dc2626",
  redSoft:    "#fef2f2",
  amber:      "#d97706",
  amberSoft:  "#fffbeb",
  shadow:     "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:   "0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtMoney(n: number) {
  if (!isFinite(n)) return "—";
  if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + n.toFixed(2);
}

function fmtPhone(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return raw;
}

function accept() {
  return ".csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
}

function fileSizeWarning(file: File): { level: "warn" | "danger" | null; msg: string } {
  const mb = file.size / (1024 * 1024);
  const isExcel = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
  if (mb > 8) return { level: "danger", msg: `${mb.toFixed(1)} MB — very likely to fail (limit ~4.5 MB). Export as CSV to fix this.` };
  if (mb > 4) return { level: "warn",   msg: `${mb.toFixed(1)} MB — close to the 4.5 MB limit. ${isExcel ? "Try exporting as CSV instead." : "May time out on large rows."}` };
  if (mb > 2 && isExcel) return { level: "warn", msg: `${mb.toFixed(1)} MB Excel file — if it fails, re-export as CSV (much smaller).` };
  return { level: null, msg: "" };
}

function fmtFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg style={{ width: 18, height: 18 }} className="animate-spin" fill="none" viewBox="0 0 24 24">
      <circle style={{ opacity: 0.2 }} cx="12" cy="12" r="10" stroke="white" strokeWidth="4" />
      <path style={{ opacity: 0.8 }} fill="white" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ─── Upload Card ──────────────────────────────────────────────────────────────
function UploadCard({
  label, sublabel, icon, file, onFile, onClear, disabled, accent, accentSoft, required,
}: {
  label: string; sublabel: string; icon: string; file: File | null;
  onFile: (f: File) => void; onClear: () => void;
  disabled?: boolean; accent: string; accentSoft: string; required?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const warning = file ? fileSizeWarning(file) : { level: null, msg: "" };

  const borderColor = file
    ? warning.level === "danger" ? C.red : warning.level === "warn" ? C.amber : accent
    : disabled ? "#cbd5e1" : C.border;

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0 }}>
      <div
        onClick={() => !disabled && !file && ref.current?.click()}
        style={{
          background: file ? (warning.level === "danger" ? C.redSoft : warning.level === "warn" ? C.amberSoft : accentSoft) : disabled ? "#f1f5f9" : C.card,
          border: `2px ${file ? "solid" : "dashed"} ${borderColor}`,
          borderRadius: warning.level ? "14px 14px 0 0" : 14,
          padding: "24px 20px",
          cursor: disabled ? "not-allowed" : file ? "default" : "pointer",
          transition: "all 0.2s",
          position: "relative",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        {required && !file && (
          <span style={{
            position: "absolute", top: 10, right: 12,
            fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
            color: accent, background: accentSoft,
            padding: "2px 7px", borderRadius: 20, textTransform: "uppercase",
          }}>Required</span>
        )}

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: file
              ? warning.level === "danger" ? "#fee2e220" : warning.level === "warn" ? "#fef3c720" : accent + "20"
              : disabled ? "#e2e8f0" : accentSoft,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22,
          }}>{icon}</div>

          {file ? (
            <>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 3, wordBreak: "break-all" }}>{file.name}</p>
                <p style={{ fontSize: 12, color: C.textSec, display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                  <span style={{
                    display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                    background: warning.level === "danger" ? C.red : warning.level === "warn" ? C.amber : C.green,
                  }} />
                  {fmtFileSize(file.size)}
                  &nbsp;•&nbsp;
                  {file.name.split(".").pop()?.toUpperCase()}
                </p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onClear(); }}
                style={{
                  fontSize: 12, color: C.red, background: C.redSoft,
                  border: "none", borderRadius: 8, padding: "5px 14px",
                  cursor: "pointer", fontWeight: 600,
                }}
              >Remove</button>
            </>
          ) : (
            <>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: disabled ? C.textMuted : C.text, marginBottom: 3 }}>{label}</p>
                <p style={{ fontSize: 12, color: C.textMuted }}>{disabled ? "Locked — clear other region first" : sublabel}</p>
              </div>
              {!disabled && (
                <p style={{ fontSize: 11, color: C.textMuted }}>CSV or Excel (.xlsx)</p>
              )}
            </>
          )}
        </div>

        <input
          ref={ref}
          type="file"
          accept={accept()}
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
        />
      </div>

      {/* ── File size warning banner ─────────────────────────────────────── */}
      {file && warning.level && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 9,
          padding: "10px 14px",
          background: warning.level === "danger" ? "#fef2f2" : "#fffbeb",
          border: `1px solid ${warning.level === "danger" ? "#fecaca" : "#fde68a"}`,
          borderTop: "none",
          borderRadius: "0 0 14px 14px",
        }}>
          <span style={{ fontSize: 14, marginTop: 1, flexShrink: 0 }}>
            {warning.level === "danger" ? "🚫" : "⚠️"}
          </span>
          <p style={{
            fontSize: 12, lineHeight: 1.5,
            color: warning.level === "danger" ? "#991b1b" : "#92400e",
            fontWeight: 500,
          }}>
            {warning.msg}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function EDDMPage() {
  const [callrailFile, setCallrailFile]     = useState<File | null>(null);
  const [floridaFile,  setFloridaFile]      = useState<File | null>(null);
  const [georgiaFile,  setGeorgiaFile]      = useState<File | null>(null);
  const [loading,      setLoading]          = useState(false);
  const [error,        setError]            = useState<string | null>(null);
  const [response,     setResponse]         = useState<MatchResponse | null>(null);
  const [expanded,     setExpanded]         = useState<Set<string>>(new Set());
  const [spends,       setSpends]           = useState<Record<string, string>>({});

  const clientFile   = floridaFile ?? georgiaFile;
  const clientRegion = floridaFile ? "florida" : georgiaFile ? "georgia" : null;
  const canSubmit    = !!callrailFile && !!clientFile && !loading;

  function toggleExpand(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    setExpanded(new Set());
    setSpends({});

    try {
      const fd = new FormData();
      fd.append("callrail", callrailFile!);
      fd.append("clients",  clientFile!);
      fd.append("region",   clientRegion!);

      const res  = await fetch("/api/eddm-match", { method: "POST", body: fd });
      const data = await res.json() as MatchResponse;

      if (!res.ok || data.error) {
        setError(data.error ?? "Something went wrong. Please try again.");
      } else {
        setResponse(data);
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Spend helpers ──────────────────────────────────────────────────────────
  function getSpend(key: string)   { return parseFloat(spends[key] ?? "") || 0; }
  function getCAC(key: string, conversions: number) {
    const s = getSpend(key);
    return s > 0 && conversions > 0 ? s / conversions : null;
  }

  const totalSpend = response
    ? response.results.reduce((sum, r) => sum + getSpend(r.flyerName + r.trackingNumber), 0)
    : 0;
  const overallCAC = totalSpend > 0 && (response?.totalMatched ?? 0) > 0
    ? totalSpend / response!.totalMatched
    : null;

  return (
    <>
      <style>{`
        @keyframes scan { 0%{left:-30%} 100%{left:110%} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.bg}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .hover-row:hover { background: #f8fafc !important; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
      `}</style>

      <div style={{ minHeight: "100vh", background: C.bg, padding: "0 0 60px" }}>

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div style={{
          background: C.card, borderBottom: `1px solid ${C.border}`,
          padding: "20px 32px", display: "flex", alignItems: "center", gap: 14,
          boxShadow: C.shadow,
        }}>
          <div style={{
            width: 42, height: 42, borderRadius: 11,
            background: C.purpleSoft, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20,
          }}>📮</div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>
              EDDM CAC Tracker
            </h1>
            <p style={{ fontSize: 13, color: C.textSec, marginTop: 2 }}>
              Upload CallRail + client data to calculate cost per acquisition per flyer
            </p>
          </div>
        </div>

        <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>

          {/* ── Upload Section ─────────────────────────────────────────────── */}
          <div style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 16, padding: "28px 24px",
            boxShadow: C.shadow, marginBottom: 24,
          }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>
              Step 1 — Upload Files
            </h2>
            <p style={{ fontSize: 13, color: C.textSec, marginBottom: 22 }}>
              Upload your CallRail call log and either the Florida <em>or</em> Georgia client list from Service Autopilot.
            </p>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <UploadCard
                label="CallRail Data"
                sublabel="Export from CallRail dashboard"
                icon="📞"
                file={callrailFile}
                onFile={setCallrailFile}
                onClear={() => setCallrailFile(null)}
                accent={C.blue}
                accentSoft={C.blueSoft}
                required
              />
              <UploadCard
                label="Florida Clients"
                sublabel="Service Autopilot FL export"
                icon="🌴"
                file={floridaFile}
                onFile={setFloridaFile}
                onClear={() => setFloridaFile(null)}
                disabled={!!georgiaFile}
                accent={C.orange}
                accentSoft={C.orangeSoft}
              />
              <UploadCard
                label="Georgia Clients"
                sublabel="Service Autopilot GA export"
                icon="🍑"
                file={georgiaFile}
                onFile={setGeorgiaFile}
                onClear={() => setGeorgiaFile(null)}
                disabled={!!floridaFile}
                accent={C.green}
                accentSoft={C.greenSoft}
              />
            </div>

            {/* Region badge */}
            {clientRegion && (
              <p style={{
                marginTop: 16, fontSize: 12, color: clientRegion === "florida" ? C.orange : C.green,
                fontWeight: 600,
              }}>
                {clientRegion === "florida" ? "🌴 Florida" : "🍑 Georgia"} client list loaded — Georgia {clientRegion === "florida" ? "" : "Florida "}upload locked
              </p>
            )}
          </div>

          {/* ── Find CAC Button ────────────────────────────────────────────── */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                background: canSubmit ? C.blue : "#cbd5e1",
                color: "white",
                border: "none",
                borderRadius: 12,
                padding: "14px 40px",
                fontSize: 15,
                fontWeight: 700,
                cursor: canSubmit ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                gap: 10,
                boxShadow: canSubmit ? `0 4px 14px ${C.blue}40` : "none",
                transition: "all 0.2s",
                letterSpacing: "-0.01em",
              }}
            >
              {loading ? <><Spinner /> Matching...</> : "Find CAC"}
            </button>
          </div>

          {/* ── Error ─────────────────────────────────────────────────────── */}
          {error && (
            <div style={{
              background: C.redSoft, border: `1px solid ${C.red}30`,
              borderRadius: 12, padding: "14px 18px", marginBottom: 24,
              fontSize: 14, color: C.red, fontWeight: 500,
            }}>
              {error}
            </div>
          )}

          {/* ── Results ───────────────────────────────────────────────────── */}
          {response && (
            <>
              {/* Summary cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 28 }}>
                {[
                  { label: "Total Calls",    value: response.totalCalls.toLocaleString(),    icon: "📞", color: C.blue,   soft: C.blueSoft },
                  { label: "SA Clients Read", value: response.saClientsRead.toLocaleString(), icon: "👥", color: C.purple, soft: C.purpleSoft },
                  { label: "Conversions",    value: response.totalMatched.toLocaleString(),   icon: "✅", color: C.green,  soft: C.greenSoft },
                  { label: "Overall CAC",    value: overallCAC ? fmtMoney(overallCAC) : "Add spend ↓", icon: "💰", color: C.orange, soft: C.orangeSoft },
                ].map(m => (
                  <div key={m.label} style={{
                    background: C.card, border: `1px solid ${C.border}`,
                    borderRadius: 14, padding: "18px 16px",
                    boxShadow: C.shadow, position: "relative", overflow: "hidden",
                  }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: m.color }} />
                    <div style={{
                      width: 34, height: 34, borderRadius: 9, background: m.soft,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 16, marginBottom: 12,
                    }}>{m.icon}</div>
                    <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: C.textMuted, marginBottom: 4 }}>
                      {m.label}
                    </p>
                    <p style={{ fontSize: 24, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>
                      {m.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Flyer cards */}
              <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 14 }}>
                Results by Flyer
              </h2>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {response.results.map(flyer => {
                  const key      = flyer.flyerName + flyer.trackingNumber;
                  const isOpen   = expanded.has(key);
                  const cac      = getCAC(key, flyer.conversions);
                  const convRate = flyer.totalCalls > 0
                    ? ((flyer.conversions / flyer.totalCalls) * 100).toFixed(1)
                    : "0.0";

                  return (
                    <div key={key} style={{
                      background: C.card, border: `1px solid ${C.border}`,
                      borderRadius: 14, overflow: "hidden", boxShadow: C.shadow,
                    }}>
                      {/* Card header */}
                      <div style={{ padding: "20px 22px" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4, lineHeight: 1.3 }}>
                              {flyer.flyerName}
                            </h3>
                            <p style={{ fontSize: 12, color: C.textMuted, fontFamily: "monospace" }}>
                              {fmtPhone(flyer.trackingNumber)}
                            </p>
                          </div>

                          {/* Stats pills */}
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{
                              fontSize: 12, fontWeight: 600, padding: "5px 12px",
                              borderRadius: 20, background: C.blueSoft, color: C.blue,
                            }}>
                              {flyer.totalCalls} calls
                            </span>
                            <span style={{
                              fontSize: 12, fontWeight: 600, padding: "5px 12px",
                              borderRadius: 20,
                              background: flyer.conversions > 0 ? C.greenSoft : "#f1f5f9",
                              color: flyer.conversions > 0 ? C.green : C.textMuted,
                            }}>
                              {flyer.conversions} converted
                            </span>
                            <span style={{
                              fontSize: 12, fontWeight: 600, padding: "5px 12px",
                              borderRadius: 20, background: C.orangeSoft, color: C.orange,
                            }}>
                              {convRate}% rate
                            </span>
                          </div>
                        </div>

                        {/* Spend + CAC row */}
                        <div style={{
                          display: "flex", alignItems: "center", gap: 16, marginTop: 16,
                          paddingTop: 16, borderTop: `1px solid ${C.border}`, flexWrap: "wrap",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: C.textSec, whiteSpace: "nowrap" }}>
                              Flyer Spend
                            </label>
                            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                              <span style={{
                                position: "absolute", left: 10, fontSize: 13, color: C.textMuted, fontWeight: 600,
                              }}>$</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                value={spends[key] ?? ""}
                                onChange={e => setSpends(prev => ({ ...prev, [key]: e.target.value }))}
                                style={{
                                  width: 110, paddingLeft: 22, paddingRight: 10,
                                  paddingTop: 7, paddingBottom: 7,
                                  border: `1px solid ${C.border}`, borderRadius: 8,
                                  fontSize: 13, color: C.text, background: C.bg,
                                  outline: "none",
                                }}
                              />
                            </div>
                          </div>

                          {cac !== null && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 12, color: C.textSec, fontWeight: 600 }}>CAC</span>
                              <span style={{
                                fontSize: 18, fontWeight: 800, color: C.text,
                                letterSpacing: "-0.02em",
                              }}>{fmtMoney(cac)}</span>
                              <span style={{ fontSize: 12, color: C.textMuted }}>per client</span>
                            </div>
                          )}

                          {flyer.conversions > 0 && (
                            <button
                              onClick={() => toggleExpand(key)}
                              style={{
                                marginLeft: "auto", fontSize: 12, fontWeight: 600,
                                color: C.blue, background: C.blueSoft,
                                border: "none", borderRadius: 8, padding: "7px 16px",
                                cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                              }}
                            >
                              {isOpen ? "Hide" : `View ${flyer.conversions} client${flyer.conversions !== 1 ? "s" : ""}`}
                              <span style={{ fontSize: 10, display: "inline-block", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded client list */}
                      {isOpen && flyer.matchedClients.length > 0 && (
                        <div style={{ borderTop: `1px solid ${C.border}` }}>
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                              <thead>
                                <tr style={{ background: "#f8fafc" }}>
                                  {["#", "Name", "Matched Phone", "Cell", "Home", "Work", "Address"].map(h => (
                                    <th key={h} style={{
                                      padding: "10px 16px", textAlign: "left",
                                      fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                                      textTransform: "uppercase", color: C.textMuted,
                                      borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                                    }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {flyer.matchedClients.map((client, i) => (
                                  <tr key={i} className="hover-row" style={{ borderBottom: `1px solid ${C.border}` }}>
                                    <td style={{ padding: "10px 16px", color: C.textMuted, fontWeight: 600 }}>{i + 1}</td>
                                    <td style={{ padding: "10px 16px", fontWeight: 600, color: C.text, whiteSpace: "nowrap" }}>
                                      {client.name}
                                    </td>
                                    <td style={{ padding: "10px 16px", fontFamily: "monospace", color: C.blue }}>
                                      {fmtPhone(client.matchedPhone)}
                                    </td>
                                    <td style={{ padding: "10px 16px", fontFamily: "monospace", color: C.textSec }}>
                                      {client.cellPhone ? fmtPhone(client.cellPhone) : <span style={{ color: C.textMuted }}>—</span>}
                                    </td>
                                    <td style={{ padding: "10px 16px", fontFamily: "monospace", color: C.textSec }}>
                                      {client.homePhone ? fmtPhone(client.homePhone) : <span style={{ color: C.textMuted }}>—</span>}
                                    </td>
                                    <td style={{ padding: "10px 16px", fontFamily: "monospace", color: C.textSec }}>
                                      {client.workPhone ? fmtPhone(client.workPhone) : <span style={{ color: C.textMuted }}>—</span>}
                                    </td>
                                    <td style={{ padding: "10px 16px", color: C.textSec, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {client.address || <span style={{ color: C.textMuted }}>—</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
