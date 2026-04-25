"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import GameArena from "./GameArena";
import type { RealtimeChannel } from "@supabase/supabase-js";

type LobbyPhase = "home" | "creating" | "waiting" | "joining" | "playing";

interface PlayerInfo {
  id: string;
  name: string;
  role: "p1" | "p2";
}

function genRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function genPlayerId() {
  return Math.random().toString(36).slice(2, 14);
}

const G = {
  bg: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
  card: "rgba(255,255,255,0.07)",
  cardBorder: "rgba(255,255,255,0.12)",
  gold: "#f59e0b",
  goldGlow: "#fbbf24",
  purple: "#8b5cf6",
  blue: "#3b82f6",
  green: "#10b981",
  red: "#ef4444",
  text: "#f1f5f9",
  textMuted: "rgba(241,245,249,0.55)",
};

export default function GameHub({ initialRoom }: { initialRoom?: string }) {
  const [phase, setPhase] = useState<LobbyPhase>(initialRoom ? "joining" : "home");
  const [roomId, setRoomId] = useState(initialRoom ?? "");
  const [joinInput, setJoinInput] = useState(initialRoom ?? "");
  const [playerName, setPlayerName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [myInfo, setMyInfo] = useState<PlayerInfo | null>(null);
  const [oppInfo, setOppInfo] = useState<PlayerInfo | null>(null);
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);
  const [error, setError] = useState("");
  const [copyDone, setCopyDone] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const shareUrl = typeof window !== "undefined"
    ? `${window.location.origin}/game?room=${roomId}`
    : `/game?room=${roomId}`;

  // ─── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [channel]);

  // ─── Setup channel ──────────────────────────────────────────────────────────
  const setupChannel = useCallback((room: string, me: PlayerInfo) => {
    const ch = supabase.channel(`realm-rush:${room}`, {
      config: { presence: { key: me.id } },
    });

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ name: string; role: "p1" | "p2"; id: string }>();
      const others = Object.values(state)
        .flat()
        .filter(p => p.id !== me.id);
      if (others.length > 0) {
        const opp = others[0];
        setOppInfo({ id: opp.id, name: opp.name, role: opp.role });
      } else {
        setOppInfo(null);
      }
    });

    ch.on("broadcast", { event: "game_start" }, ({ payload }) => {
      if (payload.p1Id && payload.p2Id) {
        // Countdown then start
        let c = 3;
        setCountdown(c);
        const iv = setInterval(() => {
          c--;
          if (c <= 0) { clearInterval(iv); setCountdown(null); setPhase("playing"); }
          else setCountdown(c);
        }, 1000);
      }
    });

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ id: me.id, name: me.name, role: me.role });
      }
    });

    setChannel(ch);
    return ch;
  }, []);

  // ─── P1 watches for P2, then fires game_start ────────────────────────────────
  useEffect(() => {
    if (!channel || !myInfo || myInfo.role !== "p1") return;
    if (!oppInfo) return;

    // Both present → fire game_start
    channel.send({
      type: "broadcast",
      event: "game_start",
      payload: { p1Id: myInfo.id, p2Id: oppInfo.id, p1Name: myInfo.name, p2Name: oppInfo.name },
    });

    let c = 3;
    setCountdown(c);
    const iv = setInterval(() => {
      c--;
      if (c <= 0) { clearInterval(iv); setCountdown(null); setPhase("playing"); }
      else setCountdown(c);
    }, 1000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppInfo?.id]);

  // ─── Create room ─────────────────────────────────────────────────────────────
  function handleCreate() {
    if (!nameInput.trim()) { setError("Enter your name first"); return; }
    const name = nameInput.trim();
    const id = genPlayerId();
    const room = genRoomId();
    const me: PlayerInfo = { id, name, role: "p1" };
    setPlayerName(name);
    setRoomId(room);
    setMyInfo(me);
    setError("");
    setPhase("waiting");
    setupChannel(room, me);
  }

  // ─── Join room ────────────────────────────────────────────────────────────────
  function handleJoin() {
    const room = joinInput.trim().toUpperCase();
    if (!room) { setError("Enter room code"); return; }
    if (!nameInput.trim()) { setError("Enter your name first"); return; }
    const name = nameInput.trim();
    const id = genPlayerId();
    const me: PlayerInfo = { id, name, role: "p2" };
    setPlayerName(name);
    setRoomId(room);
    setMyInfo(me);
    setError("");
    setPhase("waiting");
    setupChannel(room, me);
  }

  function copyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    });
  }

  // ─── Playing phase ────────────────────────────────────────────────────────────
  if (phase === "playing" && myInfo && channel) {
    return (
      <GameArena
        roomId={roomId}
        myInfo={myInfo}
        channel={channel}
        onLeave={() => {
          supabase.removeChannel(channel);
          setChannel(null);
          setMyInfo(null);
          setOppInfo(null);
          setPhase("home");
          setRoomId("");
        }}
      />
    );
  }

  // ─── UI ───────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh", background: G.bg, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "24px 16px",
      fontFamily: "'Geist Sans', system-ui, sans-serif",
    }}>
      {/* Stars background */}
      <div style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
        {Array.from({ length: 60 }).map((_, i) => (
          <div key={i} style={{
            position: "absolute",
            width: Math.random() * 2 + 1,
            height: Math.random() * 2 + 1,
            borderRadius: "50%",
            background: "white",
            opacity: Math.random() * 0.6 + 0.1,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animation: `twinkle ${Math.random() * 3 + 2}s ease-in-out infinite`,
            animationDelay: `${Math.random() * 4}s`,
          }} />
        ))}
      </div>

      <style>{`
        @keyframes twinkle { 0%,100%{opacity:.1} 50%{opacity:.7} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes pulse-ring { 0%{transform:scale(1);opacity:1} 100%{transform:scale(1.6);opacity:0} }
        @keyframes countdown-pop { 0%{transform:scale(0.5);opacity:0} 60%{transform:scale(1.2)} 100%{transform:scale(1);opacity:1} }
      `}</style>

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 440 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 64, animation: "float 3s ease-in-out infinite" }}>⚔️</div>
          <h1 style={{
            fontSize: 36, fontWeight: 900, color: G.text, margin: "8px 0 4px",
            letterSpacing: "-0.02em",
            background: `linear-gradient(135deg, ${G.gold}, ${G.purple})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            Realm Rush
          </h1>
          <p style={{ color: G.textMuted, fontSize: 14, margin: 0 }}>
            Real-time 1v1 strategy battle
          </p>
        </div>

        {/* ─── Countdown overlay ─────────────────────────────────────────── */}
        {countdown !== null && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 100,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
          }}>
            <div style={{
              fontSize: 120, fontWeight: 900, color: G.gold,
              animation: "countdown-pop 0.9s ease forwards",
              textShadow: `0 0 60px ${G.gold}`,
            }}>
              {countdown}
            </div>
          </div>
        )}

        {/* ─── Home ──────────────────────────────────────────────────────── */}
        {phase === "home" && (
          <div style={{
            background: G.card, border: `1px solid ${G.cardBorder}`,
            borderRadius: 20, padding: "28px 28px", backdropFilter: "blur(16px)",
          }}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ color: G.textMuted, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Your name
              </label>
              <input
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
                placeholder="Enter your warrior name…"
                style={{
                  width: "100%", marginTop: 8, padding: "12px 16px",
                  background: "rgba(255,255,255,0.06)", border: `1px solid ${G.cardBorder}`,
                  borderRadius: 12, color: G.text, fontSize: 15, outline: "none",
                  boxSizing: "border-box",
                  transition: "border-color 0.2s",
                }}
                onFocus={e => (e.target.style.borderColor = G.purple)}
                onBlur={e => (e.target.style.borderColor = G.cardBorder)}
              />
            </div>

            {error && (
              <p style={{ color: G.red, fontSize: 13, margin: "0 0 16px", textAlign: "center" }}>{error}</p>
            )}

            <button
              onClick={handleCreate}
              style={{
                width: "100%", padding: "14px", borderRadius: 14, border: "none",
                background: `linear-gradient(135deg, ${G.purple}, ${G.blue})`,
                color: "white", fontSize: 16, fontWeight: 700, cursor: "pointer",
                marginBottom: 12, letterSpacing: "-0.01em",
                boxShadow: `0 4px 24px rgba(139,92,246,0.4)`,
                transition: "transform 0.1s, box-shadow 0.1s",
              }}
              onMouseEnter={e => { (e.currentTarget.style.transform = "translateY(-1px)"); (e.currentTarget.style.boxShadow = `0 8px 32px rgba(139,92,246,0.5)`); }}
              onMouseLeave={e => { (e.currentTarget.style.transform = ""); (e.currentTarget.style.boxShadow = `0 4px 24px rgba(139,92,246,0.4)`); }}
            >
              ⚔️ &nbsp;Create New Battle Room
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 16px" }}>
              <div style={{ flex: 1, height: 1, background: G.cardBorder }} />
              <span style={{ color: G.textMuted, fontSize: 12 }}>or join a friend</span>
              <div style={{ flex: 1, height: 1, background: G.cardBorder }} />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={joinInput}
                onChange={e => setJoinInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && handleJoin()}
                placeholder="Room code (e.g. AB12CD)"
                style={{
                  flex: 1, padding: "12px 14px",
                  background: "rgba(255,255,255,0.06)", border: `1px solid ${G.cardBorder}`,
                  borderRadius: 12, color: G.text, fontSize: 14, outline: "none",
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  transition: "border-color 0.2s",
                }}
                onFocus={e => (e.target.style.borderColor = G.green)}
                onBlur={e => (e.target.style.borderColor = G.cardBorder)}
              />
              <button
                onClick={handleJoin}
                style={{
                  padding: "12px 20px", borderRadius: 12, border: `1px solid ${G.green}`,
                  background: "rgba(16,185,129,0.15)", color: G.green,
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(16,185,129,0.25)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(16,185,129,0.15)")}
              >
                Join
              </button>
            </div>

            {/* Feature highlights */}
            <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { icon: "⚡", label: "Real-time", sub: "Low latency battles" },
                { icon: "📱", label: "Mobile Ready", sub: "Touch & drag cards" },
                { icon: "🏆", label: "8 Cards", sub: "Knights to Dragons" },
                { icon: "🌍", label: "Play Anywhere", sub: "Share a link" },
              ].map(f => (
                <div key={f.label} style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 10,
                  padding: "10px 12px", border: `1px solid ${G.cardBorder}`,
                }}>
                  <div style={{ fontSize: 20 }}>{f.icon}</div>
                  <div style={{ color: G.text, fontSize: 12, fontWeight: 600, marginTop: 4 }}>{f.label}</div>
                  <div style={{ color: G.textMuted, fontSize: 11, marginTop: 2 }}>{f.sub}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Waiting for opponent ─────────────────────────────────────────── */}
        {phase === "waiting" && myInfo && (
          <div style={{
            background: G.card, border: `1px solid ${G.cardBorder}`,
            borderRadius: 20, padding: "32px 28px", backdropFilter: "blur(16px)",
            textAlign: "center",
          }}>
            {!oppInfo ? (
              <>
                <div style={{ position: "relative", display: "inline-block", marginBottom: 24 }}>
                  <div style={{
                    width: 72, height: 72, borderRadius: "50%",
                    background: `linear-gradient(135deg, ${G.purple}, ${G.blue})`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 32, margin: "0 auto",
                  }}>
                    {myInfo.role === "p1" ? "🛡️" : "⚔️"}
                  </div>
                  <div style={{
                    position: "absolute", inset: -4, borderRadius: "50%",
                    border: `2px solid ${G.purple}`, animation: "pulse-ring 1.5s ease-out infinite",
                  }} />
                </div>
                <h2 style={{ color: G.text, fontSize: 22, fontWeight: 800, margin: "0 0 6px" }}>
                  Waiting for opponent…
                </h2>
                <p style={{ color: G.textMuted, fontSize: 14, margin: "0 0 28px" }}>
                  Share this link with your friend to start the battle
                </p>

                <div style={{
                  background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: "14px 16px",
                  marginBottom: 12, wordBreak: "break-all", textAlign: "left",
                }}>
                  <div style={{ color: G.textMuted, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
                    Battle invite link
                  </div>
                  <div style={{ color: G.gold, fontSize: 13, fontFamily: "monospace" }}>{shareUrl}</div>
                </div>

                <button
                  onClick={copyLink}
                  style={{
                    width: "100%", padding: "13px", borderRadius: 12, border: "none",
                    background: copyDone
                      ? "rgba(16,185,129,0.2)"
                      : `linear-gradient(135deg, ${G.gold}, #f97316)`,
                    color: copyDone ? G.green : "#000",
                    fontSize: 15, fontWeight: 700, cursor: "pointer",
                    marginBottom: 10, transition: "all 0.2s",
                  }}
                >
                  {copyDone ? "✅ Copied!" : "📋 Copy Invite Link"}
                </button>

                <div style={{
                  background: "rgba(245,158,11,0.1)", border: `1px solid rgba(245,158,11,0.3)`,
                  borderRadius: 10, padding: "10px 14px", marginBottom: 16,
                }}>
                  <div style={{ color: G.textMuted, fontSize: 11, marginBottom: 4 }}>Room Code</div>
                  <div style={{ color: G.gold, fontSize: 28, fontWeight: 900, letterSpacing: "0.2em" }}>{roomId}</div>
                </div>

                <button
                  onClick={() => { if (channel) supabase.removeChannel(channel); setChannel(null); setPhase("home"); setRoomId(""); setMyInfo(null); }}
                  style={{
                    width: "100%", padding: "10px", borderRadius: 10, border: `1px solid ${G.cardBorder}`,
                    background: "transparent", color: G.textMuted, fontSize: 13, cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 52, marginBottom: 16 }}>⚔️</div>
                <h2 style={{ color: G.text, fontSize: 22, fontWeight: 800, margin: "0 0 8px" }}>
                  Opponent Found!
                </h2>
                <p style={{ color: G.textMuted, fontSize: 14, margin: "0 0 20px" }}>
                  <span style={{ color: G.gold, fontWeight: 700 }}>{myInfo.name}</span>
                  {" vs "}
                  <span style={{ color: G.purple, fontWeight: 700 }}>{oppInfo.name}</span>
                </p>
                <div style={{ color: G.green, fontSize: 15, fontWeight: 600 }}>
                  ⚡ Starting battle…
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
