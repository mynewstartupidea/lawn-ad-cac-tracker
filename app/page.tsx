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
}

type FilterType = "all" | "open" | "sold";
type Toast = { message: string; type: "success" | "error" } | null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color = "text-gray-900",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-1">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Home() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [adSpends, setAdSpends] = useState<Record<string, { spend: number; source: "manual" | "facebook" }>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ name: "", email: "", phone: "", adName: "" });
  const [submitting, setSubmitting] = useState(false);
  const saveTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── Toast ────────────────────────────────────────────────────────────────────

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Data fetching ─────────────────────────────────────────────────────────────

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);

    const [leadsRes, salesRes, spendsRes] = await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("sales").select("*").order("created_at", { ascending: false }),
      fetch("/api/ad-spends").then((r) => r.json()).catch(() => ({ spends: [] })),
    ]);

    if (!leadsRes.error) setLeads(leadsRes.data || []);
    if (!salesRes.error) setSales(salesRes.data || []);

    if (spendsRes.spends) {
      const map: Record<string, { spend: number; source: "manual" | "facebook" }> = {};
      for (const s of spendsRes.spends as AdSpendRecord[]) {
        map[s.ad_name] = { spend: s.spend, source: s.source };
      }
      setAdSpends(map);
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Derived state ─────────────────────────────────────────────────────────────

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
        spendSource: (adSpends[adName]?.source ?? "unset") as "manual" | "facebook" | "unset",
      }))
      .sort((a, b) => b.leads - a.leads);
  }, [leads, soldEmails, adSpends]);

  const totals = useMemo(() => {
    const totalSpend = adStats.reduce((sum, a) => sum + a.spend, 0);
    const totalSales = sales.length;
    const totalLeads = leads.length;
    return {
      leads: totalLeads,
      sales: totalSales,
      spend: totalSpend,
      cac: totalSales > 0 && totalSpend > 0 ? totalSpend / totalSales : null,
      conversion: totalLeads > 0 ? (totalSales / totalLeads) * 100 : null,
    };
  }, [adStats, sales.length, leads.length]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (filter === "open" && soldEmails.has(lead.email)) return false;
      if (filter === "sold" && !soldEmails.has(lead.email)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          lead.first_name?.toLowerCase().includes(q) ||
          lead.email?.toLowerCase().includes(q) ||
          lead.ad_name?.toLowerCase().includes(q) ||
          lead.phone?.includes(q)
        );
      }
      return true;
    });
  }, [leads, filter, search, soldEmails]);

  // ── Actions ───────────────────────────────────────────────────────────────────

  const handleSpendChange = (adName: string, value: string) => {
    const num = parseFloat(value) || 0;
    setAdSpends((prev) => ({ ...prev, [adName]: { spend: num, source: "manual" } }));

    if (saveTimeouts.current[adName]) clearTimeout(saveTimeouts.current[adName]);
    saveTimeouts.current[adName] = setTimeout(async () => {
      setSaving((prev) => ({ ...prev, [adName]: true }));
      await fetch("/api/ad-spends", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_name: adName, spend: num }),
      });
      setSaving((prev) => ({ ...prev, [adName]: false }));
    }, 800);
  };

  const syncFacebook = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/facebook-spend");
      const data = await res.json();
      if (data.error) {
        showToast(data.error, "error");
      } else {
        const map: Record<string, { spend: number; source: "manual" | "facebook" }> = {};
        for (const [adName, spend] of Object.entries(data.spends as Record<string, number>)) {
          map[adName] = { spend, source: "facebook" };
        }
        setAdSpends((prev) => ({ ...prev, ...map }));
        showToast(`Synced ${data.count} ad(s) from Facebook`, "success");
      }
    } catch {
      showToast("Failed to connect to Facebook API", "error");
    } finally {
      setSyncing(false);
    }
  };

  const saveLead = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      showToast("Name and email are required", "error");
      return;
    }
    const email = form.email.toLowerCase().trim();
    setSubmitting(true);

    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      showToast("A lead with this email already exists", "error");
      setSubmitting(false);
      return;
    }

    const { error } = await supabase.from("leads").insert([{
      first_name: form.name.trim(),
      email,
      phone: form.phone.trim(),
      ad_name: form.adName.trim() || "Manual",
      source: "manual",
    }]);

    if (error) {
      showToast("Error saving lead", "error");
    } else {
      showToast("Lead saved!", "success");
      setForm({ name: "", email: "", phone: "", adName: "" });
      setShowModal(false);
      fetchData(true);
    }
    setSubmitting(false);
  };

  const markAsSold = async (email: string) => {
    const { error } = await supabase.from("sales").insert([{ email, status: "sold" }]);
    if (error) {
      showToast("Error marking as sold", "error");
    } else {
      showToast("Marked as sold!", "success");
      setSales((prev) => [
        ...prev,
        { id: Date.now().toString(), email, status: "sold", created_at: new Date().toISOString() },
      ]);
    }
  };

  // ── Loading screen ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ─────────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-600 rounded-xl flex items-center justify-center text-white text-lg font-bold">
              🌿
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900 leading-tight">Lawn CAC Tracker</h1>
              <p className="text-xs text-gray-400">Customer Acquisition Cost Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              title="Refresh data"
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
            >
              <svg className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={syncFacebook}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-xl transition-colors disabled:opacity-50"
            >
              {syncing ? (
                <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              )}
              Sync Facebook
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Lead
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* ── Stat Cards ──────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard label="Total Leads" value={totals.leads.toString()} color="text-gray-900" />
          <StatCard
            label="Total Sales"
            value={totals.sales.toString()}
            sub={totals.conversion !== null ? `${totals.conversion.toFixed(1)}% conversion` : undefined}
            color="text-emerald-600"
          />
          <StatCard label="Total Spend" value={fmt(totals.spend)} color="text-gray-900" />
          <StatCard
            label="Avg CAC"
            value={totals.cac !== null ? fmt(totals.cac) : "—"}
            sub={totals.cac !== null ? "per customer" : "add spend to calculate"}
            color="text-blue-600"
          />
          <StatCard
            label="Conversion Rate"
            value={totals.conversion !== null ? `${totals.conversion.toFixed(1)}%` : "—"}
            color="text-purple-600"
          />
        </div>

        {/* ── Ad Performance ──────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Ad Performance</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Type spend manually (auto-saved) or use <strong>Sync Facebook</strong> to pull from Ads Manager
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {["Ad Name", "Spend", "Leads", "Sales", "Conv %", "CAC"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {adStats.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-14 text-center text-gray-300 text-sm">
                      No ads yet. Leads will appear here as they arrive from GoHighLevel.
                    </td>
                  </tr>
                ) : (
                  adStats.map((row) => {
                    const conv = row.leads > 0 ? (row.sales / row.leads) * 100 : null;
                    const cac = row.sales > 0 && row.spend > 0 ? row.spend / row.sales : null;
                    return (
                      <tr key={row.adName} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 font-medium text-gray-800 max-w-[200px] truncate">
                          {row.adName}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 text-sm">$</span>
                            <input
                              type="number"
                              value={row.spend || ""}
                              onChange={(e) => handleSpendChange(row.adName, e.target.value)}
                              placeholder="0"
                              min="0"
                              className="w-28 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
                            />
                            {row.spendSource === "facebook" && (
                              <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md">FB</span>
                            )}
                            {saving[row.adName] && (
                              <span className="w-3.5 h-3.5 border-2 border-gray-300 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-700">{row.leads}</td>
                        <td className="px-6 py-4 font-semibold text-emerald-600">{row.sales}</td>
                        <td className="px-6 py-4 text-gray-700">
                          {conv !== null ? `${conv.toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-6 py-4 font-semibold text-blue-600">
                          {cac !== null ? fmt(cac) : <span className="text-gray-300 font-normal">—</span>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Leads Table ─────────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-gray-900">Leads</h2>
              <p className="text-xs text-gray-400 mt-0.5">{leads.length} total · {sales.length} sold · {leads.length - sales.length} open</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex bg-gray-100 rounded-xl p-0.5 gap-0.5">
                {(["all", "open", "sold"] as FilterType[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all capitalize ${
                      filter === f
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search leads…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-xl w-44 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {["Name", "Email", "Phone", "Ad", "Source", "Date", "Status", ""].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-6 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLeads.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-14 text-center text-gray-300 text-sm">
                      {search ? `No leads match "${search}"` : "No leads yet."}
                    </td>
                  </tr>
                ) : (
                  filteredLeads.map((lead) => {
                    const sold = soldEmails.has(lead.email);
                    return (
                      <tr key={lead.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3.5 font-medium text-gray-900">{lead.first_name}</td>
                        <td className="px-6 py-3.5 text-gray-500">{lead.email}</td>
                        <td className="px-6 py-3.5 text-gray-500">{lead.phone || "—"}</td>
                        <td className="px-6 py-3.5 text-gray-600 max-w-[160px] truncate" title={lead.ad_name}>
                          {lead.ad_name}
                        </td>
                        <td className="px-6 py-3.5">
                          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full uppercase">
                            {lead.source}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-gray-400 text-xs">{fmtDate(lead.created_at)}</td>
                        <td className="px-6 py-3.5">
                          {sold ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              Sold
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
                              Open
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3.5">
                          {!sold && (
                            <button
                              onClick={() => markAsSold(lead.email)}
                              className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 hover:underline transition-colors"
                            >
                              Mark Sold
                            </button>
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
            <div className="px-6 py-3 border-t border-gray-50 text-xs text-gray-400">
              Showing {filteredLeads.length} of {leads.length} leads
            </div>
          )}
        </div>
      </main>

      {/* ── Add Lead Modal ───────────────────────────────────────────────────────── */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={(e) => e.target === e.currentTarget && setShowModal(false)}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900">Add Manual Lead</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              {[
                { label: "Full Name *", key: "name", placeholder: "John Doe", type: "text" },
                { label: "Email *", key: "email", placeholder: "john@example.com", type: "email" },
                { label: "Phone", key: "phone", placeholder: "(555) 000-0000", type: "tel" },
                { label: "Ad Name", key: "adName", placeholder: "Summer Lawn Ad", type: "text" },
              ].map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">{field.label}</label>
                  <input
                    type={field.type}
                    value={form[field.key as keyof typeof form]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    onKeyDown={(e) => e.key === "Enter" && saveLead()}
                    className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
                  />
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveLead}
                disabled={submitting}
                className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Save Lead"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ───────────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl text-sm font-semibold z-50 animate-in slide-in-from-bottom-2 ${
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          <span className="text-base">{toast.type === "success" ? "✓" : "!"}</span>
          {toast.message}
        </div>
      )}
    </div>
  );
}
