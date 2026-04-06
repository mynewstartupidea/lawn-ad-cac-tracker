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

type FilterType = "all" | "open" | "sold";

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtMoney(n: number) {
  if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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
    <svg
      style={{ width: size, height: size }}
      className="animate-spin text-current"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  icon,
  gradient,
  glow,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  gradient: string;
  glow: string;
  loading?: boolean;
}) {
  return (
    <div
      className="relative rounded-2xl border overflow-hidden p-6 flex flex-col gap-4"
      style={{
        background: "linear-gradient(135deg, #141414 0%, #0f0f0f 100%)",
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      {/* Subtle gradient overlay */}
      <div className={`absolute inset-0 opacity-[0.03] ${gradient}`} />

      {/* Icon */}
      <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center ${glow}`}>
        {icon}
      </div>

      {/* Value */}
      <div className="relative">
        <p className="text-[11px] font-semibold tracking-widest text-white/30 uppercase mb-1">{label}</p>
        {loading ? (
          <div className="h-8 w-20 rounded-lg animate-pulse bg-white/5" />
        ) : (
          <p className="text-[28px] font-bold text-white leading-none tracking-tight">{value}</p>
        )}
        {sub && !loading && <p className="text-[11px] text-white/25 mt-2">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {[...Array(cols)].map((_, i) => (
        <td key={i} className="px-5 py-4">
          <div
            className="h-3.5 rounded animate-pulse bg-white/5"
            style={{ width: `${45 + Math.floor(Math.random() * 45)}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [adSpends, setAdSpends] = useState<Record<string, { spend: number; source: "manual" | "facebook" }>>({});

  const [loadingData, setLoadingData] = useState(true);
  const [syncingFb, setSyncingFb] = useState(false);
  const [fbError, setFbError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [relTime, setRelTime] = useState("");

  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");

  // Relative time ticker
  useEffect(() => {
    if (!lastSynced) return;
    setRelTime(relativeTime(lastSynced));
    const id = setInterval(() => setRelTime(relativeTime(lastSynced)), 15_000);
    return () => clearInterval(id);
  }, [lastSynced]);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchSupabase = useCallback(async () => {
    const [leadsRes, salesRes, spendsRes] = await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("sales").select("*").order("created_at", { ascending: false }),
      supabase.from("ad_spends").select("*"),
    ]);

    if (!leadsRes.error) setLeads(leadsRes.data ?? []);
    if (!salesRes.error) setSales(salesRes.data ?? []);

    if (!spendsRes.error && spendsRes.data) {
      const map: Record<string, { spend: number; source: "manual" | "facebook" }> = {};
      for (const s of spendsRes.data as AdSpendRecord[]) {
        map[s.ad_name] = { spend: s.spend, source: s.source };
      }
      setAdSpends(map);
    }
  }, []);

  const syncFacebook = useCallback(async () => {
    setSyncingFb(true);
    setFbError(null);
    try {
      const res = await fetch("/api/facebook-spend");
      const data = await res.json();
      if (data.error) {
        setFbError(data.error);
      } else {
        const map: Record<string, { spend: number; source: "manual" | "facebook" }> = {};
        for (const [adName, spend] of Object.entries(data.spends as Record<string, number>)) {
          map[adName] = { spend, source: "facebook" };
        }
        setAdSpends((prev) => ({ ...prev, ...map }));
        setLastSynced(new Date());
      }
    } catch {
      setFbError("Could not reach Facebook API — check your env vars.");
    } finally {
      setSyncingFb(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoadingData(true);
      await fetchSupabase();
      setLoadingData(false);
      syncFacebook();
    })();
  }, [fetchSupabase, syncFacebook]);

  const refresh = useCallback(async () => {
    setLoadingData(true);
    await fetchSupabase();
    setLoadingData(false);
    syncFacebook();
  }, [fetchSupabase, syncFacebook]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const soldEmails = useMemo(() => new Set(sales.map((s) => s.email)), [sales]);

  const adStats = useMemo(() => {
    const stats: Record<string, { leads: number; sales: number }> = {};
    for (const lead of leads) {
      const key = lead.ad_name || "Unknown Ad";
      if (!stats[key]) stats[key] = { leads: 0, sales: 0 };
      stats[key].leads++;
      if (soldEmails.has(lead.email)) stats[key].sales++;
    }
    return Object.entries(stats)
      .map(([adName, s]) => ({
        adName,
        leads: s.leads,
        sales: s.sales,
        spend: adSpends[adName]?.spend ?? 0,
        fromFacebook: adSpends[adName]?.source === "facebook",
      }))
      .sort((a, b) => b.leads - a.leads);
  }, [leads, soldEmails, adSpends]);

  const totals = useMemo(() => {
    const spend = adStats.reduce((s, a) => s + a.spend, 0);
    const sold = sales.length;
    const total = leads.length;
    return {
      leads: total,
      sales: sold,
      spend,
      cac: sold > 0 && spend > 0 ? spend / sold : null,
      conversion: total > 0 ? (sold / total) * 100 : null,
    };
  }, [adStats, sales.length, leads.length]);

  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (filter === "open" && soldEmails.has(l.email)) return false;
      if (filter === "sold" && !soldEmails.has(l.email)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          l.first_name?.toLowerCase().includes(q) ||
          l.email?.toLowerCase().includes(q) ||
          l.ad_name?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [leads, filter, search, soldEmails]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: "#0a0a0a", minHeight: "100vh", color: "#fafafa" }}>

      {/* ── Topbar ──────────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between px-6 h-14"
        style={{
          background: "rgba(10,10,10,0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
            style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
          >
            🌿
          </div>
          <span className="text-sm font-semibold text-white">Lawn CAC Tracker</span>
          <span
            className="hidden sm:block text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.3)" }}
          >
            dashboard
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Sync status */}
          <div className="hidden sm:flex items-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
            {syncingFb ? (
              <span className="flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                <Spinner size={12} /> Syncing Facebook…
              </span>
            ) : lastSynced ? (
              <span>FB synced {relTime}</span>
            ) : fbError ? (
              <span style={{ color: "#f59e0b" }}>⚠ FB not connected</span>
            ) : null}
          </div>

          {/* Refresh */}
          <button
            onClick={refresh}
            disabled={loadingData || syncingFb}
            className="flex items-center gap-1.5 text-xs font-medium transition-all"
            style={{
              color: "rgba(255,255,255,0.4)",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: "6px 12px",
              cursor: loadingData || syncingFb ? "not-allowed" : "pointer",
              opacity: loadingData || syncingFb ? 0.4 : 1,
            }}
          >
            {loadingData ? <Spinner size={12} /> : (
              <svg width={12} height={12} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* ── FB not configured banner ─────────────────────────────────────── */}
        {fbError && (
          <div
            className="flex items-start gap-3 rounded-xl px-5 py-4 text-sm"
            style={{
              background: "rgba(245,158,11,0.06)",
              border: "1px solid rgba(245,158,11,0.15)",
            }}
          >
            <span style={{ color: "#f59e0b", marginTop: 1 }}>⚠</span>
            <div>
              <p className="font-medium" style={{ color: "#f59e0b" }}>Facebook Ads not connected</p>
              <p className="text-xs mt-0.5" style={{ color: "rgba(245,158,11,0.5)" }}>
                Add <code style={{ background: "rgba(245,158,11,0.1)", padding: "1px 5px", borderRadius: 4 }}>FACEBOOK_ACCESS_TOKEN</code> and{" "}
                <code style={{ background: "rgba(245,158,11,0.1)", padding: "1px 5px", borderRadius: 4 }}>FACEBOOK_AD_ACCOUNT_ID</code> to your{" "}
                <code style={{ background: "rgba(245,158,11,0.1)", padding: "1px 5px", borderRadius: 4 }}>.env.local</code> to automatically pull spend data.
              </p>
            </div>
          </div>
        )}

        {/* ── Metric Cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetricCard
            label="Total Leads"
            value={loadingData ? "—" : totals.leads.toString()}
            sub="from GoHighLevel"
            gradient="bg-gradient-to-br from-blue-600 to-blue-400"
            glow="bg-blue-500/10"
            icon={
              <svg width={18} height={18} fill="none" viewBox="0 0 24 24" stroke="#3b82f6" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
            loading={loadingData}
          />
          <MetricCard
            label="Sales Closed"
            value={loadingData ? "—" : totals.sales.toString()}
            sub="via Slack → sold"
            gradient="bg-gradient-to-br from-emerald-600 to-emerald-400"
            glow="bg-emerald-500/10"
            icon={
              <svg width={18} height={18} fill="none" viewBox="0 0 24 24" stroke="#10b981" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            loading={loadingData}
          />
          <MetricCard
            label="Ad Spend"
            value={syncingFb && totals.spend === 0 ? "Syncing…" : totals.spend > 0 ? fmtMoney(totals.spend) : "—"}
            sub="from Facebook Ads"
            gradient="bg-gradient-to-br from-orange-600 to-orange-400"
            glow="bg-orange-500/10"
            icon={
              <svg width={18} height={18} fill="none" viewBox="0 0 24 24" stroke="#f97316" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            loading={syncingFb && totals.spend === 0}
          />
          <MetricCard
            label="Avg CAC"
            value={syncingFb && !totals.cac ? "Syncing…" : totals.cac ? fmtMoney(totals.cac) : "—"}
            sub={totals.cac ? "cost per sale" : "spend ÷ sales"}
            gradient="bg-gradient-to-br from-violet-600 to-violet-400"
            glow="bg-violet-500/10"
            icon={
              <svg width={18} height={18} fill="none" viewBox="0 0 24 24" stroke="#8b5cf6" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            }
            loading={syncingFb && totals.spend === 0}
          />
          <MetricCard
            label="Conv. Rate"
            value={loadingData ? "—" : totals.conversion !== null ? `${totals.conversion.toFixed(1)}%` : "—"}
            sub="leads → closed"
            gradient="bg-gradient-to-br from-cyan-600 to-cyan-400"
            glow="bg-cyan-500/10"
            icon={
              <svg width={18} height={18} fill="none" viewBox="0 0 24 24" stroke="#06b6d4" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            }
            loading={loadingData}
          />
        </div>

        {/* ── Ad Performance Table ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Ad Performance</h2>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
                Spend pulled automatically from Facebook Ads Manager · CAC calculated per ad
              </p>
            </div>
            {syncingFb && (
              <span className="flex items-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
                <Spinner size={11} /> Fetching spend…
              </span>
            )}
          </div>

          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "#111111", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    {["Ad Name", "Spend", "Leads", "Sales", "Conv %", "CAC"].map((h) => (
                      <th
                        key={h}
                        className="text-left px-5 py-3"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: "rgba(255,255,255,0.2)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingData ? (
                    [...Array(3)].map((_, i) => <SkeletonRow key={i} cols={6} />)
                  ) : adStats.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-16 text-center text-sm"
                        style={{ color: "rgba(255,255,255,0.1)" }}
                      >
                        No ad data yet. Leads from GoHighLevel will appear here.
                      </td>
                    </tr>
                  ) : (
                    adStats.map((row, i) => {
                      const conv = row.leads > 0 ? (row.sales / row.leads) * 100 : null;
                      const cac = row.sales > 0 && row.spend > 0 ? row.spend / row.sales : null;
                      const isLast = i === adStats.length - 1;
                      return (
                        <tr
                          key={row.adName}
                          style={{
                            borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)",
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)")}
                          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                        >
                          <td className="px-5 py-4 font-medium text-white">{row.adName}</td>
                          <td className="px-5 py-4">
                            {syncingFb && row.spend === 0 ? (
                              <div className="h-4 w-14 rounded animate-pulse bg-white/5" />
                            ) : row.spend > 0 ? (
                              <span className="flex items-center gap-2">
                                <span className="font-semibold text-white">{fmtMoney(row.spend)}</span>
                                {row.fromFacebook && (
                                  <span
                                    className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded-md"
                                    style={{
                                      color: "#60a5fa",
                                      background: "rgba(59,130,246,0.1)",
                                      border: "1px solid rgba(59,130,246,0.15)",
                                    }}
                                  >
                                    FB
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span style={{ color: "rgba(255,255,255,0.12)" }}>—</span>
                            )}
                          </td>
                          <td className="px-5 py-4" style={{ color: "rgba(255,255,255,0.6)" }}>{row.leads}</td>
                          <td className="px-5 py-4 font-semibold" style={{ color: "#34d399" }}>{row.sales}</td>
                          <td className="px-5 py-4" style={{ color: "rgba(255,255,255,0.4)" }}>
                            {conv !== null ? `${conv.toFixed(1)}%` : <span style={{ color: "rgba(255,255,255,0.1)" }}>—</span>}
                          </td>
                          <td className="px-5 py-4 font-semibold" style={{ color: "#a78bfa" }}>
                            {cac !== null ? fmtMoney(cac) : <span style={{ color: "rgba(255,255,255,0.1)", fontWeight: 400 }}>—</span>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Leads Table ──────────────────────────────────────────────────── */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Leads</h2>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
                {leads.length} total · {sales.length} sold · {leads.length - sales.length} open
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Filter tabs */}
              <div
                className="flex p-1 gap-0.5 rounded-xl"
                style={{ background: "#111", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                {(["all", "open", "sold"] as FilterType[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-all"
                    style={
                      filter === f
                        ? { background: "rgba(255,255,255,0.08)", color: "#fff" }
                        : { color: "rgba(255,255,255,0.25)" }
                    }
                  >
                    {f}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2"
                  width={12}
                  height={12}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search leads…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-2 text-xs rounded-xl w-40 outline-none transition-all"
                  style={{
                    background: "#111",
                    border: "1px solid rgba(255,255,255,0.06)",
                    color: "#fff",
                  }}
                />
              </div>
            </div>
          </div>

          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "#111111", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    {["Name", "Email", "Phone", "Ad Name", "Source", "Date", "Status"].map((h) => (
                      <th
                        key={h}
                        className="text-left px-5 py-3"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: "rgba(255,255,255,0.2)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingData ? (
                    [...Array(5)].map((_, i) => <SkeletonRow key={i} cols={7} />)
                  ) : filteredLeads.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-5 py-16 text-center text-sm"
                        style={{ color: "rgba(255,255,255,0.1)" }}
                      >
                        {search ? `No leads matching "${search}"` : "No leads yet."}
                      </td>
                    </tr>
                  ) : (
                    filteredLeads.map((lead, i) => {
                      const sold = soldEmails.has(lead.email);
                      const isLast = i === filteredLeads.length - 1;
                      return (
                        <tr
                          key={lead.id}
                          style={{
                            borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)",
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)")}
                          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                        >
                          <td className="px-5 py-3.5 font-medium text-white whitespace-nowrap">
                            {lead.first_name}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap" style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}>
                            {lead.email}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap" style={{ color: "rgba(255,255,255,0.25)", fontSize: 12 }}>
                            {lead.phone || "—"}
                          </td>
                          <td className="px-5 py-3.5 max-w-[180px]">
                            <span
                              title={lead.ad_name}
                              className="block truncate text-xs"
                              style={{ color: "rgba(255,255,255,0.5)" }}
                            >
                              {lead.ad_name || <span style={{ color: "rgba(255,255,255,0.1)" }}>Unknown</span>}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                              style={{
                                color: "rgba(255,255,255,0.3)",
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.06)",
                              }}
                            >
                              {lead.source}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap" style={{ color: "rgba(255,255,255,0.2)", fontSize: 12 }}>
                            {fmtDate(lead.created_at)}
                          </td>
                          <td className="px-5 py-3.5">
                            {sold ? (
                              <span
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
                                style={{
                                  color: "#34d399",
                                  background: "rgba(52,211,153,0.08)",
                                  border: "1px solid rgba(52,211,153,0.15)",
                                }}
                              >
                                <svg width={8} height={8} viewBox="0 0 8 8" fill="#34d399">
                                  <circle cx="4" cy="4" r="4" />
                                </svg>
                                Sold
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                                style={{
                                  color: "#fbbf24",
                                  background: "rgba(251,191,36,0.08)",
                                  border: "1px solid rgba(251,191,36,0.15)",
                                }}
                              >
                                <svg width={8} height={8} viewBox="0 0 8 8" fill="#fbbf24">
                                  <circle cx="4" cy="4" r="4" />
                                </svg>
                                Open
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {filteredLeads.length > 0 && (
              <div
                className="px-5 py-3 text-[11px]"
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.15)",
                }}
              >
                Showing {filteredLeads.length} of {leads.length} leads
              </div>
            )}
          </div>
        </section>

        <footer className="text-center text-[11px] pb-6" style={{ color: "rgba(255,255,255,0.1)" }}>
          Leads auto-captured from GoHighLevel · Sales marked via Slack · Spend synced from Facebook Ads Manager
        </footer>
      </main>
    </div>
  );
}
