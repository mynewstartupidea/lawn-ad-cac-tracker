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

type LeadFilter = "all" | "open" | "sold";
type DateRange  = "7d" | "14d" | "30d" | "all";
type SortCol    = "adName" | "spend" | "leads" | "sales" | "conv" | "cac";
type SortDir    = "asc" | "desc";
type Account    = "all" | "florida" | "georgia";
type Tab        = "cac" | "ads";

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

  // AI Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Hi! I can help you manage your Facebook Ads campaigns. Try asking me to pause a campaign, adjust budgets, or launch a new ad.",
      ts: new Date(),
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatThinking, setChatThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Brand assets state
  const [assets] = useState<{ name: string; type: string; size: string }[]>([]);

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

  // ── Chat handler ──────────────────────────────────────────────────────────

  const sendChat = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", text: text.trim(), ts: new Date() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setChatThinking(true);
    // Simulate response — real integration requires backend route
    await new Promise(r => setTimeout(r, 1200));
    const reply: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      text: `Your request has been noted. To execute ad commands (pause campaigns, adjust budgets, launch ads), connect the Facebook Ads Management API in your backend. Your message: "${text.trim()}"`,
      ts: new Date(),
    };
    setChatMessages(prev => [...prev, reply]);
    setChatThinking(false);
  }, []);

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
              { key: "cac", label: "CAC Dashboard" },
              { key: "ads", label: "Ad Management" },
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
            {/* ── Section label ─────────────────────────────────────────── */}
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>Ad Management</h1>
              <p style={{ fontSize: 13, color: C.textMuted, marginTop: 3 }}>
                {DATE_RANGE_LABELS[dateRange]} · {ACCOUNT_LABELS[account]}
              </p>
            </div>

            {/* ── Facebook Metrics ──────────────────────────────────────── */}
            <section>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 20, height: 20, borderRadius: 5, background: "#1877f2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width={11} height={11} fill="white" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                </div>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Facebook Metrics</h2>
                <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 20, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>
                  {ACCOUNT_LABELS[account]} · {DATE_RANGE_LABELS[dateRange]}
                </span>
                {syncingFb && (
                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: C.textMuted }}>
                    <Spinner size={12} /> Fetching…
                  </span>
                )}
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

            {/* ── Ad Performance Table ──────────────────────────────────── */}
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

              {/* Desktop */}
              <div style={{
                background: C.card,
                border: `1px solid ${loadingData || syncingFb ? C.blue + "30" : C.border}`,
                borderRadius: 14, overflow: "hidden", boxShadow: C.shadow,
                position: "relative", transition: "border-color 0.3s",
              }} className="hidden sm:block">
                {(loadingData || syncingFb) && (
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
                                          {row.fromFacebook && (
                                            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", padding: "2px 5px", borderRadius: 4, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe" }}>FB</span>
                                          )}
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

              {/* Mobile ad cards */}
              <div className="sm:hidden" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {loadingData
                  ? [...Array(3)].map((_, i) => (
                      <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                        <div className="skeleton" style={{ height: 14, width: 160, borderRadius: 4, marginBottom: 12 }} />
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                          {[...Array(4)].map((_, j) => (
                            <div key={j} className="skeleton" style={{ height: 40, borderRadius: 8 }} />
                          ))}
                        </div>
                      </div>
                    ))
                  : adStats.length === 0
                    ? <p style={{ textAlign: "center", padding: "40px 0", fontSize: 13, color: C.textMuted }}>No ad data for this period.</p>
                    : adStats.map(row => (
                        <div key={row.adName} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                            <p style={{ fontWeight: 600, fontSize: 14, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{row.adName}</p>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {row.fromFacebook && <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", padding: "2px 5px", borderRadius: 4, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe" }}>FB</span>}
                              {row.spend > 0 && <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{fmtMoney(row.spend)}</span>}
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                            {[
                              { label: "Leads", value: row.leads.toString(),                            color: C.textSec },
                              { label: "Sales", value: row.sales.toString(),                            color: C.green },
                              { label: "Conv",  value: row.conv > 0 ? `${row.conv.toFixed(1)}%` : "—", color: C.textSec },
                              { label: "CAC",   value: row.cac  > 0 ? fmtMoney(row.cac)         : "—", color: C.purple },
                            ].map(cell => (
                              <div key={cell.label} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                                <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: C.textMuted, marginBottom: 4 }}>{cell.label}</p>
                                <p style={{ fontSize: 13, fontWeight: 700, color: cell.color }}>{cell.value}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
              </div>
            </section>

            {/* ── Two-column bottom row: Chat + Brand Assets ────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="grid-cols-1 lg:grid-cols-2">

              {/* ── AI Chat ───────────────────────────────────────────────── */}
              <section style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ marginBottom: 14 }}>
                  <h2 style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Ad Command Center</h2>
                  <p style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Ask AI to pause, launch, or adjust your campaigns</p>
                </div>
                <div style={{
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
                  boxShadow: C.shadow, display: "flex", flexDirection: "column", height: 420,
                }}>
                  {/* Messages */}
                  <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
                    {chatMessages.map(msg => (
                      <div key={msg.id} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                        {msg.role === "assistant" && (
                          <div style={{
                            width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg, #16a34a, #15803d)",
                            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12,
                            flexShrink: 0, marginRight: 8, alignSelf: "flex-end",
                          }}>🌿</div>
                        )}
                        <div style={{
                          maxWidth: "75%",
                          padding: "10px 14px",
                          borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                          background: msg.role === "user" ? C.blue : C.bg,
                          color: msg.role === "user" ? "#fff" : C.text,
                          fontSize: 13,
                          lineHeight: 1.5,
                          border: msg.role === "assistant" ? `1px solid ${C.border}` : "none",
                        }}>
                          {msg.text}
                        </div>
                      </div>
                    ))}
                    {chatThinking && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg, #16a34a, #15803d)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>🌿</div>
                        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: "14px 14px 14px 4px", padding: "10px 16px" }}>
                          <Spinner size={14} color={C.textMuted} />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Quick actions */}
                  <div style={{ padding: "0 14px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["Pause all campaigns", "Show top performer", "Reduce budget 20%", "Launch new campaign"].map(q => (
                      <button key={q} onClick={() => sendChat(q)}
                        style={{
                          fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 20,
                          background: C.blueSoft, color: C.blueText, border: `1px solid #bfdbfe`,
                          cursor: "pointer",
                        }}>
                        {q}
                      </button>
                    ))}
                  </div>

                  {/* Input */}
                  <div style={{ padding: "10px 14px 14px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="Type a command…"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(chatInput); } }}
                      style={{
                        flex: 1, padding: "8px 12px", fontSize: 13, borderRadius: 8, outline: "none",
                        background: C.bg, border: `1px solid ${C.border}`, color: C.text,
                      }}
                    />
                    <button onClick={() => sendChat(chatInput)} disabled={!chatInput.trim() || chatThinking}
                      style={{
                        padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                        background: chatInput.trim() && !chatThinking ? C.blue : C.bg,
                        color: chatInput.trim() && !chatThinking ? "#fff" : C.textMuted,
                        border: `1px solid ${chatInput.trim() && !chatThinking ? C.blue : C.border}`,
                        cursor: chatInput.trim() && !chatThinking ? "pointer" : "not-allowed",
                        transition: "all 0.15s",
                      }}>
                      Send
                    </button>
                  </div>
                </div>
              </section>

              {/* ── Brand Assets ──────────────────────────────────────────── */}
              <section style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 600, color: C.text }}>Brand Assets</h2>
                    <p style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Logos, creatives, and ad images</p>
                  </div>
                  <label style={{
                    fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 8,
                    background: C.card, border: `1px solid ${C.border}`, color: C.text,
                    cursor: "pointer", boxShadow: C.shadow,
                  }}>
                    Upload
                    <input type="file" accept="image/*" multiple style={{ display: "none" }} />
                  </label>
                </div>
                <div style={{
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
                  boxShadow: C.shadow, flex: 1, height: 420, display: "flex", flexDirection: "column",
                }}>
                  {assets.length === 0
                    ? (
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
                          {/* Drag & drop zone */}
                          <div style={{
                            width: "100%", maxWidth: 280, padding: "32px 24px",
                            border: `2px dashed ${C.border}`, borderRadius: 12,
                            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                            background: C.bg,
                          }}>
                            <div style={{ width: 44, height: 44, borderRadius: 10, background: C.blueSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke={C.blue} strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                              </svg>
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <p style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Drop files here</p>
                              <p style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>PNG, JPG, SVG up to 10MB</p>
                            </div>
                            <label style={{
                              fontSize: 12, fontWeight: 600, padding: "6px 16px", borderRadius: 8,
                              background: C.blue, color: "#fff", cursor: "pointer",
                            }}>
                              Browse files
                              <input type="file" accept="image/*" multiple style={{ display: "none" }} />
                            </label>
                          </div>
                          <p style={{ fontSize: 11, color: C.textMuted, marginTop: 20, textAlign: "center" }}>
                            Upload logos and ad creatives to keep them organized alongside your campaigns.
                          </p>
                        </div>
                      )
                    : (
                        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, overflowY: "auto" }}>
                          {assets.map((a, i) => (
                            <div key={i} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px", display: "flex", flexDirection: "column", gap: 6 }}>
                              <div style={{ height: 70, borderRadius: 6, background: C.blueSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <svg width={20} height={20} fill="none" viewBox="0 0 24 24" stroke={C.blue} strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                                </svg>
                              </div>
                              <p style={{ fontSize: 11, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</p>
                              <p style={{ fontSize: 10, color: C.textMuted }}>{a.size}</p>
                            </div>
                          ))}
                        </div>
                      )}
                </div>
              </section>
            </div>
          </>
        )}

        {/* Footer */}
        <footer style={{ textAlign: "center", fontSize: 11, color: C.textMuted, paddingBottom: 8 }}>
          Leads from GoHighLevel · Sales via Slack · Spend & metrics from Facebook Ads Manager
        </footer>
      </main>
    </div>
  );
}
