"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

export default function Home() {
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [allSales, setAllSales] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [adName, setAdName] = useState("Facebook Ad 1");
  const [adSpendMap, setAdSpendMap] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchLeads();
    fetchSales();
  }, []);

  const fetchLeads = async () => {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.log(error);
    } else {
      setAllLeads(data || []);
    }
  };

  const fetchSales = async () => {
    const { data, error } = await supabase
      .from("sales")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.log(error);
    } else {
      setAllSales(data || []);
    }
  };

  const saveLead = async () => {
    const { error } = await supabase.from("leads").insert([
      {
        email,
        first_name: name,
        phone,
        ad_name: adName,
        source: "facebook",
      },
    ]);

    if (error) {
      console.log(error);
      alert("Error saving lead");
    } else {
      alert("Lead saved!");
      setEmail("");
      setName("");
      setPhone("");
      fetchLeads();
    }
  };

  const markAsSold = async (leadEmail: string) => {
    const { error } = await supabase.from("sales").insert([
      {
        email: leadEmail,
        status: "sold",
      },
    ]);

    if (error) {
      console.log(error);
      alert("Error saving sale");
    } else {
      alert("Sale saved!");
      fetchSales();
    }
  };

  const isSold = (leadEmail: string) => {
    return allSales.some((sale) => sale.email === leadEmail);
  };

  const adStats = useMemo(() => {
    const stats: Record<
      string,
      {
        adName: string;
        leads: number;
        sales: number;
      }
    > = {};

    allLeads.forEach((lead) => {
      const key = lead.ad_name || "Unknown Ad";
      if (!stats[key]) {
        stats[key] = {
          adName: key,
          leads: 0,
          sales: 0,
        };
      }
      stats[key].leads += 1;
    });

    allLeads.forEach((lead) => {
      const key = lead.ad_name || "Unknown Ad";
      if (isSold(lead.email) && stats[key]) {
        stats[key].sales += 1;
      }
    });

    return Object.values(stats);
  }, [allLeads, allSales]);

  const totalLeads = allLeads.length;
  const totalSales = allSales.length;
  const totalSpend = adStats.reduce((sum, row) => {
    return sum + (Number(adSpendMap[row.adName]) || 0);
  }, 0);
  const totalCAC = totalSales > 0 ? (totalSpend / totalSales).toFixed(2) : "0.00";
  const totalConversion =
    totalLeads > 0 ? ((totalSales / totalLeads) * 100).toFixed(1) : "0";

  return (
    <main style={{ padding: "40px", fontFamily: "Arial" }}>
      <h1 style={{ fontSize: "36px", fontWeight: "bold", marginBottom: "30px" }}>
        Lawn CAC Dashboard 🚀
      </h1>

      <div style={{ display: "flex", gap: "20px", marginBottom: "20px", flexWrap: "wrap" }}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
        />

        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />

        <input
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          style={inputStyle}
        />

        <input
          placeholder="Ad Name"
          value={adName}
          onChange={(e) => setAdName(e.target.value)}
          style={inputStyle}
        />
      </div>

      <button
        onClick={saveLead}
        style={{
          marginBottom: "30px",
          padding: "12px 18px",
          cursor: "pointer",
          borderRadius: "8px",
          border: "none",
          background: "#111",
          color: "#fff",
        }}
      >
        Save Lead
      </button>

      <div style={{ display: "flex", gap: "20px", marginBottom: "40px", flexWrap: "wrap" }}>
        <Card title="Total Leads" value={totalLeads} />
        <Card title="Total Sales" value={totalSales} />
        <Card title="Total Spend" value={`$${totalSpend}`} />
        <Card title="Total CAC" value={`$${totalCAC}`} />
        <Card title="Conversion %" value={`${totalConversion}%`} />
      </div>

      <h2 style={{ fontSize: "24px", marginBottom: "16px" }}>Ad Performance</h2>

      <div style={{ overflowX: "auto", marginBottom: "40px" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            background: "#fff",
            border: "1px solid #ddd",
          }}
        >
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={thStyle}>Ad Name</th>
              <th style={thStyle}>Spend</th>
              <th style={thStyle}>Leads</th>
              <th style={thStyle}>Sales</th>
              <th style={thStyle}>Conversion %</th>
              <th style={thStyle}>CAC</th>
            </tr>
          </thead>
          <tbody>
            {adStats.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "16px", textAlign: "center" }}>
                  No ad data yet
                </td>
              </tr>
            ) : (
              adStats.map((row) => {
                const spend = Number(adSpendMap[row.adName]) || 0;
                const conversion =
                  row.leads > 0 ? ((row.sales / row.leads) * 100).toFixed(1) : "0";
                const cac = row.sales > 0 ? (spend / row.sales).toFixed(2) : "0.00";

                return (
                  <tr key={row.adName}>
                    <td style={tdStyle}>{row.adName}</td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        value={adSpendMap[row.adName] || ""}
                        onChange={(e) =>
                          setAdSpendMap((prev) => ({
                            ...prev,
                            [row.adName]: e.target.value,
                          }))
                        }
                        placeholder="Enter spend"
                        style={{ ...inputStyle, width: "140px" }}
                      />
                    </td>
                    <td style={tdStyle}>{row.leads}</td>
                    <td style={tdStyle}>{row.sales}</td>
                    <td style={tdStyle}>{conversion}%</td>
                    <td style={tdStyle}>${cac}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: "24px", marginBottom: "16px" }}>Recent Leads</h2>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            background: "#fff",
            border: "1px solid #ddd",
          }}
        >
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Phone</th>
              <th style={thStyle}>Ad Name</th>
              <th style={thStyle}>Source</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {allLeads.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "16px", textAlign: "center" }}>
                  No leads yet
                </td>
              </tr>
            ) : (
              allLeads.map((lead) => (
                <tr key={lead.id}>
                  <td style={tdStyle}>{lead.first_name}</td>
                  <td style={tdStyle}>{lead.email}</td>
                  <td style={tdStyle}>{lead.phone}</td>
                  <td style={tdStyle}>{lead.ad_name}</td>
                  <td style={tdStyle}>{lead.source}</td>
                  <td style={tdStyle}>{isSold(lead.email) ? "Sold" : "Open"}</td>
                  <td style={tdStyle}>
                    {isSold(lead.email) ? (
                      "Done"
                    ) : (
                      <button
                        onClick={() => markAsSold(lead.email)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "6px",
                          border: "none",
                          background: "green",
                          color: "white",
                          cursor: "pointer",
                        }}
                      >
                        Mark Sold
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Card({ title, value }: any) {
  return (
    <div
      style={{
        padding: "20px",
        background: "#f5f5f5",
        borderRadius: "10px",
        minWidth: "120px",
      }}
    >
      <div style={{ fontSize: "14px", color: "#555" }}>{title}</div>
      <div style={{ fontSize: "22px", fontWeight: "bold" }}>{value}</div>
    </div>
  );
}

const inputStyle = {
  padding: "12px",
  fontSize: "16px",
  width: "180px",
  borderRadius: "8px",
  border: "1px solid #ccc",
};

const thStyle = {
  textAlign: "left" as const,
  padding: "12px",
  borderBottom: "1px solid #ddd",
};

const tdStyle = {
  padding: "12px",
  borderBottom: "1px solid #eee",
};