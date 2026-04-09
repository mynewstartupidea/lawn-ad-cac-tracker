"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: string;
  first_name: string;
  email: string;
  phone: string;
  ad_name: string;
  source: string;
  created_at: string;
}

interface Sale {
  id: string;
  email: string;
  status: string;
  created_at: string;
}

interface AdSpendRecord {
  ad_name: string;
  spend: number;
  source: "manual" | "facebook";
  updated_at: string;
}

interface FbMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number;
  cpm: number;
  cpc: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: Date;
}

interface Campaign {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  daily_budget?: string;
  lifetime_budget?: string;
  objective?: string;
}

interface Asset {
  name: string;
  url: string;
  size: number;
  type: string;
  created_at?: string;
}

type LeadFilter = "all" | "open" | "sold";
type DateRange  = "7d" | "14d" | "30d" | "all";
type SortCol    = "adName" | "spend" | "leads" | "sales" | "conv" | "cac";
type SortDir    = "asc" | "desc";
type Account    = "all" | "florida" | "georgia";
type Tab        = "cac" | "ads" | "eddm";
type AdTab      = "chat" | "metrics" | "assets";

// ─── Constants ────────────────────────────────────────────────────────────────

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  "7d": "Last 7 days", "14d": "Last 14 days", "30d": "Last 30 days", "all": "All time",
};
const FB_PRESET: Record<DateRange, string> = {
  "7d": "last_7d", "14d": "last_14d", "30d": "last_30_days", "all": "maximum",
};
const ACCOUNT_IDS: Record<Account, string> = {
  all:     "all",
  florida: "435459903489885",
  georgia: "1467364857363196",
};
const ACCOUNT_LABELS: Record<Account, string> = {
  all:     "Both Accounts",
  florida: "Liquid Lawn Florida",
  georgia: "Liquid Lawn Georgia",
};

// ─── Theme ────────────────────────────────────────────────────────────────────

const C = {
  bg:          "#f8fafc",
  card:        "#ffffff",
  border:      "#e2e8f0",
  borderFocus: "#cbd5e1",
  text:        "#0f172a",
  textSec:     "#475569",
  textMuted:   "#94a3b8",
  blue:        "#2563eb",
  blueSoft:    "#eff6ff",
  blueText:    "#1d4ed8",
  green:       "#16a34a",
  greenSoft:   "#f0fdf4",
  orange:      "#ea580c",
  orangeSoft:  "#fff7ed",
  purple:      "#7c3aed",
  purpleSoft:  "#f5f3ff",
  cyan:        "#0891b2",
  cyanSoft:    "#ecfeff",
  amber:       "#d97706",
  amberSoft:   "#fffbeb",
  red:         "#dc2626",
  redSoft:     "#fef2f2",
  shadow:      "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:    "0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -1px rgba(0,0,0,0.04)",
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtMoney(n: number) {
  if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toLocaleString("en-US");
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function relativeTime(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ size = 14, color = C.blue }: { size?: number; color?: string }) {
  return (
    <svg style={{ width: size, height: size }} className="animate-spin" fill="none" viewBox="0 0 24 24">
      <circle style={{ opacity: 0.2 }} cx="12" cy="12" r="10" stroke={color} strokeWidth="4" />
      <path style={{ opacity: 0.8 }} fill={color} d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, icon, accentColor, accentSoft, loading }: {
  label: string; value: string; sub?: string; icon: React.ReactNode;
  accentColor: string; accentSoft: string; loading?: boolean;
}) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${loading ? accentColor + "50" : C.border}`,
      borderRadius: 14,
      padding: "20px",
      display: "flex",
      flexDirection: "column",
      gap: 14,
      boxShadow: C.shadow,
      position: "relative",
      overflow: "hidden",
      transition: "border-color 0.3s",
    }}>
      {/* Accent top bar with scan on load */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accentColor, overflow: "hidden" }}>
        {loading && (
          <div style={{
            position: "absolute", top: 0, bottom: 0, width: "30%",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent)",
            animation: "scan 1.4s ease-in-out infinite",
          }} />
        )}
      </div>
      {/* Icon */}
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: loading ? accentSoft.slice(0, -2) + "60)" : accentSoft,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background 0.3s",
      }}>{icon}</div>
      {/* Values */}
      <div>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: C.textMuted, marginBottom: 5 }}>
          {label}
        </p>
        {loading
          ? <div className="skeleton" style={{ height: 30, width: 80, borderRadius: 6 }} />
          : <p style={{ fontSize: 28, fontWeight: 700, color: C.text, lineHeight: 1, letterSpacing: "-0.02em" }}>{value}</p>}
        {sub && !loading && (
          <p style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>{sub}</p>
        )}
        {loading && <div className="skeleton" style={{ height: 11, width: 64, borderRadius: 4, marginTop: 8 }} />}
      </div>
    </div>
  );
}

// ─── FB Metric Pill ───────────────────────────────────────────────────────────

function FbPill({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${loading ? "#1877f230" : C.border}`,
      borderRadius: 12,
      padding: "14px 16px",
      flex: 1,
      minWidth: 120,
      transition: "border-color 0.3s",
      boxShadow: C.shadow,
    }}>
      <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: C.textMuted, marginBottom: 6 }}>
        {label}
      </p>
      {loading
        ? <div className="skeleton" style={{ height: 20, width: 64, borderRadius: 4 }} />
        : <p style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{value}</p>}
    </div>
  );
}

// ─── Sort Icon ────────────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span style={{ opacity: active ? 1 : 0.3, marginLeft: 4, fontSize: 10, color: active ? C.blue : C.textMuted }}>
      {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );
}

// ─── Skeleton Row ─────────────────────────────────────────────────────────────

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {[...Array(cols)].map((_, i) => (
        <td key={i} style={{ padding: "14px 20px" }}>
          <div className="skeleton" style={{ height: 13, borderRadius: 4, width: `${45 + (i * 17) % 45}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Shared select style ──────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.border}`,
  color: C.text,
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 500,
  outline: "none",
  appearance: "none" as const,
  cursor: "pointer",
  boxShadow: C.shadow,
};

// ─── EDDM Types ───────────────────────────────────────────────────────────────

interface EddmClient {
  name: string;
  matchedPhone: string;
  homePhone: string;
  workPhone: string;
  cellPhone: string;
  address: string;
}

interface EddmFlyer {
  flyerName: string;
  trackingNumber: string;
  totalCalls: number;
  conversions: number;
  matchedClients: EddmClient[];
}

interface EddmResponse {
  results: EddmFlyer[];
  totalCalls: number;
  totalMatched: number;
  saClientsRead: number;
  error?: string;
}

// ─── EDDM Helpers ─────────────────────────────────────────────────────────────

function eddmFileSizeWarning(file: File): { level: "warn" | "danger" | null; msg: string } {
  const mb = file.size / (1024 * 1024);
  const isXl = file.name.endsWith(".xlsx") || file.name.endsWith(".xls");
  if (mb > 8) return { level: "danger", msg: `${mb.toFixed(1)} MB — very likely to fail (limit ~4.5 MB). Export as CSV to fix this.` };
  if (mb > 4) return { level: "warn",   msg: `${mb.toFixed(1)} MB — near the 4.5 MB limit. ${isXl ? "Try exporting as CSV." : "May time out on large rows."}` };
  if (mb > 2 && isXl) return { level: "warn", msg: `${mb.toFixed(1)} MB Excel — if it fails, re-export as CSV (much smaller).` };
  return { level: null, msg: "" };
}

function eddmFmtSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function eddmFmtPhone(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return raw || "—";
}

function eddmFmtMoney(n: number) {
  if (!isFinite(n) || n <= 0) return "—";
  if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + n.toFixed(2);
}

const EDDM_ACCEPT = ".csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

// ─── EDDM Upload Card ─────────────────────────────────────────────────────────

function EddmUploadCard({
  label, sublabel, hint, icon, file, onFile, onClear, disabled, accent, accentSoft, required,
}: {
  label: string; sublabel: string; hint?: string; icon: string;
  file: File | null; onFile: (f: File) => void; onClear: () => void;
  disabled?: boolean; accent: string; accentSoft: string; required?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const warn = file ? eddmFileSizeWarning(file) : { level: null as null, msg: "" };

  const borderColor = !file ? (disabled ? "#cbd5e1" : C.border)
    : warn.level === "danger" ? C.red
    : warn.level === "warn"   ? C.amber
    : accent;

  const bgColor = !file ? (disabled ? "#f8fafc" : C.card)
    : warn.level === "danger" ? C.redSoft
    : warn.level === "warn"   ? C.amberSoft
    : accentSoft;

  return (
    <div style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
      <div
        onClick={() => !disabled && !file && ref.current?.click()}
        style={{
          background: bgColor,
          border: `2px ${file ? "solid" : "dashed"} ${borderColor}`,
          borderRadius: warn.level && file ? "12px 12px 0 0" : 12,
          padding: "20px 16px",
          cursor: disabled ? "not-allowed" : file ? "default" : "pointer",
          transition: "all 0.18s",
          opacity: disabled ? 0.5 : 1,
          position: "relative",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 8, textAlign: "center",
        }}
      >
        {required && !file && (
          <span style={{
            position: "absolute", top: 8, right: 10,
            fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
            color: accent, background: accentSoft, padding: "2px 7px", borderRadius: 20,
          }}>Required</span>
        )}

        {/* Icon bubble */}
        <div style={{
          width: 44, height: 44, borderRadius: 11, fontSize: 20,
          background: file
            ? warn.level === "danger" ? "#fee2e240" : warn.level === "warn" ? "#fef3c740" : accent + "25"
            : disabled ? "#e2e8f0" : accentSoft,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>{icon}</div>

        {file ? (
          <>
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 2, wordBreak: "break-all", lineHeight: 1.3 }}>
                {file.name}
              </p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 11, color: C.textSec }}>
                <span style={{
                  display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                  background: warn.level === "danger" ? C.red : warn.level === "warn" ? C.amber : C.green,
                }} />
                {eddmFmtSize(file.size)} · {file.name.split(".").pop()?.toUpperCase()}
              </div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); onClear(); }}
              style={{
                fontSize: 11, color: C.red, background: C.redSoft, border: "none",
                borderRadius: 7, padding: "4px 12px", cursor: "pointer", fontWeight: 600,
              }}
            >Remove</button>
          </>
        ) : (
          <>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: disabled ? C.textMuted : C.text, marginBottom: 2 }}>{label}</p>
              <p style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.4 }}>
                {disabled ? "Locked — clear other region first" : sublabel}
              </p>
            </div>
            {!disabled && hint && (
              <p style={{ fontSize: 10, color: C.textMuted }}>{hint}</p>
            )}
          </>
        )}

        <input
          ref={ref} type="file" accept={EDDM_ACCEPT} style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
        />
      </div>

      {/* Warning banner — attached below card */}
      {file && warn.level && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          padding: "9px 13px",
          background: warn.level === "danger" ? "#fef2f2" : "#fffbeb",
          border: `1px solid ${warn.level === "danger" ? "#fecaca" : "#fde68a"}`,
          borderTop: "none", borderRadius: "0 0 12px 12px",
        }}>
          <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{warn.level === "danger" ? "🚫" : "⚠️"}</span>
          <p style={{
            fontSize: 11, lineHeight: 1.5, fontWeight: 500,
            color: warn.level === "danger" ? "#991b1b" : "#92400e",
          }}>{warn.msg}</p>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [leads, setLeads]       = useState<Lead[]>([]);
  const [sales, setSales]       = useState<Sale[]>([]);
  const [adSpends, setAdSpends] = useState<Record<string, { spend: number; source: string }>>({});
  const [fbMetrics, setFbMetrics] = useState<FbMetrics | null>(null);

  const [loadingData, setLoadingData] = useState(true);
  const [syncingFb,   setSyncingFb]   = useState(false);
  const [fbError,     setFbError]     = useState<string | null>(null);
  const [lastSynced,  setLastSynced]  = useState<Date | null>(null);
  const [relTime,     setRelTime]     = useState("");

  // Navigation
  const [tab, setTab] = useState<Tab>("cac");

  // Controls
  const [dateRange,  setDateRange]  = useState<DateRange>("30d");
  const [account,    setAccount]    = useState<Account>("all");
  const [adFilter,   setAdFilter]   = useState<string>("all");
  const [leadFilter, setLeadFilter] = useState<LeadFilter>("all");
  const [search,     setSearch]     = useState("");
  const [sortCol,    setSortCol]    = useState<SortCol>("leads");
  const [sortDir,    setSortDir]    = useState<SortDir>("desc");

  // Ad Management inner tab
  const [adTab, setAdTab] = useState<AdTab>("chat");

  // Ad Management AI Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Hi! I can help you manage your Facebook Ads campaigns. Try asking me to pause a campaign, show performance, or adjust budgets.",
      ts: new Date(),
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatThinking, setChatThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // CAC Dashboard AI Chat state
  const [cacChatOpen, setCacChatOpen] = useState(false);
  const [cacChatMessages, setCacChatMessages] = useState<ChatMessage[]>([
    {
      id: "cac-welcome",
      role: "assistant",
      text: "Hey! Ask me anything about your CAC data. Try: \"What's my best performing ad?\", \"How much did we spend last 7 days?\", or \"Which ad has the lowest CAC?\"",
      ts: new Date(),
    },
  ]);
  const [cacChatInput, setCacChatInput] = useState("");
  const [cacChatThinking, setCacChatThinking] = useState(false);
  const [cacChatHasUnread, setCacChatHasUnread] = useState(false);
  const cacChatEndRef = useRef<HTMLDivElement>(null);

  // Campaigns state
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [togglingCampaign, setTogglingCampaign] = useState<string | null>(null);

  // Brand assets state
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // EDDM CAC state
  const [eddmCallrailFile, setEddmCallrailFile] = useState<File | null>(null);
  const [eddmFloridaFile,  setEddmFloridaFile]  = useState<File | null>(null);
  const [eddmGeorgiaFile,  setEddmGeorgiaFile]  = useState<File | null>(null);
  const [eddmLoading,      setEddmLoading]      = useState(false);
  const [eddmError,        setEddmError]        = useState<string | null>(null);
  const [eddmResponse,     setEddmResponse]     = useState<EddmResponse | null>(null);
  const [eddmExpanded,     setEddmExpanded]     = useState<Set<string>>(new Set());
  const [eddmSpends,       setEddmSpends]       = useState<Record<string, string>>({});
  const [eddmReportOpen,   setEddmReportOpen]   = useState(false);
  const [eddmChatOpen,     setEddmChatOpen]     = useState(false);
  const [eddmChatMessages, setEddmChatMessages] = useState<{ id: string; role: "user" | "assistant"; content: string; image?: string; ts: Date }[]>([
    { id: "eddm-welcome", role: "assistant", content: "Hi! Paste your flyer spend data, describe it, or attach a screenshot and I'll fill in the amounts automatically. You can also say things like \"set spend for 478-217-7161 to $2500\" or \"remove spend for the Georgia flyer\".", ts: new Date() },
  ]);
  const [eddmChatInput,   setEddmChatInput]   = useState("");
  const [eddmChatImg,     setEddmChatImg]     = useState<string | null>(null);
  const [eddmChatBusy,    setEddmChatBusy]    = useState(false);
  const eddmChatEndRef = useRef<HTMLDivElement>(null);
  const eddmImgInputRef = useRef<HTMLInputElement>(null);

  // Relative time ticker
  useEffect(() => {
    if (!lastSynced) return;
    setRelTime(relativeTime(lastSynced));
    const id = setInterval(() => setRelTime(relativeTime(lastSynced)), 15_000);
    return () => clearInterval(id);
  }, [lastSynced]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    cacChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [cacChatMessages]);

  // ── Fetch Supabase ──────────────────────────────────────────────────────────

  const fetchSupabase = useCallback(async () => {
    const [lr, sr, spr] = await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("sales").select("*").order("created_at", { ascending: false }),
      supabase.from("ad_spends").select("*"),
    ]);
    if (!lr.error)  setLeads(lr.data ?? []);
    if (!sr.error)  setSales(sr.data ?? []);
    if (!spr.error && spr.data) {
      const map: Record<string, { spend: number; source: string }> = {};
      for (const s of spr.data as AdSpendRecord[]) map[s.ad_name] = { spend: s.spend, source: s.source };
      setAdSpends(map);
    }
  }, []);

  // ── Fetch Facebook ──────────────────────────────────────────────────────────

  const syncFacebook = useCallback(async (range: DateRange, acct: Account) => {
    setSyncingFb(true);
    setFbError(null);
    try {
      const accountParam = ACCOUNT_IDS[acct];
      const url = `/api/facebook-spend?date_preset=${FB_PRESET[range]}&account=${accountParam}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.error) {
        setFbError(data.error);
      } else {
        const map: Record<string, { spend: number; source: string }> = {};
        for (const [k, v] of Object.entries(data.spends as Record<string, number>)) {
          map[k] = { spend: v, source: "facebook" };
        }
        setAdSpends(prev => ({ ...prev, ...map }));
        setFbMetrics(data.metrics ?? null);
        setLastSynced(new Date());
      }
    } catch {
      setFbError("Could not reach Facebook API.");
    } finally {
      setSyncingFb(false);
    }
  }, []);

  // ── Realtime sales ───────────────────────────────────────────────────────────

  useEffect(() => {
    const channel = supabase
      .channel("sales-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sales" }, payload => {
        setSales(prev => {
          const sale = payload.new as Sale;
          if (prev.some(s => s.id === sale.id)) return prev;
          return [sale, ...prev];
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Initial load ─────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setLoadingData(true);
      await fetchSupabase();
      setLoadingData(false);
      await syncFacebook(dateRange, account);
      const others = (["all", "florida", "georgia"] as Account[]).filter(a => a !== account);
      others.forEach(a => {
        fetch(`/api/facebook-spend?date_preset=${FB_PRESET[dateRange]}&account=${ACCOUNT_IDS[a]}`).catch(() => {});
      });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Control handlers ──────────────────────────────────────────────────────

  const clearFbData = useCallback(() => {
    setFbMetrics(null);
    setAdSpends(prev => {
      const next: Record<string, { spend: number; source: string }> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (v.source !== "facebook") next[k] = v;
      }
      return next;
    });
  }, []);

  const handleDateRange = (r: DateRange) => { setDateRange(r); clearFbData(); syncFacebook(r, account); };
  const handleAccount   = (a: Account)   => { setAccount(a);   clearFbData(); syncFacebook(dateRange, a); };

  const refresh = useCallback(async () => {
    setLoadingData(true);
    await fetchSupabase();
    setLoadingData(false);
    syncFacebook(dateRange, account);
  }, [fetchSupabase, syncFacebook, dateRange, account]);

  // ── Date cutoff ──────────────────────────────────────────────────────────

  const cutoff = useMemo(() => {
    if (dateRange === "all") return null;
    const days = dateRange === "7d" ? 7 : dateRange === "14d" ? 14 : 30;
    const d = new Date(); d.setDate(d.getDate() - days); return d;
  }, [dateRange]);

  const rangeLeads = useMemo(() => cutoff ? leads.filter(l => new Date(l.created_at) >= cutoff) : leads, [leads, cutoff]);
  const rangeSales = useMemo(() => cutoff ? sales.filter(s => new Date(s.created_at) >= cutoff) : sales, [sales, cutoff]);
  const soldEmails = useMemo(() => new Set(rangeSales.map(s => s.email)), [rangeSales]);
  const allAdNames = useMemo(() => [...new Set(leads.map(l => l.ad_name).filter(Boolean))].sort(), [leads]);

  // ── Ad stats ──────────────────────────────────────────────────────────────

  const adStats = useMemo(() => {
    const stats: Record<string, { leads: number; sales: number }> = {};
    for (const lead of rangeLeads) {
      const key = lead.ad_name || "Unknown Ad";
      if (!stats[key]) stats[key] = { leads: 0, sales: 0 };
      stats[key].leads++;
      if (soldEmails.has(lead.email)) stats[key].sales++;
    }
    const rows = Object.entries(stats).map(([adName, s]) => {
      const spend = adSpends[adName]?.spend ?? 0;
      return {
        adName, leads: s.leads, sales: s.sales, spend,
        fromFacebook: adSpends[adName]?.source === "facebook",
        conv: s.leads > 0 ? (s.sales / s.leads) * 100 : 0,
        cac:  s.sales > 0 && spend > 0 ? spend / s.sales : 0,
      };
    });
    const filtered = adFilter === "all" ? rows : rows.filter(r => r.adName === adFilter);
    return [...filtered].sort((a, b) => {
      let diff = 0;
      if      (sortCol === "adName") diff = a.adName.localeCompare(b.adName);
      else if (sortCol === "spend")  diff = a.spend  - b.spend;
      else if (sortCol === "leads")  diff = a.leads  - b.leads;
      else if (sortCol === "sales")  diff = a.sales  - b.sales;
      else if (sortCol === "conv")   diff = a.conv   - b.conv;
      else if (sortCol === "cac")    diff = a.cac    - b.cac;
      return sortDir === "asc" ? diff : -diff;
    });
  }, [rangeLeads, soldEmails, adSpends, adFilter, sortCol, sortDir]);

  const totals = useMemo(() => {
    const spend = adStats.reduce((s, a) => s + a.spend, 0);
    const sold  = rangeSales.length;
    const total = rangeLeads.length;
    return {
      leads: total, sales: sold, spend,
      cac:        sold > 0 && spend > 0 ? spend / sold : null,
      conversion: total > 0 ? (sold / total) * 100 : null,
    };
  }, [adStats, rangeSales.length, rangeLeads.length]);

  const filteredLeads = useMemo(() => rangeLeads.filter(l => {
    if (leadFilter === "open" && soldEmails.has(l.email)) return false;
    if (leadFilter === "sold" && !soldEmails.has(l.email)) return false;
    if (adFilter !== "all" && l.ad_name !== adFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return l.first_name?.toLowerCase().includes(q) || l.email?.toLowerCase().includes(q) || l.ad_name?.toLowerCase().includes(q);
    }
    return true;
  }), [rangeLeads, leadFilter, adFilter, search, soldEmails]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  // ── Chat handler (real OpenAI) ────────────────────────────────────────────

  const sendChat = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", text: text.trim(), ts: new Date() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setChatThinking(true);
    try {
      const history = chatMessages
        .filter(m => m.id !== "welcome")
        .map(m => ({ role: m.role, content: m.text }));
      history.push({ role: "user", content: text.trim() });

      const res  = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          assets: assets.map(a => ({ name: a.name })),
          account: account === "all" ? "all" : account,
        }),
      });
      const data = await res.json();
      const replyText = data.error ? `Error: ${data.error}` : (data.reply ?? "No response.");
      setChatMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: replyText,
        ts: new Date(),
      }]);
      // Refresh campaigns if AI may have changed statuses
      if (/pause|resume|activ/i.test(text)) fetchCampaigns();
    } catch {
      setChatMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: "Sorry, something went wrong reaching the AI. Please try again.",
        ts: new Date(),
      }]);
    } finally {
      setChatThinking(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages, assets]);

  // ── CAC Chat handler ─────────────────────────────────────────────────────

  const sendCacChat = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", text: text.trim(), ts: new Date() };
    setCacChatMessages(prev => [...prev, userMsg]);
    setCacChatInput("");
    setCacChatThinking(true);
    try {
      const history = cacChatMessages
        .filter(m => m.id !== "cac-welcome")
        .map(m => ({ role: m.role, content: m.text }));
      history.push({ role: "user", content: text.trim() });

      const res  = await fetch("/api/cac-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, dateRange }),
      });
      const data = await res.json();
      const replyText = data.error ? `Error: ${data.error}` : (data.reply ?? "No response.");
      setCacChatMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: replyText,
        ts: new Date(),
      }]);
    } catch {
      setCacChatMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: "Sorry, something went wrong. Please try again.",
        ts: new Date(),
      }]);
    } finally {
      setCacChatThinking(false);
      // Show unread dot on FAB if panel is closed
      setCacChatHasUnread(prev => prev || true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacChatMessages, dateRange]);

  // ── Campaigns ─────────────────────────────────────────────────────────────

  const fetchCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const res  = await fetch(`/api/fb-campaigns?account=${ACCOUNT_IDS[account]}`);
      const data = await res.json();
      if (!data.error) setCampaigns(data.campaigns ?? []);
    } catch { /* swallow */ } finally {
      setLoadingCampaigns(false);
    }
  }, [account]);

  const toggleCampaign = useCallback(async (campaignId: string, currentStatus: string) => {
    setTogglingCampaign(campaignId);
    const newStatus = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    try {
      const res  = await fetch("/api/fb-campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setCampaigns(prev => prev.map(c =>
          c.id === campaignId ? { ...c, status: newStatus as Campaign["status"] } : c
        ));
      }
    } catch { /* swallow */ } finally {
      setTogglingCampaign(null);
    }
  }, []);

  // ── Assets ────────────────────────────────────────────────────────────────

  const fetchAssets = useCallback(async () => {
    setLoadingAssets(true);
    try {
      const res  = await fetch("/api/assets");
      const data = await res.json();
      if (!data.error) setAssets(data.assets ?? []);
    } catch { /* swallow */ } finally {
      setLoadingAssets(false);
    }
  }, []);

  const uploadAsset = useCallback(async (files: File[]) => {
    setUploadingAsset(true);
    setUploadError(null);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const res  = await fetch("/api/assets", { method: "POST", body: form });
        const data = await res.json();
        if (data.error) {
          setUploadError(data.error);
          break;
        }
      }
      // Refetch to confirm everything is saved
      await fetchAssets();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingAsset(false);
    }
  }, [fetchAssets]);

  const deleteAsset = useCallback(async (name: string) => {
    setAssets(prev => prev.filter(a => a.name !== name));
    try {
      await fetch("/api/assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch { /* swallow */ }
  }, []);

  // Load campaigns + assets when switching to Ad Management tab
  useEffect(() => {
    if (tab === "ads") {
      fetchCampaigns();
      fetchAssets();
    }
  }, [tab, fetchCampaigns, fetchAssets]);

  // Re-fetch campaigns when account changes
  useEffect(() => {
    if (tab === "ads") fetchCampaigns();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  // ─── Table header style ───────────────────────────────────────────────────

  const thStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
    color: C.textMuted, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
    padding: "12px 20px", textAlign: "left",
  };

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 20,
        background: "rgba(248,250,252,0.92)", backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 24px", height: 60, display: "flex", alignItems: "center", gap: 0 }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 32 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 14,
              background: "linear-gradient(135deg, #16a34a, #15803d)",
            }}>🌿</div>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "-0.01em" }}>Lawn Ads</span>
          </div>

          {/* Tab nav */}
          <nav style={{ display: "flex", gap: 2, flex: 1 }}>
            {([
              { key: "cac",  label: "CAC Dashboard" },
              { key: "ads",  label: "Ad Management" },
              { key: "eddm", label: "📮 EDDM CAC" },
            ] as { key: Tab; label: string }[]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{
                  padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500,
                  border: "none", cursor: "pointer", transition: "all 0.15s",
                  background: tab === t.key ? C.card : "transparent",
                  color: tab === t.key ? C.text : C.textMuted,
                  boxShadow: tab === t.key ? C.shadow : "none",
                }}>
                {t.label}
              </button>
            ))}
          </nav>

          {/* Right controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Sync status */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textMuted }}>
              {syncingFb
                ? <><Spinner size={12} /><span>Syncing…</span></>
                : lastSynced ? <span>FB synced {relTime}</span>
                : fbError    ? <span style={{ color: C.amber }}>⚠ FB disconnected</span>
                : null}
            </div>

            <select value={account} onChange={e => handleAccount(e.target.value as Account)}
              style={{ ...selectStyle, minWidth: 155 }}>
              {(["all","florida","georgia"] as Account[]).map(a => (
                <option key={a} value={a}>{ACCOUNT_LABELS[a]}</option>
              ))}
            </select>

            <select value={dateRange} onChange={e => handleDateRange(e.target.value as DateRange)}
              style={{ ...selectStyle, minWidth: 115 }}>
              {(["7d","14d","30d","all"] as DateRange[]).map(r => (
                <option key={r} value={r}>{DATE_RANGE_LABELS[r]}</option>
              ))}
            </select>

            <button onClick={refresh} disabled={loadingData || syncingFb}
              style={{
                ...selectStyle,
                display: "flex", alignItems: "center", gap: 6,
                opacity: loadingData || syncingFb ? 0.5 : 1,
                cursor: loadingData || syncingFb ? "not-allowed" : "pointer",
              }}>
              {loadingData ? <Spinner size={12} /> : (
                <svg width={12} height={12} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* ── FB warning ──────────────────────────────────────────────────── */}
        {fbError && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            background: C.amberSoft, border: `1px solid ${C.amber}30`,
            borderRadius: 10, padding: "12px 16px",
          }}>
            <span style={{ color: C.amber, flexShrink: 0 }}>⚠</span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: C.amber }}>Facebook Ads not connected</p>
              <p style={{ fontSize: 12, color: C.textSec, marginTop: 2 }}>
                Add <code style={{ background: C.amberSoft, padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>FACEBOOK_ACCESS_TOKEN</code> and{" "}
                <code style={{ background: C.amberSoft, padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>FACEBOOK_AD_ACCOUNT_IDS</code> to Vercel env vars.
              </p>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* CAC DASHBOARD TAB                                                 */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === "cac" && (
          <>
            {/* ── Section label ─────────────────────────────────────────── */}
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>CAC Dashboard</h1>
              <p style={{ fontSize: 13, color: C.textMuted, marginTop: 3 }}>
                {DATE_RANGE_LABELS[dateRange]} · {ACCOUNT_LABELS[account]}
              </p>
            </div>

            {/* ── 5 metric cards ────────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <MetricCard
                label="Total Leads"
                value={loadingData ? "—" : totals.leads.toString()}
                sub={DATE_RANGE_LABELS[dateRange].toLowerCase()}
                accentColor={C.blue} accentSoft={C.blueSoft} loading={loadingData}
                icon={<svg width={17} height={17} fill="none" viewBox="0 0 24 24" stroke={C.blue} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
              />
              <MetricCard
                label="Sales Closed"
                value={loadingData ? "—" : totals.sales.toString()}
                sub="via Slack · sold"
                accentColor={C.green} accentSoft={C.greenSoft} loading={loadingData}
                icon={<svg width={17} height={17} fill="none" viewBox="0 0 24 24" stroke={C.green} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              />
              <MetricCard
                label="Ad Spend"
                value={syncingFb && totals.spend === 0 ? "—" : totals.spend > 0 ? fmtMoney(totals.spend) : "—"}
                sub={ACCOUNT_LABELS[account]}
                accentColor={C.orange} accentSoft={C.orangeSoft} loading={syncingFb && totals.spend === 0}
                icon={<svg width={17} height={17} fill="none" viewBox="0 0 24 24" stroke={C.orange} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
              />
              <MetricCard
                label="Avg CAC"
                value={totals.cac ? fmtMoney(totals.cac) : "—"}
                sub="spend ÷ sales"
                accentColor={C.purple} accentSoft={C.purpleSoft} loading={syncingFb && totals.spend === 0}
                icon={<svg width={17} height={17} fill="none" viewBox="0 0 24 24" stroke={C.purple} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>}
              />
              <MetricCard
                label="Conv. Rate"
                value={totals.conversion !== null ? `${totals.conversion.toFixed(1)}%` : "—"}
                sub="leads → closed"
                accentColor={C.cyan} accentSoft={C.cyanSoft} loading={loadingData}
                icon={<svg width={17} height={17} fill="none" viewBox="0 0 24 24" stroke={C.cyan} strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
              />
            </div>

            {/* ── Leads table ───────────────────────────────────────────── */}
            <section>
              {/* Table header row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Leads</h2>
                  <p style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                    {rangeLeads.length} total · {rangeSales.length} sold · {rangeLeads.length - rangeSales.length} open
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {/* Filter pills */}
                  <div style={{ display: "flex", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3, gap: 2 }}>
                    {(["all","open","sold"] as LeadFilter[]).map(f => (
                      <button key={f} onClick={() => setLeadFilter(f)}
                        style={{
                          padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                          border: "none", cursor: "pointer", textTransform: "capitalize", transition: "all 0.15s",
                          background: leadFilter === f ? C.card : "transparent",
                          color: leadFilter === f ? C.text : C.textMuted,
                          boxShadow: leadFilter === f ? C.shadow : "none",
                        }}>
                        {f}
                      </button>
                    ))}
                  </div>
                  {/* Search */}
                  <div style={{ position: "relative" }}>
                    <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}
                      width={13} height={13} fill="none" viewBox="0 0 24 24" stroke={C.textMuted} strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input type="text" placeholder="Search leads…" value={search} onChange={e => setSearch(e.target.value)}
                      style={{
                        paddingLeft: 30, paddingRight: 12, paddingTop: 7, paddingBottom: 7,
                        fontSize: 13, borderRadius: 8, outline: "none",
                        background: C.card, border: `1px solid ${C.border}`, color: C.text, width: 170,
                      }} />
                  </div>
                </div>
              </div>

              {/* Desktop table */}
              <div style={{
                background: C.card, border: `1px solid ${loadingData ? C.blue + "30" : C.border}`,
                borderRadius: 14, overflow: "hidden", boxShadow: C.shadow,
                position: "relative", transition: "border-color 0.3s",
              }} className="hidden sm:block">
                {loadingData && (
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, overflow: "hidden", zIndex: 1 }}>
                    <div style={{
                      position: "absolute", top: 0, bottom: 0, width: "35%",
                      background: `linear-gradient(90deg, transparent, ${C.blue}60, transparent)`,
                      animation: "scan 1.6s ease-in-out infinite",
                    }} />
                  </div>
                )}
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.border}`, background: "#f8fafc" }}>
                        {["Name","Email","Phone","Ad Name","Source","Date","Status"].map(h => (
                          <th key={h} style={thStyle}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {loadingData
                        ? [...Array(5)].map((_, i) => <SkeletonRow key={i} cols={7} />)
                        : filteredLeads.length === 0
                          ? <tr><td colSpan={7} style={{ padding: "60px 20px", textAlign: "center", fontSize: 13, color: C.textMuted }}>
                              {search ? `No leads matching "${search}"` : "No leads for this period."}
                            </td></tr>
                          : filteredLeads.map((lead, i) => {
                              const sold = soldEmails.has(lead.email);
                              return (
                                <tr key={lead.id}
                                  style={{
                                    borderBottom: i < filteredLeads.length - 1 ? `1px solid ${C.border}` : "none",
                                    transition: "background 0.12s",
                                  }}
                                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#f8fafc"}
                                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                                  <td style={{ padding: "12px 20px", fontWeight: 600, color: C.text, whiteSpace: "nowrap" }}>{lead.first_name}</td>
                                  <td style={{ padding: "12px 20px", color: C.textSec, fontSize: 12, whiteSpace: "nowrap" }}>{lead.email}</td>
                                  <td style={{ padding: "12px 20px", color: C.textMuted, fontSize: 12, whiteSpace: "nowrap" }}>{lead.phone || "—"}</td>
                                  <td style={{ padding: "12px 20px", maxWidth: 160 }}>
                                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: C.textSec }}
                                      title={lead.ad_name}>
                                      {lead.ad_name || <span style={{ color: C.textMuted }}>Unknown</span>}
                                    </span>
                                  </td>
                                  <td style={{ padding: "12px 20px" }}>
                                    <span style={{
                                      fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                                      padding: "2px 7px", borderRadius: 5,
                                      background: C.bg, border: `1px solid ${C.border}`, color: C.textSec,
                                    }}>{lead.source}</span>
                                  </td>
                                  <td style={{ padding: "12px 20px", color: C.textMuted, fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(lead.created_at)}</td>
                                  <td style={{ padding: "12px 20px" }}>
                                    {sold
                                      ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, color: C.green, background: C.greenSoft, border: `1px solid ${C.green}25` }}>
                                          <svg width={6} height={6} viewBox="0 0 6 6" fill={C.green}><circle cx="3" cy="3" r="3" /></svg> Sold
                                        </span>
                                      : <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, color: C.amber, background: C.amberSoft, border: `1px solid ${C.amber}25` }}>
                                          <svg width={6} height={6} viewBox="0 0 6 6" fill={C.amber}><circle cx="3" cy="3" r="3" /></svg> Open
                                        </span>}
                                  </td>
                                </tr>
                              );
                            })}
                    </tbody>
                  </table>
                </div>
                {filteredLeads.length > 0 && (
                  <div style={{ padding: "10px 20px", borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.textMuted, background: "#f8fafc" }}>
                    Showing {filteredLeads.length} of {rangeLeads.length} leads
                  </div>
                )}
              </div>

              {/* Mobile lead cards */}
              <div className="sm:hidden" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {loadingData
                  ? [...Array(4)].map((_, i) => (
                      <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                          <div className="skeleton" style={{ height: 14, width: 110, borderRadius: 4 }} />
                          <div className="skeleton" style={{ height: 20, width: 56, borderRadius: 20 }} />
                        </div>
                        <div className="skeleton" style={{ height: 11, width: 170, borderRadius: 4, marginTop: 6 }} />
                      </div>
                    ))
                  : filteredLeads.length === 0
                    ? <p style={{ textAlign: "center", padding: "40px 0", fontSize: 13, color: C.textMuted }}>
                        {search ? `No leads matching "${search}"` : "No leads for this period."}
                      </p>
                    : filteredLeads.map(lead => {
                        const sold = soldEmails.has(lead.email);
                        return (
                          <div key={lead.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                              <div style={{ minWidth: 0 }}>
                                <p style={{ fontWeight: 600, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.first_name}</p>
                                <p style={{ fontSize: 12, color: C.textSec, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.email}</p>
                              </div>
                              {sold
                                ? <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, color: C.green, background: C.greenSoft }}>
                                    <svg width={6} height={6} viewBox="0 0 6 6" fill={C.green}><circle cx="3" cy="3" r="3" /></svg> Sold
                                  </span>
                                : <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, color: C.amber, background: C.amberSoft }}>
                                    <svg width={6} height={6} viewBox="0 0 6 6" fill={C.amber}><circle cx="3" cy="3" r="3" /></svg> Open
                                  </span>}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              {lead.ad_name && (
                                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, color: C.purple, background: C.purpleSoft, border: `1px solid ${C.purple}20`, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {lead.ad_name}
                                </span>
                              )}
                              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 4, background: C.bg, border: `1px solid ${C.border}`, color: C.textSec }}>{lead.source}</span>
                              <span style={{ fontSize: 11, marginLeft: "auto", color: C.textMuted }}>{fmtDate(lead.created_at)}</span>
                            </div>
                          </div>
                        );
                      })}
                {filteredLeads.length > 0 && (
                  <p style={{ textAlign: "center", fontSize: 11, color: C.textMuted, paddingTop: 4 }}>
                    {filteredLeads.length} of {rangeLeads.length} leads
                  </p>
                )}
              </div>
            </section>

          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* AD MANAGEMENT TAB                                                 */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === "ads" && (
          <>
            {/* ── Header + inner tab bar ────────────────────────────────── */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>Ad Management</h1>
                <p style={{ fontSize: 13, color: C.textMuted, marginTop: 3 }}>
                  {DATE_RANGE_LABELS[dateRange]} · {ACCOUNT_LABELS[account]}
                </p>
              </div>
              {/* Inner tab pills */}
              <div style={{ display: "flex", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 3, gap: 2 }}>
                {([
                  { key: "chat",    label: "AI Command" },
                  { key: "metrics", label: "Metrics" },
                  { key: "assets",  label: "Brand Assets" },
                ] as { key: AdTab; label: string }[]).map(t => (
                  <button key={t.key} onClick={() => setAdTab(t.key)}
                    style={{
                      padding: "6px 16px", borderRadius: 7, fontSize: 13, fontWeight: 500,
                      border: "none", cursor: "pointer", transition: "all 0.15s",
                      background: adTab === t.key ? C.card : "transparent",
                      color: adTab === t.key ? C.text : C.textMuted,
                      boxShadow: adTab === t.key ? C.shadow : "none",
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════ */}
            {/* INNER TAB: AI COMMAND CHAT                               */}
            {/* ══════════════════════════════════════════════════════════ */}
            {adTab === "chat" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, alignItems: "start" }}>

                {/* Chat panel */}
                <div style={{
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
                  boxShadow: C.shadow, display: "flex", flexDirection: "column", height: 600,
                }}>
                  {/* Chat header */}
                  <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: "linear-gradient(135deg,#16a34a,#15803d)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🌿</div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Ad Command Center</p>
                      <p style={{ fontSize: 11, color: C.green }}>● Powered by GPT-4o mini</p>
                    </div>
                  </div>

                  {/* Messages */}
                  <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    {chatMessages.map(msg => (
                      <div key={msg.id} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", gap: 8 }}>
                        {msg.role === "assistant" && (
                          <div style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg,#16a34a,#15803d)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0, alignSelf: "flex-end" }}>🌿</div>
                        )}
                        <div style={{
                          maxWidth: "75%", padding: "10px 14px", fontSize: 13, lineHeight: 1.55,
                          borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                          background: msg.role === "user" ? C.blue : C.bg,
                          color: msg.role === "user" ? "#fff" : C.text,
                          border: msg.role === "assistant" ? `1px solid ${C.border}` : "none",
                        }}>
                          {msg.text.split("\n").map((line, i) => (
                            <span key={i}>{line}{i < msg.text.split("\n").length - 1 && <br />}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                    {chatThinking && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg,#16a34a,#15803d)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>🌿</div>
                        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: "14px 14px 14px 4px", padding: "10px 16px" }}>
                          <Spinner size={14} color={C.textMuted} />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Quick prompts */}
                  <div style={{ padding: "8px 14px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["List my campaigns", "Pause all campaigns", "Which ad has the best CTR?", "Show top performer"].map(q => (
                      <button key={q} onClick={() => sendChat(q)} disabled={chatThinking}
                        style={{ fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 20, background: C.blueSoft, color: C.blueText, border: "1px solid #bfdbfe", cursor: "pointer" }}>
                        {q}
                      </button>
                    ))}
                  </div>

                  {/* Input */}
                  <div style={{ padding: "10px 14px 14px", display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="Ask about your campaigns…"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(chatInput); } }}
                      style={{ flex: 1, padding: "9px 12px", fontSize: 13, borderRadius: 8, outline: "none", background: C.bg, border: `1px solid ${C.border}`, color: C.text }}
                    />
                    <button onClick={() => sendChat(chatInput)} disabled={!chatInput.trim() || chatThinking}
                      style={{
                        padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none",
                        background: chatInput.trim() && !chatThinking ? C.blue : C.border,
                        color: chatInput.trim() && !chatThinking ? "#fff" : C.textMuted,
                        cursor: chatInput.trim() && !chatThinking ? "pointer" : "not-allowed",
                        transition: "all 0.15s",
                      }}>
                      Send
                    </button>
                  </div>
                </div>

                {/* Campaigns side panel */}
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: C.shadow, overflow: "hidden" }}>
                  <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Live Campaigns</p>
                    <button onClick={fetchCampaigns} disabled={loadingCampaigns}
                      style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                      {loadingCampaigns ? <Spinner size={12} /> : (
                        <svg width={12} height={12} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      Refresh
                    </button>
                  </div>
                  <div style={{ maxHeight: 548, overflowY: "auto" }}>
                    {loadingCampaigns
                      ? [...Array(4)].map((_, i) => (
                          <div key={i} style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
                            <div className="skeleton" style={{ height: 13, width: "70%", borderRadius: 4, marginBottom: 8 }} />
                            <div className="skeleton" style={{ height: 11, width: "40%", borderRadius: 4 }} />
                          </div>
                        ))
                      : campaigns.length === 0
                        ? (
                          <div style={{ padding: 24, textAlign: "center" }}>
                            <p style={{ fontSize: 13, color: C.textMuted }}>No campaigns found.</p>
                            <p style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>Check your Facebook account connection.</p>
                          </div>
                        )
                        : campaigns.map(c => {
                            const isActive  = c.status === "ACTIVE";
                            const toggling  = togglingCampaign === c.id;
                            const budget    = c.daily_budget
                              ? `$${(parseInt(c.daily_budget) / 100).toFixed(2)}/day`
                              : c.lifetime_budget
                                ? `$${(parseInt(c.lifetime_budget) / 100).toFixed(2)} lifetime`
                                : null;
                            return (
                              <div key={c.id} style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", gap: 10 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ fontSize: 13, fontWeight: 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>{c.name}</p>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                                    <span style={{
                                      fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20,
                                      color: isActive ? C.green : C.textMuted,
                                      background: isActive ? C.greenSoft : C.bg,
                                      border: `1px solid ${isActive ? C.green + "30" : C.border}`,
                                    }}>
                                      {c.status}
                                    </span>
                                    {budget && <span style={{ fontSize: 11, color: C.textMuted }}>{budget}</span>}
                                  </div>
                                </div>
                                <button
                                  onClick={() => toggleCampaign(c.id, c.status)}
                                  disabled={toggling}
                                  title={isActive ? "Pause campaign" : "Resume campaign"}
                                  style={{
                                    flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`,
                                    background: C.bg, cursor: toggling ? "not-allowed" : "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    opacity: toggling ? 0.5 : 1, transition: "all 0.15s",
                                  }}>
                                  {toggling
                                    ? <Spinner size={12} />
                                    : isActive
                                      ? <svg width={12} height={12} fill={C.amber} viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                                      : <svg width={12} height={12} fill={C.green} viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" /></svg>}
                                </button>
                              </div>
                            );
                          })}
                  </div>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════ */}
            {/* INNER TAB: METRICS                                        */}
            {/* ══════════════════════════════════════════════════════════ */}
            {adTab === "metrics" && (
              <>
                {/* FB Summary Pills */}
                <section>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{ width: 20, height: 20, borderRadius: 5, background: "#1877f2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width={11} height={11} fill="white" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
                    </div>
                    <h2 style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Facebook Overview</h2>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 20, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>
                      {ACCOUNT_LABELS[account]} · {DATE_RANGE_LABELS[dateRange]}
                    </span>
                    {syncingFb && <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.textMuted }}><Spinner size={12} /> Fetching…</span>}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <FbPill label="Impressions" value={fbMetrics ? fmtNum(fbMetrics.impressions) : "—"} loading={syncingFb && !fbMetrics} />
                    <FbPill label="Reach"       value={fbMetrics ? fmtNum(fbMetrics.reach)       : "—"} loading={syncingFb && !fbMetrics} />
                    <FbPill label="Clicks"      value={fbMetrics ? fmtNum(fbMetrics.clicks)      : "—"} loading={syncingFb && !fbMetrics} />
                    <FbPill label="CTR"         value={fbMetrics ? `${fbMetrics.ctr.toFixed(2)}%`  : "—"} loading={syncingFb && !fbMetrics} />
                    <FbPill label="CPM"         value={fbMetrics ? `$${fbMetrics.cpm.toFixed(2)}`  : "—"} loading={syncingFb && !fbMetrics} />
                    <FbPill label="CPC"         value={fbMetrics ? `$${fbMetrics.cpc.toFixed(2)}`  : "—"} loading={syncingFb && !fbMetrics} />
                    <FbPill label="Total Spend" value={fbMetrics ? fmtMoney(fbMetrics.spend)      : "—"} loading={syncingFb && !fbMetrics} />
                  </div>
                </section>

                {/* Ad Performance Table */}
                <section>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                    <div>
                      <h2 style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Ad Performance</h2>
                      <p style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Click column headers to sort</p>
                    </div>
                    <select value={adFilter} onChange={e => setAdFilter(e.target.value)} style={{ ...selectStyle, maxWidth: 220 }}>
                      <option value="all">All ads</option>
                      {allAdNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div style={{
                    background: C.card, border: `1px solid ${loadingData || syncingFb ? C.blue + "30" : C.border}`,
                    borderRadius: 14, overflow: "hidden", boxShadow: C.shadow,
                    position: "relative", transition: "border-color 0.3s",
                  }}>
                    {(loadingData || syncingFb) && (
                      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, overflow: "hidden", zIndex: 1 }}>
                        <div style={{ position: "absolute", top: 0, bottom: 0, width: "35%", background: `linear-gradient(90deg,transparent,${C.blue}60,transparent)`, animation: "scan 1.6s ease-in-out infinite" }} />
                      </div>
                    )}
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${C.border}`, background: "#f8fafc" }}>
                            {([
                              { col: "adName", label: "Ad Name" }, { col: "spend", label: "Spend" },
                              { col: "leads",  label: "Leads" },   { col: "sales", label: "Sales" },
                              { col: "conv",   label: "Conv %" },  { col: "cac",   label: "CAC" },
                            ] as { col: SortCol; label: string }[]).map(({ col, label }) => (
                              <th key={col} style={{ ...thStyle, cursor: "pointer" }} onClick={() => handleSort(col)}>
                                {label}<SortIcon active={sortCol === col} dir={sortDir} />
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {loadingData
                            ? [...Array(3)].map((_, i) => <SkeletonRow key={i} cols={6} />)
                            : adStats.length === 0
                              ? <tr><td colSpan={6} style={{ padding: "60px 20px", textAlign: "center", fontSize: 13, color: C.textMuted }}>No ad data for this period.</td></tr>
                              : adStats.map((row, i) => (
                                  <tr key={row.adName}
                                    style={{ borderBottom: i < adStats.length - 1 ? `1px solid ${C.border}` : "none", transition: "background 0.12s" }}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#f8fafc"}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                                    <td style={{ padding: "13px 20px", fontWeight: 600, color: C.text }}>{row.adName}</td>
                                    <td style={{ padding: "13px 20px" }}>
                                      {syncingFb && row.spend === 0
                                        ? <div className="skeleton" style={{ height: 14, width: 56, borderRadius: 4 }} />
                                        : row.spend > 0
                                          ? <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                              <span style={{ fontWeight: 600, color: C.text }}>{fmtMoney(row.spend)}</span>
                                              {row.fromFacebook && <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", padding: "2px 5px", borderRadius: 4, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe" }}>FB</span>}
                                            </span>
                                          : <span style={{ color: C.textMuted }}>—</span>}
                                    </td>
                                    <td style={{ padding: "13px 20px", color: C.textSec }}>{row.leads}</td>
                                    <td style={{ padding: "13px 20px", fontWeight: 600, color: C.green }}>{row.sales}</td>
                                    <td style={{ padding: "13px 20px", color: C.textSec }}>
                                      {row.conv > 0 ? `${row.conv.toFixed(1)}%` : <span style={{ color: C.textMuted }}>—</span>}
                                    </td>
                                    <td style={{ padding: "13px 20px", fontWeight: 600, color: C.purple }}>
                                      {row.cac > 0 ? fmtMoney(row.cac) : <span style={{ color: C.textMuted, fontWeight: 400 }}>—</span>}
                                    </td>
                                  </tr>
                                ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* ══════════════════════════════════════════════════════════ */}
            {/* INNER TAB: BRAND ASSETS                                   */}
            {/* ══════════════════════════════════════════════════════════ */}
            {adTab === "assets" && (
              <section>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Brand Assets</h2>
                    <p style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                      Logos and creatives — the AI can reference these when generating ads
                    </p>
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAsset}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                      background: C.blue, color: "#fff", border: "none",
                      cursor: uploadingAsset ? "not-allowed" : "pointer",
                      opacity: uploadingAsset ? 0.6 : 1,
                    }}>
                    {uploadingAsset ? <Spinner size={13} color="#fff" /> : (
                      <svg width={13} height={13} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                    )}
                    {uploadingAsset ? "Uploading…" : "Upload file"}
                  </button>
                  {uploadError && (
                    <p style={{ fontSize: 12, color: "#ef4444", marginTop: 4 }}>{uploadError}</p>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*,.svg,.pdf"
                    multiple
                    style={{ display: "none" }}
                    onChange={e => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length) uploadAsset(files);
                      e.target.value = "";
                    }}
                  />
                </div>

                {loadingAssets
                  ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
                      {[...Array(6)].map((_, i) => (
                        <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                          <div className="skeleton" style={{ height: 110 }} />
                          <div style={{ padding: "10px 12px" }}>
                            <div className="skeleton" style={{ height: 11, width: "80%", borderRadius: 4 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                  : assets.length === 0
                    ? (
                      <div style={{
                        background: C.card, border: `2px dashed ${C.border}`, borderRadius: 14,
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        padding: "60px 24px", gap: 12,
                      }}>
                        <div style={{ width: 48, height: 48, borderRadius: 12, background: C.blueSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width={22} height={22} fill="none" viewBox="0 0 24 24" stroke={C.blue} strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                          </svg>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: C.text }}>No assets yet</p>
                          <p style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>Upload your logo, ad creatives, and brand images.</p>
                          <p style={{ fontSize: 12, color: C.textMuted }}>The AI will use these when you ask it to generate ads.</p>
                        </div>
                        <button onClick={() => fileInputRef.current?.click()}
                          style={{ padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: C.blue, color: "#fff", border: "none", cursor: "pointer" }}>
                          Browse files
                        </button>
                      </div>
                    )
                    : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
                        {assets.map(a => (
                          <div key={a.name} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: C.shadow, position: "relative", group: true } as React.CSSProperties}>
                            {/* Preview */}
                            <div style={{ height: 110, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                              {a.type?.startsWith("image/")
                                ? <img src={a.url} alt={a.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                : a.type?.startsWith("video/")
                                  ? <video src={a.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline />
                                  : (
                                    <svg width={28} height={28} fill="none" viewBox="0 0 24 24" stroke={C.textMuted} strokeWidth={1.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                    </svg>
                                  )}
                            </div>
                            {/* Info + delete */}
                            <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                              <div style={{ minWidth: 0 }}>
                                <p style={{ fontSize: 11, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.name}>
                                  {a.name.replace(/^\d+_/, "")}
                                </p>
                                <p style={{ fontSize: 10, color: C.textMuted, marginTop: 1 }}>
                                  {a.size > 1024 * 1024 ? `${(a.size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(a.size / 1024)} KB`}
                                </p>
                              </div>
                              <button onClick={() => deleteAsset(a.name)} title="Delete"
                                style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: C.textMuted, padding: 2, borderRadius: 4 }}>
                                <svg width={14} height={14} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
              </section>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* EDDM CAC TAB                                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === "eddm" && (() => {
          const clientFile   = eddmFloridaFile ?? eddmGeorgiaFile;
          const clientRegion = eddmFloridaFile ? "florida" : eddmGeorgiaFile ? "georgia" : null;
          const canSubmit    = !!eddmCallrailFile && !!clientFile && !eddmLoading;

          async function handleEddmSubmit() {
            if (!canSubmit) return;
            setEddmLoading(true);
            setEddmError(null);
            setEddmResponse(null);
            setEddmExpanded(new Set());
            setEddmSpends({});
            try {
              const fd = new FormData();
              fd.append("callrail", eddmCallrailFile!);
              fd.append("clients",  clientFile!);
              fd.append("region",   clientRegion!);
              const res  = await fetch("/api/eddm-match", { method: "POST", body: fd });
              const data = await res.json() as EddmResponse;
              if (!res.ok || data.error) setEddmError(data.error ?? "Something went wrong.");
              else setEddmResponse(data);
            } catch { setEddmError("Network error. Check your connection and try again."); }
            finally  { setEddmLoading(false); }
          }

          function toggleEddm(key: string) {
            setEddmExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
          }

          const totalSpend  = eddmResponse ? eddmResponse.results.reduce((s, r) => s + (parseFloat(eddmSpends[r.flyerName + r.trackingNumber] ?? "") || 0), 0) : 0;
          const overallCAC  = totalSpend > 0 && (eddmResponse?.totalMatched ?? 0) > 0 ? totalSpend / eddmResponse!.totalMatched : null;

          return (
            <>
              {/* ── Header ──────────────────────────────────────────────── */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>EDDM CAC</h1>
                  <p style={{ fontSize: 13, color: C.textMuted, marginTop: 3 }}>
                    Upload CallRail data + Service Autopilot client list to calculate cost per acquisition per flyer
                  </p>
                </div>
                {eddmResponse && (
                  <button
                    onClick={() => { setEddmResponse(null); setEddmCallrailFile(null); setEddmFloridaFile(null); setEddmGeorgiaFile(null); }}
                    style={{ fontSize: 12, fontWeight: 600, color: C.textSec, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}
                  >
                    ↩ New Analysis
                  </button>
                )}
              </div>

              {/* ── Upload Section ──────────────────────────────────────── */}
              {!eddmResponse && (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "24px", boxShadow: C.shadow }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>Step 1 — Upload Files</p>
                  <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 20 }}>
                    Upload your CallRail export and either the Florida <em>or</em> Georgia client list from Service Autopilot. Both CSV and Excel are supported.
                  </p>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <EddmUploadCard
                      label="CallRail Data" sublabel="Export from CallRail dashboard" hint="CSV or Excel (.xlsx)" icon="📞"
                      file={eddmCallrailFile} onFile={setEddmCallrailFile} onClear={() => setEddmCallrailFile(null)}
                      accent={C.blue} accentSoft={C.blueSoft} required
                    />
                    <EddmUploadCard
                      label="Florida Clients" sublabel="Service Autopilot FL export" hint="CSV or Excel (.xlsx)" icon="🌴"
                      file={eddmFloridaFile} onFile={setEddmFloridaFile} onClear={() => setEddmFloridaFile(null)}
                      disabled={!!eddmGeorgiaFile} accent={C.orange} accentSoft={C.orangeSoft}
                    />
                    <EddmUploadCard
                      label="Georgia Clients" sublabel="Service Autopilot GA export" hint="CSV or Excel (.xlsx)" icon="🍑"
                      file={eddmGeorgiaFile} onFile={setEddmGeorgiaFile} onClear={() => setEddmGeorgiaFile(null)}
                      disabled={!!eddmFloridaFile} accent={C.green} accentSoft={C.greenSoft}
                    />
                  </div>

                  {/* Region lock notice */}
                  {clientRegion && (
                    <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12 }}>{clientRegion === "florida" ? "🌴" : "🍑"}</span>
                      <p style={{ fontSize: 12, fontWeight: 600, color: clientRegion === "florida" ? C.orange : C.green }}>
                        {clientRegion === "florida" ? "Florida" : "Georgia"} client list loaded —&nbsp;
                        <span style={{ color: C.textMuted, fontWeight: 400 }}>
                          {clientRegion === "florida" ? "Georgia" : "Florida"} upload locked until removed
                        </span>
                      </p>
                    </div>
                  )}

                  {/* Step 2 — CTA */}
                  <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                    <p style={{ fontSize: 12, color: C.textMuted }}>
                      {!eddmCallrailFile && !clientFile ? "Upload CallRail data and a client list to continue" :
                       !eddmCallrailFile ? "Still need: CallRail export" :
                       !clientFile ? "Still need: Florida or Georgia client list" :
                       "Ready — click Find CAC to match calls to clients"}
                    </p>
                    <button
                      onClick={handleEddmSubmit}
                      disabled={!canSubmit}
                      style={{
                        background: canSubmit ? `linear-gradient(135deg, ${C.purple}, #6d28d9)` : "#e2e8f0",
                        color: canSubmit ? "#fff" : C.textMuted,
                        border: "none", borderRadius: 10,
                        padding: "11px 28px", fontSize: 14, fontWeight: 700,
                        cursor: canSubmit ? "pointer" : "not-allowed",
                        display: "flex", alignItems: "center", gap: 8,
                        boxShadow: canSubmit ? "0 4px 14px rgba(124,58,237,0.35)" : "none",
                        transition: "all 0.2s",
                      }}
                    >
                      {eddmLoading
                        ? <><svg style={{ width: 16, height: 16 }} className="animate-spin" fill="none" viewBox="0 0 24 24"><circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="#fff" strokeWidth="4"/><path style={{ opacity: 0.75 }} fill="#fff" d="M4 12a8 8 0 018-8v8H4z"/></svg>Matching…</>
                        : "Find CAC"}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Error ───────────────────────────────────────────────── */}
              {eddmError && (
                <div style={{ background: C.redSoft, border: `1px solid ${C.red}30`, borderRadius: 12, padding: "13px 16px", fontSize: 13, color: C.red, fontWeight: 500 }}>
                  {eddmError}
                </div>
              )}

              {/* ── Results ─────────────────────────────────────────────── */}
              {eddmResponse && (
                <>
                  {/* Summary stat cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                    {([
                      { label: "Total Calls",     value: eddmResponse.totalCalls.toLocaleString(),    icon: "📞", color: C.blue,   soft: C.blueSoft },
                      { label: "Clients in SA",   value: eddmResponse.saClientsRead.toLocaleString(), icon: "👥", color: C.purple, soft: C.purpleSoft },
                      { label: "Conversions",     value: eddmResponse.totalMatched.toLocaleString(),  icon: "✅", color: C.green,  soft: C.greenSoft },
                      { label: "Overall CAC",     value: overallCAC ? eddmFmtMoney(overallCAC) : "Add spend ↓", icon: "💰", color: C.amber, soft: C.amberSoft },
                    ] as const).map(m => (
                      <div key={m.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 16px", boxShadow: C.shadow, position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: m.color }} />
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: m.soft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, marginBottom: 10 }}>{m.icon}</div>
                        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: C.textMuted, marginBottom: 4 }}>{m.label}</p>
                        <p style={{ fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>{m.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Flyer cards */}
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>
                      Results by Flyer &nbsp;<span style={{ fontWeight: 400, color: C.textMuted }}>— sorted by conversions</span>
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {eddmResponse.results.map(flyer => {
                        const key      = flyer.flyerName + flyer.trackingNumber;
                        const isOpen   = eddmExpanded.has(key);
                        const spend    = parseFloat(eddmSpends[key] ?? "") || 0;
                        const cac      = spend > 0 && flyer.conversions > 0 ? spend / flyer.conversions : null;
                        const convRate = flyer.totalCalls > 0 ? ((flyer.conversions / flyer.totalCalls) * 100).toFixed(1) : "0.0";

                        return (
                          <div key={key} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", boxShadow: C.shadow }}>
                            <div style={{ padding: "18px 20px" }}>
                              {/* Top row: name + pills */}
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 3, lineHeight: 1.3 }}>{flyer.flyerName || "Unknown Flyer"}</p>
                                  <p style={{ fontSize: 11, color: C.textMuted, fontFamily: "monospace" }}>{eddmFmtPhone(flyer.trackingNumber)}</p>
                                </div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                  <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, background: C.blueSoft, color: C.blue }}>{flyer.totalCalls} calls</span>
                                  <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, background: flyer.conversions > 0 ? C.greenSoft : "#f1f5f9", color: flyer.conversions > 0 ? C.green : C.textMuted }}>{flyer.conversions} converted</span>
                                  <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, background: C.amberSoft, color: C.amber }}>{convRate}%</span>
                                </div>
                              </div>

                              {/* Bottom row: spend input + CAC + view clients */}
                              <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`, flexWrap: "wrap" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <label style={{ fontSize: 12, fontWeight: 600, color: C.textSec, whiteSpace: "nowrap" }}>Flyer Spend</label>
                                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                                    <span style={{ position: "absolute", left: 9, fontSize: 12, color: C.textMuted, fontWeight: 600 }}>$</span>
                                    <input
                                      type="number" min="0" step="0.01" placeholder="0.00"
                                      value={eddmSpends[key] ?? ""}
                                      onChange={e => setEddmSpends(p => ({ ...p, [key]: e.target.value }))}
                                      style={{ width: 100, paddingLeft: 20, paddingRight: 8, paddingTop: 6, paddingBottom: 6, border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, color: C.text, background: C.bg, outline: "none" }}
                                    />
                                  </div>
                                </div>

                                {cac !== null && (
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ fontSize: 11, color: C.textSec, fontWeight: 600 }}>CAC</span>
                                    <span style={{ fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>{eddmFmtMoney(cac)}</span>
                                    <span style={{ fontSize: 11, color: C.textMuted }}>/ client</span>
                                  </div>
                                )}

                                {flyer.conversions > 0 && (
                                  <button
                                    onClick={() => toggleEddm(key)}
                                    style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: C.blue, background: C.blueSoft, border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                                  >
                                    {isOpen ? "Hide clients" : `View ${flyer.conversions} client${flyer.conversions !== 1 ? "s" : ""}`}
                                    <span style={{ fontSize: 9, display: "inline-block", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Expanded client table */}
                            {isOpen && flyer.matchedClients.length > 0 && (
                              <div style={{ borderTop: `1px solid ${C.border}`, overflowX: "auto" }}>
                                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                                  <thead>
                                    <tr style={{ background: "#f8fafc" }}>
                                      {["#", "Name", "Matched Phone", "Cell", "Home", "Work", "Address"].map(h => (
                                        <th key={h} style={{ padding: "9px 16px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textMuted, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {flyer.matchedClients.map((client, i) => (
                                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                                        <td style={{ padding: "9px 16px", color: C.textMuted, fontWeight: 600 }}>{i + 1}</td>
                                        <td style={{ padding: "9px 16px", fontWeight: 600, color: C.text, whiteSpace: "nowrap" }}>{client.name}</td>
                                        <td style={{ padding: "9px 16px", fontFamily: "monospace", color: C.blue }}>{eddmFmtPhone(client.matchedPhone)}</td>
                                        <td style={{ padding: "9px 16px", fontFamily: "monospace", color: C.textSec }}>{client.cellPhone ? eddmFmtPhone(client.cellPhone) : <span style={{ color: C.textMuted }}>—</span>}</td>
                                        <td style={{ padding: "9px 16px", fontFamily: "monospace", color: C.textSec }}>{client.homePhone ? eddmFmtPhone(client.homePhone) : <span style={{ color: C.textMuted }}>—</span>}</td>
                                        <td style={{ padding: "9px 16px", fontFamily: "monospace", color: C.textSec }}>{client.workPhone ? eddmFmtPhone(client.workPhone) : <span style={{ color: C.textMuted }}>—</span>}</td>
                                        <td style={{ padding: "9px 16px", color: C.textSec, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.address || <span style={{ color: C.textMuted }}>—</span>}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          );
        })()}

        {/* Footer */}
        <footer style={{ textAlign: "center", fontSize: 11, color: C.textMuted, paddingBottom: 8 }}>
          Leads from GoHighLevel · Sales via Slack · Spend & metrics from Facebook Ads Manager
        </footer>
      </main>

      {/* ── EDDM Report sticky bar + full-screen modal ───────────────────── */}
      {(() => {
        if (!eddmResponse) return null;
        const anySpend     = Object.values(eddmSpends).some(v => parseFloat(v) > 0);
        const totalSpend   = eddmResponse.results.reduce((s, r) => s + (parseFloat(eddmSpends[r.flyerName + r.trackingNumber] ?? "") || 0), 0);
        const overallCAC   = totalSpend > 0 && eddmResponse.totalMatched > 0 ? totalSpend / eddmResponse.totalMatched : null;
        const reportDate   = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

        return (
          <>
            {/* Sticky bar — slides in when any spend is entered */}
            <div style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 48,
              transform: anySpend ? "translateY(0)" : "translateY(110%)",
              transition: "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
              background: "linear-gradient(135deg, #1e1b4b, #312e81)",
              borderTop: "1px solid rgba(255,255,255,0.1)",
              padding: "14px 32px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 16, flexWrap: "wrap",
              boxShadow: "0 -4px 30px rgba(0,0,0,0.25)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)", letterSpacing: "-0.01em" }}>
                  📊 EDDM Report Ready
                </span>
                <div style={{ display: "flex", gap: 16 }}>
                  {[
                    { label: "Total Spend", value: `$${totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
                    { label: "Conversions", value: eddmResponse.totalMatched.toString() },
                    { label: "Overall CAC", value: overallCAC ? eddmFmtMoney(overallCAC) : "—" },
                  ].map(s => (
                    <div key={s.label}>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>{s.label}</p>
                      <p style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setEddmReportOpen(true)}
                style={{
                  background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
                  color: "#fff", border: "none", borderRadius: 10,
                  padding: "11px 24px", fontSize: 14, fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                  boxShadow: "0 4px 16px rgba(124,58,237,0.5)",
                  letterSpacing: "-0.01em",
                }}
              >
                <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                View Report
              </button>
            </div>

            {/* Full-screen report modal */}
            {eddmReportOpen && (
              <div style={{
                position: "fixed", inset: 0, zIndex: 100,
                background: "rgba(15,23,42,0.6)",
                backdropFilter: "blur(4px)",
                display: "flex", alignItems: "flex-start", justifyContent: "center",
                padding: "24px 16px 100px",
                overflowY: "auto",
              }}
                onClick={e => { if (e.target === e.currentTarget) setEddmReportOpen(false); }}
              >
                <div style={{
                  background: C.card, borderRadius: 20, width: "100%", maxWidth: 900,
                  boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
                  overflow: "hidden",
                }}>
                  {/* Report header */}
                  <div style={{
                    background: "linear-gradient(135deg, #1e1b4b, #312e81)",
                    padding: "28px 32px",
                    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                  }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 24 }}>📮</span>
                        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>EDDM CAC Report</h2>
                      </div>
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>Generated {reportDate} · {eddmResponse.results.length} flyer{eddmResponse.results.length !== 1 ? "s" : ""} · {eddmResponse.totalCalls.toLocaleString()} calls</p>
                    </div>
                    <button
                      onClick={() => setEddmReportOpen(false)}
                      style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 8, padding: "8px 10px", cursor: "pointer", color: "#fff", display: "flex", alignItems: "center" }}
                    >
                      <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>

                  {/* Summary strip */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: `1px solid ${C.border}` }}>
                    {[
                      { label: "Total Calls",   value: eddmResponse.totalCalls.toLocaleString(),    color: C.blue },
                      { label: "Conversions",   value: eddmResponse.totalMatched.toLocaleString(),   color: C.green },
                      { label: "Total Spend",   value: totalSpend > 0 ? `$${totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—", color: C.purple },
                      { label: "Overall CAC",   value: overallCAC ? eddmFmtMoney(overallCAC) : "—",  color: C.amber },
                    ].map((s, i) => (
                      <div key={s.label} style={{
                        padding: "20px 24px",
                        borderRight: i < 3 ? `1px solid ${C.border}` : "none",
                      }}>
                        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: C.textMuted, marginBottom: 6 }}>{s.label}</p>
                        <p style={{ fontSize: 24, fontWeight: 800, color: s.color, letterSpacing: "-0.02em" }}>{s.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* CAC formula callout */}
                  <div style={{ padding: "16px 32px", background: C.purpleSoft, borderBottom: `1px solid #e9d5ff` }}>
                    <p style={{ fontSize: 12, color: C.purple, fontWeight: 600 }}>
                      CAC Formula: &nbsp;
                      <span style={{ fontFamily: "monospace", background: "#ede9fe", padding: "2px 8px", borderRadius: 5 }}>
                        Ad Spend ÷ Number of Clients
                      </span>
                      &nbsp;— Flyers without spend show "—" and are still included in the report.
                    </p>
                  </div>

                  {/* Report table — spend rows first, no-spend (profiles) at bottom */}
                  {(() => {
                    const withSpend    = eddmResponse.results.filter(f => (parseFloat(eddmSpends[f.flyerName + f.trackingNumber] ?? "") || 0) > 0);
                    const withoutSpend = eddmResponse.results.filter(f => (parseFloat(eddmSpends[f.flyerName + f.trackingNumber] ?? "") || 0) === 0);

                    const renderRow = (flyer: EddmFlyer, i: number, dimmed?: boolean) => {
                      const key      = flyer.flyerName + flyer.trackingNumber;
                      const spend    = parseFloat(eddmSpends[key] ?? "") || 0;
                      const cac      = spend > 0 && flyer.conversions > 0 ? spend / flyer.conversions : null;
                      const convRate = flyer.totalCalls > 0 ? ((flyer.conversions / flyer.totalCalls) * 100).toFixed(1) : "0.0";

                      return (
                        <tr key={key} style={{ borderBottom: `1px solid ${C.border}`, background: dimmed ? "#fafafa" : i % 2 === 0 ? "#fff" : "#f8fafc", opacity: dimmed ? 0.75 : 1 }}>
                          <td style={{ padding: "14px 20px", fontWeight: 600, color: dimmed ? C.textSec : C.text, maxWidth: 220 }}>
                            {flyer.flyerName || "Unknown"}
                          </td>
                          <td style={{ padding: "14px 20px", fontFamily: "monospace", fontSize: 12, color: C.textSec }}>
                            {eddmFmtPhone(flyer.trackingNumber)}
                          </td>
                          <td style={{ padding: "14px 20px", textAlign: "center", color: C.blue, fontWeight: 600 }}>
                            {flyer.totalCalls.toLocaleString()}
                          </td>
                          <td style={{ padding: "14px 20px", textAlign: "center" }}>
                            <span style={{
                              display: "inline-block", padding: "3px 12px", borderRadius: 20,
                              fontSize: 12, fontWeight: 700,
                              background: flyer.conversions > 0 ? C.greenSoft : "#f1f5f9",
                              color: flyer.conversions > 0 ? C.green : C.textMuted,
                            }}>{flyer.conversions}</span>
                          </td>
                          <td style={{ padding: "14px 20px", textAlign: "center", color: C.textSec, fontSize: 12 }}>
                            {convRate}%
                          </td>
                          <td style={{ padding: "14px 20px", textAlign: "center", fontWeight: 600 }}>
                            {spend > 0
                              ? <span style={{ color: C.purple }}>${spend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              : <span style={{ color: C.textMuted, fontSize: 12 }}>—</span>}
                          </td>
                          <td style={{ padding: "14px 20px", textAlign: "center" }}>
                            {cac !== null
                              ? <span style={{ display: "inline-block", padding: "4px 14px", borderRadius: 20, fontSize: 13, fontWeight: 800, background: cac < 100 ? C.greenSoft : cac < 300 ? C.amberSoft : C.redSoft, color: cac < 100 ? C.green : cac < 300 ? C.amber : C.red }}>{eddmFmtMoney(cac)}</span>
                              : <span style={{ color: C.textMuted }}>—</span>}
                          </td>
                        </tr>
                      );
                    };

                    const cols = ["Flyer Name", "Tracking Number", "Total Calls", "Conversions", "Conv. Rate", "Ad Spend", "CAC"];

                    return (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ background: "#f8fafc" }}>
                              {cols.map((h, i) => (
                                <th key={h} style={{ padding: "12px 20px", textAlign: i >= 2 ? "center" : "left", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textMuted, borderBottom: `2px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {/* ── Flyers with spend (CAC calculated) ── */}
                            {withSpend.map((flyer, i) => renderRow(flyer, i))}

                            {/* ── Divider before no-spend rows ── */}
                            {withoutSpend.length > 0 && (
                              <tr>
                                <td colSpan={7} style={{ padding: "10px 20px", background: "#f1f5f9", borderTop: `2px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: C.textMuted }}>
                                      Business Profiles &amp; Channels Without Spend
                                    </span>
                                    <span style={{ fontSize: 11, color: C.textMuted }}>— no CAC calculable</span>
                                  </div>
                                </td>
                              </tr>
                            )}

                            {/* ── No-spend rows (Google My Business, etc.) ── */}
                            {withoutSpend.map((flyer, i) => renderRow(flyer, i, true))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}

                  {/* Report footer */}
                  <div style={{ padding: "16px 32px", borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <p style={{ fontSize: 11, color: C.textMuted }}>
                      CAC color: <span style={{ color: C.green, fontWeight: 600 }}>Green &lt; $100</span> · <span style={{ color: C.amber, fontWeight: 600 }}>Amber $100–$300</span> · <span style={{ color: C.red, fontWeight: 600 }}>Red &gt; $300</span>
                    </p>
                    <button
                      onClick={() => setEddmReportOpen(false)}
                      style={{ fontSize: 12, fontWeight: 600, color: C.textSec, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 16px", cursor: "pointer" }}
                    >Close</button>
                  </div>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* ── EDDM Spend Assistant FAB + Panel ────────────────────────────── */}
      {tab === "eddm" && eddmResponse && (() => {
        async function sendEddmChat(text: string, img?: string | null) {
          const trimmed = text.trim();
          if (!trimmed && !img) return;

          const userMsg = { id: Date.now().toString(), role: "user" as const, content: trimmed, image: img ?? undefined, ts: new Date() };
          setEddmChatMessages(p => [...p, userMsg]);
          setEddmChatInput("");
          setEddmChatImg(null);
          setEddmChatBusy(true);

          try {
            const history = [...eddmChatMessages, userMsg].slice(-12).map(m => ({
              role: m.role, content: m.content, image: m.image,
            }));

            const res  = await fetch("/api/eddm-chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ messages: history, flyers: eddmResponse!.results }),
            });
            const data = await res.json() as { reply: string; spendUpdates: Record<string, number> };

            // Apply spend updates — match by tracking number digits
            if (data.spendUpdates && Object.keys(data.spendUpdates).length > 0) {
              setEddmSpends(prev => {
                const next = { ...prev };
                for (const [rawNum, amount] of Object.entries(data.spendUpdates)) {
                  const digits = rawNum.replace(/\D/g, "");
                  const flyer = eddmResponse!.results.find(f => f.trackingNumber.replace(/\D/g, "") === digits);
                  if (flyer) {
                    const key = flyer.flyerName + flyer.trackingNumber;
                    next[key] = amount > 0 ? String(amount) : "";
                  }
                }
                return next;
              });
            }

            setEddmChatMessages(p => [...p, { id: Date.now().toString() + "r", role: "assistant", content: data.reply, ts: new Date() }]);
          } catch {
            setEddmChatMessages(p => [...p, { id: Date.now().toString() + "e", role: "assistant", content: "Something went wrong. Please try again.", ts: new Date() }]);
          } finally {
            setEddmChatBusy(false);
            setTimeout(() => eddmChatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
          }
        }

        function handleEddmPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
          const items = e.clipboardData.items;
          for (const item of Array.from(items)) {
            if (item.type.startsWith("image/")) {
              e.preventDefault();
              const file = item.getAsFile();
              if (!file) continue;
              const reader = new FileReader();
              reader.onload = ev => setEddmChatImg(ev.target?.result as string);
              reader.readAsDataURL(file);
              return;
            }
          }
        }

        function handleEddmImgFile(e: React.ChangeEvent<HTMLInputElement>) {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = ev => setEddmChatImg(ev.target?.result as string);
          reader.readAsDataURL(file);
          e.target.value = "";
        }

        return (
          <>
            {/* FAB */}
            <button
              onClick={() => setEddmChatOpen(o => !o)}
              title="Spend Assistant"
              style={{
                position: "fixed", bottom: 28, right: 28, zIndex: 50,
                width: 52, height: 52, borderRadius: "50%",
                background: "linear-gradient(135deg, #0891b2, #0e7490)",
                border: "none", cursor: "pointer",
                boxShadow: "0 4px 20px rgba(8,145,178,0.45)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "transform 0.2s, box-shadow 0.2s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1.08)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
            >
              {eddmChatOpen
                ? <svg width={18} height={18} fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                : <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              }
            </button>

            {/* Tooltip */}
            {!eddmChatOpen && (
              <div style={{
                position: "fixed", bottom: 36, right: 90, zIndex: 50,
                background: "#0f172a", color: "#fff", fontSize: 12, fontWeight: 500,
                padding: "6px 12px", borderRadius: 8, whiteSpace: "nowrap",
                pointerEvents: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              }}>
                Spend Assistant
                <span style={{ position: "absolute", right: -5, top: "50%", transform: "translateY(-50%)", borderTop: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: "5px solid #0f172a" }} />
              </div>
            )}

            {/* Chat panel */}
            <div style={{
              position: "fixed", bottom: 90, right: 28, zIndex: 49,
              width: 380, maxHeight: "calc(100vh - 130px)",
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 18,
              boxShadow: "0 8px 40px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08)",
              display: "flex", flexDirection: "column", overflow: "hidden",
              transition: "opacity 0.2s, transform 0.2s",
              opacity: eddmChatOpen ? 1 : 0,
              transform: eddmChatOpen ? "translateY(0) scale(1)" : "translateY(12px) scale(0.97)",
              pointerEvents: eddmChatOpen ? "all" : "none",
            }}>
              {/* Header */}
              <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, background: "linear-gradient(135deg, #0891b2, #0e7490)", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>💰</div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Spend Assistant</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.65)" }}>Paste data or attach a screenshot</p>
                </div>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: "auto", padding: "14px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                {eddmChatMessages.map(m => (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 4 }}>
                    {m.image && (
                      <img src={m.image} alt="attachment" style={{ maxWidth: 220, borderRadius: 10, border: `1px solid ${C.border}` }} />
                    )}
                    <div style={{
                      maxWidth: "85%", padding: "9px 13px", borderRadius: m.role === "user" ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                      background: m.role === "user" ? "linear-gradient(135deg, #0891b2, #0e7490)" : C.bg,
                      color: m.role === "user" ? "#fff" : C.text,
                      fontSize: 13, lineHeight: 1.5,
                      border: m.role === "assistant" ? `1px solid ${C.border}` : "none",
                    }}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {eddmChatBusy && (
                  <div style={{ display: "flex", alignItems: "flex-start" }}>
                    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: "14px 14px 14px 2px", padding: "9px 14px", display: "flex", gap: 4, alignItems: "center" }}>
                      {[0,1,2].map(i => (
                        <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: C.textMuted, display: "inline-block", animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={eddmChatEndRef} />
              </div>

              {/* Image preview */}
              {eddmChatImg && (
                <div style={{ padding: "8px 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
                  <img src={eddmChatImg} alt="preview" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} />
                  <button onClick={() => setEddmChatImg(null)} style={{ fontSize: 11, color: C.red, background: C.redSoft, border: "none", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>Remove</button>
                  <span style={{ fontSize: 11, color: C.textMuted }}>Image ready to send</span>
                </div>
              )}

              {/* Input */}
              <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  rows={2}
                  value={eddmChatInput}
                  onChange={e => setEddmChatInput(e.target.value)}
                  onPaste={handleEddmPaste}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendEddmChat(eddmChatInput, eddmChatImg); } }}
                  placeholder="Paste spend data, describe amounts, or press Ctrl+V to paste a screenshot…"
                  disabled={eddmChatBusy}
                  style={{
                    width: "100%", resize: "none", border: `1px solid ${C.border}`,
                    borderRadius: 10, padding: "9px 12px", fontSize: 13,
                    color: C.text, background: C.bg, outline: "none",
                    lineHeight: 1.5, fontFamily: "inherit",
                    opacity: eddmChatBusy ? 0.6 : 1,
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Image attach */}
                  <button
                    onClick={() => eddmImgInputRef.current?.click()}
                    title="Attach screenshot"
                    style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                  >
                    <svg width={15} height={15} fill="none" viewBox="0 0 24 24" stroke={C.textSec} strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <input ref={eddmImgInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleEddmImgFile} />

                  <p style={{ flex: 1, fontSize: 10, color: C.textMuted }}>Enter to send · Shift+Enter for newline · Ctrl+V to paste image</p>

                  <button
                    onClick={() => sendEddmChat(eddmChatInput, eddmChatImg)}
                    disabled={eddmChatBusy || (!eddmChatInput.trim() && !eddmChatImg)}
                    style={{
                      background: (eddmChatBusy || (!eddmChatInput.trim() && !eddmChatImg)) ? "#e2e8f0" : "linear-gradient(135deg, #0891b2, #0e7490)",
                      color: (eddmChatBusy || (!eddmChatInput.trim() && !eddmChatImg)) ? C.textMuted : "#fff",
                      border: "none", borderRadius: 8, padding: "6px 14px",
                      fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0,
                    }}
                  >Send</button>
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* ── CAC AI Chat FAB + Overlay (fixed, always visible) ─────────────── */}
      {tab === "cac" && (
        <>
          {/* Floating action button */}
          <button
            onClick={() => { setCacChatOpen(o => !o); setCacChatHasUnread(false); }}
            style={{
              position: "fixed", bottom: 28, right: 28, zIndex: 50,
              width: 54, height: 54, borderRadius: "50%",
              background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
              border: "none", cursor: "pointer",
              boxShadow: "0 4px 20px rgba(124,58,237,0.45)",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "transform 0.2s, box-shadow 0.2s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1.08)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 24px rgba(124,58,237,0.55)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(124,58,237,0.45)"; }}
          >
            {cacChatOpen
              ? <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              : <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
            }
            {/* Unread dot */}
            {cacChatHasUnread && !cacChatOpen && (
              <span style={{
                position: "absolute", top: 6, right: 6,
                width: 10, height: 10, borderRadius: "50%",
                background: "#22c55e", border: "2px solid #fff",
              }} />
            )}
          </button>

          {/* Tooltip label — shown when panel closed */}
          {!cacChatOpen && (
            <div style={{
              position: "fixed", bottom: 36, right: 92, zIndex: 50,
              background: "#1e293b", color: "#fff", fontSize: 12, fontWeight: 500,
              padding: "6px 12px", borderRadius: 8, whiteSpace: "nowrap",
              pointerEvents: "none",
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            }}>
              Ask AI about your data
              <span style={{ position: "absolute", right: -5, top: "50%", transform: "translateY(-50%)", borderTop: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: "5px solid #1e293b" }} />
            </div>
          )}

          {/* Slide-up chat panel */}
          <div style={{
            position: "fixed", bottom: 92, right: 28, zIndex: 49,
            width: 400,
            maxHeight: "calc(100vh - 120px)",
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 18,
            boxShadow: "0 8px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)",
            display: "flex", flexDirection: "column",
            overflow: "hidden",
            transform: cacChatOpen ? "translateY(0) scale(1)" : "translateY(16px) scale(0.97)",
            opacity: cacChatOpen ? 1 : 0,
            pointerEvents: cacChatOpen ? "all" : "none",
            transition: "transform 0.22s cubic-bezier(0.34,1.56,0.64,1), opacity 0.18s ease",
          }}>
            {/* Panel header */}
            <div style={{
              padding: "14px 16px", borderBottom: `1px solid ${C.border}`,
              background: "linear-gradient(135deg, #7c3aed08, #ffffff)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#7c3aed,#6d28d9)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="#fff" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                </div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: C.text }}>CAC Analyst</p>
                  <p style={{ fontSize: 11, color: C.purple }}>● Live data · {DATE_RANGE_LABELS[dateRange]}</p>
                </div>
              </div>
              <button onClick={() => setCacChatOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, padding: 4, borderRadius: 6 }}>
                <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10, minHeight: 280, maxHeight: 400 }}>
              {cacChatMessages.map(msg => (
                <div key={msg.id} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "84%",
                    padding: "9px 13px",
                    borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    background: msg.role === "user" ? "linear-gradient(135deg,#7c3aed,#6d28d9)" : C.bg,
                    border: msg.role === "user" ? "none" : `1px solid ${C.border}`,
                    color: msg.role === "user" ? "#fff" : C.text,
                    fontSize: 13, lineHeight: 1.55,
                  }}>
                    {msg.text.split("\n").map((line, i, arr) => (
                      <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
                    ))}
                  </div>
                </div>
              ))}
              {cacChatThinking && (
                <div style={{ display: "flex", gap: 5, padding: "8px 12px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: "14px 14px 14px 4px", width: "fit-content" }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: C.purple, opacity: 0.7, animation: "bounce 1s ease-in-out infinite", animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              )}
              <div ref={cacChatEndRef} />
            </div>

            {/* Suggested prompts — only before first real message */}
            {cacChatMessages.length <= 1 && (
              <div style={{ padding: "0 12px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  "Best performing ad",
                  "CAC last 7 days?",
                  "Spend vs sales?",
                  "Lowest CAC ad?",
                ].map(p => (
                  <button key={p} onClick={() => sendCacChat(p)}
                    style={{
                      padding: "5px 11px", borderRadius: 20, fontSize: 11, fontWeight: 500,
                      background: C.purpleSoft, color: C.purple, border: `1px solid ${C.purple}30`,
                      cursor: "pointer", transition: "background 0.15s",
                    }}>
                    {p}
                  </button>
                ))}
              </div>
            )}

            {/* Input bar */}
            <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8, background: C.card }}>
              <input
                type="text"
                value={cacChatInput}
                onChange={e => setCacChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendCacChat(cacChatInput); } }}
                placeholder="Ask about CAC, spend, best ads…"
                disabled={cacChatThinking}
                autoFocus={cacChatOpen}
                style={{
                  flex: 1, padding: "9px 13px", borderRadius: 9, fontSize: 13,
                  background: C.bg, border: `1px solid ${C.border}`, color: C.text, outline: "none",
                  opacity: cacChatThinking ? 0.6 : 1,
                }}
              />
              <button
                onClick={() => sendCacChat(cacChatInput)}
                disabled={cacChatThinking || !cacChatInput.trim()}
                style={{
                  padding: "9px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600,
                  background: cacChatThinking || !cacChatInput.trim() ? C.border : "linear-gradient(135deg,#7c3aed,#6d28d9)",
                  color: cacChatThinking || !cacChatInput.trim() ? C.textMuted : "#fff",
                  border: "none", cursor: cacChatThinking || !cacChatInput.trim() ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 5, transition: "all 0.15s",
                }}>
                {cacChatThinking
                  ? <Spinner size={13} color={C.purple} />
                  : <svg width={14} height={14} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                }
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
