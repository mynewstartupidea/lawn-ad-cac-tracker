"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type LeadFilter = "all" | "open" | "sold";
type DateRange  = "7d" | "14d" | "30d" | "all";
type SortCol    = "adName" | "spend" | "leads" | "sales" | "conv" | "cac";
type SortDir    = "asc" | "desc";
type Account    = "all" | "florida" | "georgia";

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

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg style={{ width: size, height: size }} className="animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, icon, accentColor, loading }: {
  label: string; value: string; sub?: string; icon: React.ReactNode;
  accentColor: string; loading?: boolean;
}) {
  return (
    <div className="relative rounded-2xl border overflow-hidden p-5 flex flex-col gap-3"
      style={{ background: "#111", borderColor: loading ? accentColor + "30" : "rgba(255,255,255,0.06)", transition: "border-color 0.4s" }}>
      {/* Accent top bar — sweeps while loading */}
      <div className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden" style={{ background: accentColor + "40" }}>
        <div style={{ position: "absolute", inset: 0, background: accentColor }} />
        {loading && (
          <div style={{
            position: "absolute", top: 0, bottom: 0, width: "30%",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent)",
            animation: "scan 1.4s ease-in-out infinite",
          }} />
        )}
      </div>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center"
        style={{ background: accentColor + (loading ? "08" : "15"), transition: "background 0.3s" }}>{icon}</div>
      <div>
        <p className="text-[10px] font-semibold tracking-widest uppercase mb-1"
          style={{ color: "rgba(255,255,255,0.25)" }}>{label}</p>
        {loading
          ? <div className="skeleton h-7 w-20 rounded-lg" />
          : <p className="text-[26px] font-bold text-white leading-none tracking-tight">{value}</p>}
        {sub && !loading && <p className="text-[11px] mt-1.5" style={{ color: "rgba(255,255,255,0.2)" }}>{sub}</p>}
        {loading && <div className="skeleton h-3 w-16 rounded mt-2" />}
      </div>
    </div>
  );
}

// ─── FB Metric Pill ───────────────────────────────────────────────────────────

function FbPill({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl p-4 flex-1 min-w-[120px]"
      style={{ background: "#161616", border: `1px solid ${loading ? "rgba(24,119,242,0.15)" : "rgba(255,255,255,0.05)"}`, transition: "border-color 0.3s" }}>
      <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.2)" }}>{label}</p>
      {loading
        ? <div className="skeleton h-5 w-16 rounded" />
        : <p className="text-base font-bold text-white">{value}</p>}
    </div>
  );
}

// ─── Sort Icon ────────────────────────────────────────────────────────────────

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return <span style={{ opacity: active ? 1 : 0.2, marginLeft: 4, fontSize: 10 }}>
    {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
  </span>;
}

// ─── Skeleton Row ─────────────────────────────────────────────────────────────

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {[...Array(cols)].map((_, i) => (
        <td key={i} className="px-5 py-4">
          <div className="skeleton h-3.5 rounded" style={{ width: `${45 + (i * 17) % 45}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Dropdown style ───────────────────────────────────────────────────────────

const dropdownStyle: React.CSSProperties = {
  background: "#1a1a1a",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.7)",
  borderRadius: 12,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 500,
  outline: "none",
  appearance: "none" as const,
  cursor: "pointer",
};

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [leads, setLeads]   = useState<Lead[]>([]);
  const [sales, setSales]   = useState<Sale[]>([]);
  const [adSpends, setAdSpends] = useState<Record<string, { spend: number; source: string }>>({});
  const [fbMetrics, setFbMetrics] = useState<FbMetrics | null>(null);

  const [loadingData, setLoadingData] = useState(true);
  const [syncingFb,   setSyncingFb]   = useState(false);
  const [fbError,     setFbError]     = useState<string | null>(null);
  const [lastSynced,  setLastSynced]  = useState<Date | null>(null);
  const [relTime,     setRelTime]     = useState("");

  // Controls
  const [dateRange,   setDateRange]   = useState<DateRange>("30d");
  const [account,     setAccount]     = useState<Account>("all");
  const [adFilter,    setAdFilter]    = useState<string>("all");
  const [leadFilter,  setLeadFilter]  = useState<LeadFilter>("all");
  const [search,      setSearch]      = useState("");
  const [sortCol,     setSortCol]     = useState<SortCol>("leads");
  const [sortDir,     setSortDir]     = useState<SortDir>("desc");

  // Relative time ticker
  useEffect(() => {
    if (!lastSynced) return;
    setRelTime(relativeTime(lastSynced));
    const id = setInterval(() => setRelTime(relativeTime(lastSynced)), 15_000);
    return () => clearInterval(id);
  }, [lastSynced]);

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
        // Update spend map
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

  // ── Initial load ─────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setLoadingData(true);
      await fetchSupabase();
      setLoadingData(false);
      syncFacebook(dateRange, account);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── When controls change ──────────────────────────────────────────────────

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

  const hdrStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
    color: "rgba(255,255,255,0.2)", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  };

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: "#0a0a0a", minHeight: "100vh", color: "#fafafa" }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 px-4 sm:px-6 h-14 flex items-center justify-between"
        style={{ background: "rgba(10,10,10,0.9)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs"
            style={{ background: "linear-gradient(135deg,#10b981,#059669)" }}>🌿</div>
          <span className="text-sm font-bold text-white">Lawn CAC Tracker</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Sync status */}
          <div className="hidden lg:flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
            {syncingFb
              ? <><Spinner size={11} /><span style={{ color: "rgba(255,255,255,0.35)" }}>Syncing…</span></>
              : lastSynced ? <span>FB synced {relTime}</span>
              : fbError    ? <span style={{ color: "#f59e0b" }}>⚠ FB not connected</span>
              : null}
          </div>

          {/* Account switcher */}
          <select value={account} onChange={e => handleAccount(e.target.value as Account)} style={{ ...dropdownStyle, minWidth: 160 }}>
            {(["all","florida","georgia"] as Account[]).map(a => (
              <option key={a} value={a}>{ACCOUNT_LABELS[a]}</option>
            ))}
          </select>

          {/* Date range */}
          <select value={dateRange} onChange={e => handleDateRange(e.target.value as DateRange)} style={{ ...dropdownStyle, minWidth: 120 }}>
            {(["7d","14d","30d","all"] as DateRange[]).map(r => (
              <option key={r} value={r}>{DATE_RANGE_LABELS[r]}</option>
            ))}
          </select>

          {/* Refresh */}
          <button onClick={refresh} disabled={loadingData || syncingFb}
            className="flex items-center gap-1.5 text-xs font-medium transition-all"
            style={{ ...dropdownStyle, opacity: loadingData || syncingFb ? 0.4 : 1, cursor: loadingData || syncingFb ? "not-allowed" : "pointer" }}>
            {loadingData ? <Spinner size={11} /> : (
              <svg width={11} height={11} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

        {/* ── FB warning ──────────────────────────────────────────────────── */}
        {fbError && (
          <div className="flex items-start gap-3 rounded-xl px-4 py-3.5"
            style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)" }}>
            <span style={{ color: "#f59e0b", flexShrink: 0, marginTop: 1 }}>⚠</span>
            <div>
              <p className="text-sm font-medium" style={{ color: "#f59e0b" }}>Facebook Ads not connected</p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(245,158,11,0.5)" }}>
                Add <code style={{ background: "rgba(245,158,11,0.1)", padding: "1px 5px", borderRadius: 4 }}>FACEBOOK_ACCESS_TOKEN</code> and{" "}
                <code style={{ background: "rgba(245,158,11,0.1)", padding: "1px 5px", borderRadius: 4 }}>FACEBOOK_AD_ACCOUNT_IDS</code> to Vercel env vars.
              </p>
            </div>
          </div>
        )}

        {/* ── CAC / Performance Metrics ────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetricCard label="Total Leads" value={loadingData ? "—" : totals.leads.toString()}
            sub={DATE_RANGE_LABELS[dateRange].toLowerCase()} accentColor="#3b82f6" loading={loadingData}
            icon={<svg width={17} height={17} fill="none" viewBox="0 0 24 24" stroke="#3b82f6" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
          />
          <MetricCard label="Sales Closed" value={loadingData ? "—" : totals.sales.toString()}
            sub="via Slack · sold" accentColor="#10b981" loading={loadingData}
            icon={<svg width={17} height={17} fill="none" viewBox="0 0 24 24" stroke="#10b981" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          />
          <MetricCard label="Ad Spend"
            value={syncingFb && totals.spend === 0 ? "Syncing…" : totals.spend > 0 ? fmtMoney(totals.spend) : "—"}
            sub={ACCOUNT_LABELS[account]} accentColor="#f97316" loading={syncingFb && totals.spend === 0}
            icon={<svg width={17} height={17} fill="none" viewBox="0 0 24 24" stroke="#f97316" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          />
          <MetricCard label="Avg CAC"
            value={totals.cac ? fmtMoney(totals.cac) : "—"}
            sub="spend ÷ sales" accentColor="#8b5cf6" loading={syncingFb && totals.spend === 0}
            icon={<svg width={17} height={17} fill="none" viewBox="0 0 24 24" stroke="#8b5cf6" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>}
          />
          <MetricCard label="Conv. Rate"
            value={totals.conversion !== null ? `${totals.conversion.toFixed(1)}%` : "—"}
            sub="leads → closed" accentColor="#06b6d4" loading={loadingData}
            icon={<svg width={17} height={17} fill="none" viewBox="0 0 24 24" stroke="#06b6d4" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
          />
        </div>

        {/* ── Facebook Metrics Row ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-4 h-4 rounded flex items-center justify-center"
              style={{ background: "#1877f2" }}>
              <svg width={9} height={9} fill="white" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-white">Facebook Ads Metrics</h2>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(24,119,242,0.1)", color: "#60a5fa", border: "1px solid rgba(24,119,242,0.2)" }}>
              {ACCOUNT_LABELS[account]} · {DATE_RANGE_LABELS[dateRange]}
            </span>
            {syncingFb && <span className="flex items-center gap-1 text-xs" style={{ color: "rgba(255,255,255,0.25)" }}><Spinner size={11} /> Fetching…</span>}
          </div>

          <div className="flex gap-2 flex-wrap">
            <FbPill label="Impressions" value={fbMetrics ? fmtNum(fbMetrics.impressions) : "—"} loading={syncingFb && !fbMetrics} />
            <FbPill label="Reach"       value={fbMetrics ? fmtNum(fbMetrics.reach)       : "—"} loading={syncingFb && !fbMetrics} />
            <FbPill label="Clicks"      value={fbMetrics ? fmtNum(fbMetrics.clicks)      : "—"} loading={syncingFb && !fbMetrics} />
            <FbPill label="CTR"         value={fbMetrics ? `${fbMetrics.ctr.toFixed(2)}%` : "—"} loading={syncingFb && !fbMetrics} />
            <FbPill label="CPM"         value={fbMetrics ? `$${fbMetrics.cpm.toFixed(2)}` : "—"} loading={syncingFb && !fbMetrics} />
            <FbPill label="CPC"         value={fbMetrics ? `$${fbMetrics.cpc.toFixed(2)}` : "—"} loading={syncingFb && !fbMetrics} />
            <FbPill label="Total Spend" value={fbMetrics ? fmtMoney(fbMetrics.spend)     : "—"} loading={syncingFb && !fbMetrics} />
          </div>
        </section>

        {/* ── Ad Performance ──────────────────────────────────────────────── */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Ad Performance</h2>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
                Click column headers to sort · {DATE_RANGE_LABELS[dateRange]} · {ACCOUNT_LABELS[account]}
              </p>
            </div>
            <select value={adFilter} onChange={e => setAdFilter(e.target.value)}
              style={{ ...dropdownStyle, maxWidth: 220 }}>
              <option value="all">All ads</option>
              {allAdNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block rounded-2xl overflow-hidden relative"
            style={{ background: "#111", border: `1px solid ${loadingData || syncingFb ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)"}`, transition: "border-color 0.4s" }}>
            {(loadingData || syncingFb) && (
              <div className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden z-10">
                <div style={{
                  position: "absolute", top: 0, bottom: 0, width: "35%",
                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
                  animation: "scan 1.6s ease-in-out infinite",
                }} />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    {([
                      { col: "adName", label: "Ad Name" }, { col: "spend", label: "Spend" },
                      { col: "leads",  label: "Leads" },   { col: "sales", label: "Sales" },
                      { col: "conv",   label: "Conv %" },  { col: "cac",   label: "CAC" },
                    ] as { col: SortCol; label: string }[]).map(({ col, label }) => (
                      <th key={col} className="text-left px-5 py-3" style={hdrStyle} onClick={() => handleSort(col)}>
                        {label}<SortIcon active={sortCol === col} dir={sortDir} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingData ? [...Array(3)].map((_, i) => <SkeletonRow key={i} cols={6} />)
                  : adStats.length === 0
                    ? <tr><td colSpan={6} className="px-5 py-16 text-center text-sm" style={{ color: "rgba(255,255,255,0.1)" }}>No ad data for this period.</td></tr>
                    : adStats.map((row, i) => (
                      <tr key={row.adName}
                        style={{ borderBottom: i < adStats.length-1 ? "1px solid rgba(255,255,255,0.04)" : "none", transition: "background 0.15s" }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                        <td className="px-5 py-4 font-medium text-white">{row.adName}</td>
                        <td className="px-5 py-4">
                          {syncingFb && row.spend === 0
                            ? <div className="h-4 w-14 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
                            : row.spend > 0
                              ? <span className="flex items-center gap-2">
                                  <span className="font-semibold text-white">{fmtMoney(row.spend)}</span>
                                  {row.fromFacebook && <span className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded-md"
                                    style={{ color: "#60a5fa", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.15)" }}>FB</span>}
                                </span>
                              : <span style={{ color: "rgba(255,255,255,0.12)" }}>—</span>}
                        </td>
                        <td className="px-5 py-4" style={{ color: "rgba(255,255,255,0.6)" }}>{row.leads}</td>
                        <td className="px-5 py-4 font-semibold" style={{ color: "#34d399" }}>{row.sales}</td>
                        <td className="px-5 py-4" style={{ color: "rgba(255,255,255,0.4)" }}>
                          {row.conv > 0 ? `${row.conv.toFixed(1)}%` : <span style={{ color: "rgba(255,255,255,0.1)" }}>—</span>}
                        </td>
                        <td className="px-5 py-4 font-semibold" style={{ color: "#a78bfa" }}>
                          {row.cac > 0 ? fmtMoney(row.cac) : <span style={{ color: "rgba(255,255,255,0.1)", fontWeight: 400 }}>—</span>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {loadingData
              ? [...Array(3)].map((_, i) => (
                  <div key={i} className="rounded-2xl p-4 space-y-3"
                    style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="skeleton h-4 w-40 rounded" />
                    <div className="grid grid-cols-4 gap-2">
                      {[...Array(4)].map((_, j) => <div key={j} className="skeleton h-10 rounded-lg" />)}
                    </div>
                  </div>
                ))
              : adStats.length === 0
                ? <p className="text-center py-10 text-sm" style={{ color: "rgba(255,255,255,0.15)" }}>No ad data for this period.</p>
                : adStats.map(row => (
                    <div key={row.adName} className="rounded-2xl p-4"
                      style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-semibold text-white text-sm truncate max-w-[180px]">{row.adName}</p>
                        <div className="flex items-center gap-1.5">
                          {row.fromFacebook && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md"
                            style={{ color: "#60a5fa", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.15)" }}>FB</span>}
                          {row.spend > 0 && <span className="text-sm font-bold text-white">{fmtMoney(row.spend)}</span>}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: "Leads", value: row.leads.toString(),                           color: "rgba(255,255,255,0.6)" },
                          { label: "Sales", value: row.sales.toString(),                           color: "#34d399" },
                          { label: "Conv",  value: row.conv > 0 ? `${row.conv.toFixed(1)}%` : "—", color: "rgba(255,255,255,0.4)" },
                          { label: "CAC",   value: row.cac  > 0 ? fmtMoney(row.cac)          : "—", color: "#a78bfa" },
                        ].map(cell => (
                          <div key={cell.label} className="rounded-xl p-2.5 text-center"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                            <p className="text-[9px] font-semibold tracking-widest uppercase mb-1" style={{ color: "rgba(255,255,255,0.2)" }}>{cell.label}</p>
                            <p className="text-sm font-bold" style={{ color: cell.color }}>{cell.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
          </div>
        </section>

        {/* ── Leads Table ──────────────────────────────────────────────────── */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Leads</h2>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
                {rangeLeads.length} total · {rangeSales.length} sold · {rangeLeads.length - rangeSales.length} open
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex p-1 gap-0.5 rounded-xl" style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
                {(["all","open","sold"] as LeadFilter[]).map(f => (
                  <button key={f} onClick={() => setLeadFilter(f)} className="px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-all"
                    style={leadFilter === f ? { background: "rgba(255,255,255,0.08)", color: "#fff" } : { color: "rgba(255,255,255,0.25)" }}>
                    {f}
                  </button>
                ))}
              </div>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2" width={12} height={12} fill="none"
                  viewBox="0 0 24 24" stroke="rgba(255,255,255,0.2)" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-2 text-xs rounded-xl w-36 sm:w-44 outline-none"
                  style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)", color: "#fff" }} />
              </div>
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block rounded-2xl overflow-hidden relative"
            style={{ background: "#111", border: `1px solid ${loadingData ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)"}`, transition: "border-color 0.4s" }}>
            {loadingData && (
              <div className="absolute top-0 left-0 right-0 h-[2px] overflow-hidden z-10">
                <div style={{
                  position: "absolute", top: 0, bottom: 0, width: "35%",
                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)",
                  animation: "scan 1.6s ease-in-out infinite",
                }} />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    {["Name","Email","Phone","Ad Name","Source","Date","Status"].map(h => (
                      <th key={h} className="text-left px-5 py-3" style={hdrStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingData ? [...Array(5)].map((_, i) => <SkeletonRow key={i} cols={7} />)
                  : filteredLeads.length === 0
                    ? <tr><td colSpan={7} className="px-5 py-16 text-center text-sm" style={{ color: "rgba(255,255,255,0.1)" }}>
                        {search ? `No leads matching "${search}"` : "No leads for this period."}
                      </td></tr>
                    : filteredLeads.map((lead, i) => {
                        const sold = soldEmails.has(lead.email);
                        return (
                          <tr key={lead.id}
                            style={{ borderBottom: i < filteredLeads.length-1 ? "1px solid rgba(255,255,255,0.04)" : "none", transition: "background 0.15s" }}
                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"}
                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                            <td className="px-5 py-3.5 font-medium text-white whitespace-nowrap">{lead.first_name}</td>
                            <td className="px-5 py-3.5 whitespace-nowrap" style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>{lead.email}</td>
                            <td className="px-5 py-3.5 whitespace-nowrap" style={{ color: "rgba(255,255,255,0.25)", fontSize: 12 }}>{lead.phone || "—"}</td>
                            <td className="px-5 py-3.5 max-w-[160px]">
                              <span className="block truncate text-xs" title={lead.ad_name} style={{ color: "rgba(255,255,255,0.5)" }}>
                                {lead.ad_name || <span style={{ color: "rgba(255,255,255,0.1)" }}>Unknown</span>}
                              </span>
                            </td>
                            <td className="px-5 py-3.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                                style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.06)" }}>
                                {lead.source}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 whitespace-nowrap" style={{ color: "rgba(255,255,255,0.2)", fontSize: 12 }}>{fmtDate(lead.created_at)}</td>
                            <td className="px-5 py-3.5">
                              {sold
                                ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                                    style={{ color: "#34d399", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.15)" }}>
                                    <svg width={6} height={6} viewBox="0 0 6 6" fill="#34d399"><circle cx="3" cy="3" r="3" /></svg> Sold
                                  </span>
                                : <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                                    style={{ color: "#fbbf24", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.15)" }}>
                                    <svg width={6} height={6} viewBox="0 0 6 6" fill="#fbbf24"><circle cx="3" cy="3" r="3" /></svg> Open
                                  </span>}
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
            {filteredLeads.length > 0 && (
              <div className="px-5 py-3 text-[11px]" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.15)" }}>
                Showing {filteredLeads.length} of {rangeLeads.length} leads
              </div>
            )}
          </div>

          {/* Mobile lead cards */}
          <div className="sm:hidden space-y-2">
            {loadingData
              ? [...Array(4)].map((_, i) => (
                  <div key={i} className="rounded-2xl p-4"
                    style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="flex justify-between mb-2">
                      <div className="skeleton h-4 w-28 rounded" />
                      <div className="skeleton h-5 w-14 rounded-full" />
                    </div>
                    <div className="skeleton h-3 w-44 rounded mt-2" />
                  </div>
                ))
              : filteredLeads.length === 0
                ? <p className="text-center py-10 text-sm" style={{ color: "rgba(255,255,255,0.15)" }}>
                    {search ? `No leads matching "${search}"` : "No leads for this period."}
                  </p>
                : filteredLeads.map(lead => {
                    const sold = soldEmails.has(lead.email);
                    return (
                      <div key={lead.id} className="rounded-2xl p-4"
                        style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-white text-sm truncate">{lead.first_name}</p>
                            <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.35)" }}>{lead.email}</p>
                          </div>
                          {sold
                            ? <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                                style={{ color: "#34d399", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.15)" }}>
                                <svg width={6} height={6} viewBox="0 0 6 6" fill="#34d399"><circle cx="3" cy="3" r="3" /></svg> Sold
                              </span>
                            : <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                                style={{ color: "#fbbf24", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.15)" }}>
                                <svg width={6} height={6} viewBox="0 0 6 6" fill="#fbbf24"><circle cx="3" cy="3" r="3" /></svg> Open
                              </span>}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-2">
                          {lead.ad_name && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full truncate max-w-[160px]"
                              style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.15)" }}>
                              {lead.ad_name}
                            </span>
                          )}
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                            style={{ color: "rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.05)" }}>{lead.source}</span>
                          <span className="text-[11px] ml-auto" style={{ color: "rgba(255,255,255,0.2)" }}>{fmtDate(lead.created_at)}</span>
                        </div>
                      </div>
                    );
                  })}
            {filteredLeads.length > 0 && (
              <p className="text-center text-[11px] pt-1 pb-2" style={{ color: "rgba(255,255,255,0.12)" }}>
                {filteredLeads.length} of {rangeLeads.length} leads
              </p>
            )}
          </div>
        </section>

        <footer className="text-center text-[11px] pb-6" style={{ color: "rgba(255,255,255,0.08)" }}>
          Leads from GoHighLevel · Sales via Slack · Spend & metrics from Facebook Ads Manager
        </footer>
      </main>
    </div>
  );
}
