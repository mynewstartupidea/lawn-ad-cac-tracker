"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import GameArena from "./GameArena";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type BotDifficulty = "easy" | "medium" | "hard";

type LobbyPhase = "home" | "invited" | "waiting" | "playing";

interface PlayerInfo {
  id: string;
  name: string;
  role: "p1" | "p2";
}

function genRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
function genPlayerId() {
  return Math.random().toString(36).slice(2, 14);
}

const G = {
  bg:           "linear-gradient(135deg, #0f0c29 0%, #1e1040 50%, #16082a 100%)",
  card:         "rgba(255,255,255,0.06)",
  cardBorder:   "rgba(255,255,255,0.11)",
  gold:         "#f59e0b",
  purple:       "#8b5cf6",
  blue:         "#3b82f6",
  green:        "#10b981",
  red:          "#ef4444",
  orange:       "#f97316",
  text:         "#f1f5f9",
  muted:        "rgba(241,245,249,0.5)",
};

const DIFF_CFG: Record<BotDifficulty, { label: string; desc: string; emoji: string; col: string }> = {
  easy:   { label: "Easy",   desc: "Slow & random",       emoji: "🌿", col: G.green  },
  medium: { label: "Medium", desc: "Balanced tactics",    emoji: "⚔️", col: G.blue   },
  hard:   { label: "Hard",   desc: "Aggressive counter",  emoji: "💀", col: G.red    },
};

export default function GameHub({ initialRoom }: { initialRoom?: string }) {
  // If arriving via shared link, show the "invited" screen directly
  const [phase, setPhase] = useState<LobbyPhase>(initialRoom ? "invited" : "home");
  const [roomId, setRoomId]       = useState(initialRoom ?? "");
  const [joinInput, setJoinInput] = useState(initialRoom ?? "");
  const [nameInput, setNameInput] = useState("");
  const [myInfo, setMyInfo]       = useState<PlayerInfo | null>(null);
  const [oppInfo, setOppInfo]     = useState<PlayerInfo | null>(null);
  const [channel, setChannel]     = useState<RealtimeChannel | null>(null);
  const [botDiff, setBotDiff]     = useState<BotDifficulty | null>(null);
  const [error, setError]         = useState("");
  const [copyDone, setCopyDone]   = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const shareUrl = typeof window !== "undefined"
    ? `${window.location.origin}/game?room=${roomId}`
    : `/game?room=${roomId}`;

  // ─── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (channel) supabase.removeChannel(channel);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [channel]);

  // ─── Start countdown helper ──────────────────────────────────────────────────
  const startCountdown = useCallback((then: () => void) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    let c = 3;
    setCountdown(c);
    countdownRef.current = setInterval(() => {
      c--;
      if (c <= 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        setCountdown(null);
        then();
      } else {
        setCountdown(c);
      }
    }, 1000);
  }, []);

  // ─── Setup Supabase channel ──────────────────────────────────────────────────
  const setupChannel = useCallback((room: string, me: PlayerInfo) => {
    const ch = supabase.channel(`realm-rush:${room}`, {
      config: { presence: { key: me.id } },
    });

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ name: string; role: "p1" | "p2"; id: string }>();
      const others = Object.values(state).flat().filter(p => p.id !== me.id);
      if (others.length > 0) {
        const opp = others[0];
        setOppInfo({ id: opp.id, name: opp.name, role: opp.role });
      } else {
        setOppInfo(null);
      }
    });

    // P2 receives game_start from P1 and begins countdown
    ch.on("broadcast", { event: "game_start" }, ({ payload }) => {
      if (payload.p1Id && payload.p2Id && me.role === "p2") {
        startCountdown(() => setPhase("playing"));
      }
    });

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ id: me.id, name: me.name, role: me.role });
      }
    });

    setChannel(ch);
    return ch;
  }, [startCountdown]);

  // ─── P1: when P2 joins, fire game_start and begin countdown ──────────────────
  const oppIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!channel || !myInfo || myInfo.role !== "p1" || !oppInfo) return;
    if (oppIdRef.current === oppInfo.id) return; // already handled
    oppIdRef.current = oppInfo.id;

    channel.send({
      type: "broadcast",
      event: "game_start",
      payload: { p1Id: myInfo.id, p2Id: oppInfo.id, p1Name: myInfo.name, p2Name: oppInfo.name },
    });
    startCountdown(() => setPhase("playing"));
  }, [channel, myInfo, oppInfo, startCountdown]);

  // ─── Actions ────────────────────────────────────────────────────────────────
  function handleCreate() {
    const name = nameInput.trim();
    if (!name) { setError("Enter your warrior name first"); return; }
    const id = genPlayerId(), room = genRoomId();
    const me: PlayerInfo = { id, name, role: "p1" };
    setMyInfo(me); setRoomId(room); setError("");
    setPhase("waiting");
    setupChannel(room, me);
  }

  function handleJoin(overrideRoom?: string) {
    const name = nameInput.trim();
    const room = (overrideRoom ?? joinInput).trim().toUpperCase();
    if (!name) { setError("Enter your warrior name first"); return; }
    if (!room)  { setError("Enter the room code"); return; }
    const id = genPlayerId();
    const me: PlayerInfo = { id, name, role: "p2" };
    setMyInfo(me); setRoomId(room); setError("");
    setPhase("waiting");
    setupChannel(room, me);
  }

  function handlePlayBot(diff: BotDifficulty) {
    const name = nameInput.trim();
    if (!name) { setError("Enter your warrior name first"); return; }
    const id = genPlayerId();
    const me: PlayerInfo = { id, name, role: "p1" };
    setMyInfo(me); setBotDiff(diff); setError("");
    startCountdown(() => setPhase("playing"));
  }

  function handleLeave() {
    if (channel) { supabase.removeChannel(channel); setChannel(null); }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setMyInfo(null); setOppInfo(null); setBotDiff(null);
    setPhase("home"); setRoomId(""); setJoinInput(""); setCountdown(null);
    oppIdRef.current = null;
  }

  function copyLink() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopyDone(true); setTimeout(() => setCopyDone(false), 2000);
    });
  }

  // ─── Playing ─────────────────────────────────────────────────────────────────
  if (phase === "playing" && myInfo) {
    return (
      <GameArena
        roomId={roomId}
        myInfo={myInfo}
        channel={channel}
        botDifficulty={botDiff ?? undefined}
        onLeave={handleLeave}
      />
    );
  }

  // ─── Countdown overlay ───────────────────────────────────────────────────────
  const showCountdown = countdown !== null;

  return (
    <div style={{
      minHeight: "100vh", background: G.bg,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "24px 16px", fontFamily: "'Geist Sans', system-ui, sans-serif",
      position: "relative", overflow: "hidden",
    }}>
      <style>{`
        @keyframes twinkle  { 0%,100%{opacity:.08} 50%{opacity:.55} }
        @keyframes float    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        @keyframes pulse-ring { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(1.8);opacity:0} }
        @keyframes cdpop { 0%{transform:scale(.4);opacity:0} 60%{transform:scale(1.2)} 100%{transform:scale(1);opacity:1} }
        @keyframes slide-in { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* Stars */}
      <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0 }}>
        {Array.from({length:70}).map((_,i) => (
          <div key={i} style={{
            position:"absolute", borderRadius:"50%", background:"white",
            width: Math.random()*2+1, height: Math.random()*2+1,
            opacity: Math.random()*.5+.05,
            left:`${Math.random()*100}%`, top:`${Math.random()*100}%`,
            animation:`twinkle ${Math.random()*4+2}s ease-in-out infinite`,
            animationDelay:`${Math.random()*5}s`,
          }}/>
        ))}
      </div>

      {/* Countdown fullscreen */}
      {showCountdown && (
        <div style={{
          position:"fixed", inset:0, zIndex:200,
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          background:"rgba(0,0,0,0.75)", backdropFilter:"blur(10px)",
        }}>
          <div style={{ color: G.muted, fontSize:18, marginBottom:12, letterSpacing:"0.1em" }}>
            BATTLE STARTS IN
          </div>
          <div key={countdown} style={{
            fontSize: 130, fontWeight:900, color: G.gold,
            animation:"cdpop .85s ease forwards",
            textShadow:`0 0 80px ${G.gold}, 0 0 30px ${G.gold}`,
            lineHeight:1,
          }}>
            {countdown}
          </div>
          {botDiff && (
            <div style={{ color: DIFF_CFG[botDiff].col, fontSize:16, marginTop:16, fontWeight:600 }}>
              vs {DIFF_CFG[botDiff].emoji} {DIFF_CFG[botDiff].label} AI
            </div>
          )}
          {oppInfo && (
            <div style={{ color: G.muted, fontSize:15, marginTop:12 }}>
              ⚔️ &nbsp;
              <span style={{color:G.gold,fontWeight:700}}>{myInfo?.name}</span>
              &nbsp;vs&nbsp;
              <span style={{color:G.purple,fontWeight:700}}>{oppInfo.name}</span>
            </div>
          )}
        </div>
      )}

      {/* ─── Invited screen (P2 joining via link) ─────────────────────────── */}
      {phase === "invited" && (
        <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:420, animation:"slide-in .4s ease" }}>
          <div style={{ textAlign:"center", marginBottom:28 }}>
            <div style={{ fontSize:56, animation:"float 3s ease-in-out infinite" }}>⚔️</div>
            <h1 style={{
              fontSize:32, fontWeight:900, margin:"8px 0 4px", letterSpacing:"-0.02em",
              background:`linear-gradient(135deg,${G.gold},${G.purple})`,
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            }}>Realm Rush</h1>
            <p style={{ color:G.muted, fontSize:13, margin:0 }}>You've been invited to battle!</p>
          </div>

          <div style={{
            background:G.card, border:`1px solid ${G.cardBorder}`,
            borderRadius:20, padding:"28px 24px", backdropFilter:"blur(16px)",
          }}>
            {/* Room badge */}
            <div style={{
              background:"rgba(245,158,11,0.12)", border:`1px solid rgba(245,158,11,0.35)`,
              borderRadius:12, padding:"12px 16px", marginBottom:20, textAlign:"center",
            }}>
              <div style={{ color:G.muted, fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:4 }}>
                Battle Room
              </div>
              <div style={{ color:G.gold, fontSize:30, fontWeight:900, letterSpacing:"0.2em" }}>
                {initialRoom}
              </div>
            </div>

            <label style={{ color:G.muted, fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>
              Your warrior name
            </label>
            <input
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleJoin(initialRoom)}
              placeholder="Enter your name…"
              autoFocus
              style={{
                width:"100%", marginTop:8, marginBottom:16, padding:"12px 16px",
                background:"rgba(255,255,255,0.07)", border:`1px solid ${G.cardBorder}`,
                borderRadius:12, color:G.text, fontSize:15, outline:"none", boxSizing:"border-box",
              }}
              onFocus={e => (e.target.style.borderColor = G.purple)}
              onBlur={e => (e.target.style.borderColor = G.cardBorder)}
            />

            {error && <p style={{ color:G.red, fontSize:13, margin:"0 0 12px", textAlign:"center" }}>{error}</p>}

            <button
              onClick={() => handleJoin(initialRoom)}
              style={{
                width:"100%", padding:"14px", borderRadius:14, border:"none",
                background:`linear-gradient(135deg, ${G.purple}, ${G.blue})`,
                color:"white", fontSize:16, fontWeight:700, cursor:"pointer",
                boxShadow:`0 6px 28px rgba(139,92,246,0.45)`,
              }}
            >
              ⚔️ &nbsp;Join the Battle
            </button>
          </div>
        </div>
      )}

      {/* ─── Home screen ──────────────────────────────────────────────────── */}
      {phase === "home" && (
        <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:440, animation:"slide-in .35s ease" }}>
          {/* Logo */}
          <div style={{ textAlign:"center", marginBottom:28 }}>
            <div style={{ fontSize:60, animation:"float 3s ease-in-out infinite" }}>⚔️</div>
            <h1 style={{
              fontSize:36, fontWeight:900, margin:"8px 0 4px", letterSpacing:"-0.02em",
              background:`linear-gradient(135deg,${G.gold},${G.purple})`,
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            }}>Realm Rush</h1>
            <p style={{ color:G.muted, fontSize:13, margin:0 }}>Real-time 1v1 strategy battle</p>
          </div>

          <div style={{
            background:G.card, border:`1px solid ${G.cardBorder}`,
            borderRadius:20, padding:"24px 22px", backdropFilter:"blur(16px)",
          }}>
            {/* Name input */}
            <label style={{ color:G.muted, fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>
              Your warrior name
            </label>
            <input
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
              placeholder="Enter your name…"
              autoFocus
              style={{
                width:"100%", marginTop:8, marginBottom:18, padding:"12px 16px",
                background:"rgba(255,255,255,0.06)", border:`1px solid ${G.cardBorder}`,
                borderRadius:12, color:G.text, fontSize:15, outline:"none", boxSizing:"border-box",
              }}
              onFocus={e => (e.target.style.borderColor = G.purple)}
              onBlur={e => (e.target.style.borderColor = G.cardBorder)}
            />

            {error && <p style={{ color:G.red, fontSize:13, margin:"0 0 14px", textAlign:"center" }}>{error}</p>}

            {/* ── Play vs Friend ── */}
            <div style={{ color:G.muted, fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>
              ⚡ Play vs Friend
            </div>

            <button
              onClick={handleCreate}
              style={{
                width:"100%", padding:"13px", borderRadius:13, border:"none",
                background:`linear-gradient(135deg,${G.purple},${G.blue})`,
                color:"white", fontSize:15, fontWeight:700, cursor:"pointer",
                marginBottom:10, boxShadow:`0 4px 22px rgba(139,92,246,0.38)`,
                transition:"transform .1s,box-shadow .1s",
              }}
              onMouseEnter={e => { e.currentTarget.style.transform="translateY(-1px)"; e.currentTarget.style.boxShadow=`0 8px 28px rgba(139,92,246,0.5)`; }}
              onMouseLeave={e => { e.currentTarget.style.transform=""; e.currentTarget.style.boxShadow=`0 4px 22px rgba(139,92,246,0.38)`; }}
            >
              🛡️ &nbsp;Create Battle Room
            </button>

            <div style={{ display:"flex", gap:8, marginBottom:18 }}>
              <input
                value={joinInput}
                onChange={e => setJoinInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && handleJoin()}
                placeholder="Room code (e.g. AB12CD)"
                style={{
                  flex:1, padding:"11px 13px",
                  background:"rgba(255,255,255,0.05)", border:`1px solid ${G.cardBorder}`,
                  borderRadius:11, color:G.text, fontSize:13, outline:"none",
                  letterSpacing:"0.1em", textTransform:"uppercase",
                }}
                onFocus={e => (e.target.style.borderColor = G.green)}
                onBlur={e => (e.target.style.borderColor = G.cardBorder)}
              />
              <button
                onClick={() => handleJoin()}
                style={{
                  padding:"11px 18px", borderRadius:11,
                  border:`1px solid ${G.green}`, background:"rgba(16,185,129,0.14)",
                  color:G.green, fontSize:13, fontWeight:700, cursor:"pointer",
                  transition:"background .15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background="rgba(16,185,129,0.26)")}
                onMouseLeave={e => (e.currentTarget.style.background="rgba(16,185,129,0.14)")}
              >
                Join
              </button>
            </div>

            {/* ── Play vs Computer ── */}
            <div style={{
              borderTop:`1px solid ${G.cardBorder}`, paddingTop:18, marginTop:2,
            }}>
              <div style={{ color:G.muted, fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>
                🤖 Play vs Computer
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                {(Object.entries(DIFF_CFG) as [BotDifficulty, typeof DIFF_CFG[BotDifficulty]][]).map(([diff, cfg]) => (
                  <button
                    key={diff}
                    onClick={() => handlePlayBot(diff)}
                    style={{
                      padding:"12px 8px", borderRadius:12,
                      border:`1.5px solid ${cfg.col}44`,
                      background:`${cfg.col}11`,
                      color:cfg.col, cursor:"pointer",
                      display:"flex", flexDirection:"column", alignItems:"center", gap:4,
                      transition:"all .15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background=`${cfg.col}22`; e.currentTarget.style.borderColor=`${cfg.col}88`; e.currentTarget.style.transform="translateY(-2px)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background=`${cfg.col}11`; e.currentTarget.style.borderColor=`${cfg.col}44`; e.currentTarget.style.transform=""; }}
                  >
                    <span style={{ fontSize:22 }}>{cfg.emoji}</span>
                    <span style={{ fontSize:12, fontWeight:700 }}>{cfg.label}</span>
                    <span style={{ fontSize:9, opacity:.7, textAlign:"center" }}>{cfg.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Feature grid */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:12 }}>
            {[
              { icon:"⚡", h:"Real-time",    s:"Supabase-powered" },
              { icon:"🤖", h:"AI Opponents", s:"3 difficulty levels" },
              { icon:"🐉", h:"8 Unique Cards",s:"Dragons to Fireballs" },
              { icon:"📱", h:"Mobile Ready", s:"Touch & tap to deploy" },
            ].map(f => (
              <div key={f.h} style={{
                background:G.card, border:`1px solid ${G.cardBorder}`,
                borderRadius:10, padding:"10px 12px", backdropFilter:"blur(10px)",
              }}>
                <div style={{ fontSize:18 }}>{f.icon}</div>
                <div style={{ color:G.text, fontSize:11, fontWeight:600, marginTop:4 }}>{f.h}</div>
                <div style={{ color:G.muted, fontSize:10 }}>{f.s}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Waiting screen (after creating room, P1 waits) ────────────────── */}
      {phase === "waiting" && myInfo && (
        <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:420, animation:"slide-in .4s ease" }}>
          <div style={{ textAlign:"center", marginBottom:24 }}>
            <div style={{ fontSize:52 }}>⚔️</div>
            <h2 style={{ color:G.text, fontSize:24, fontWeight:800, margin:"8px 0 4px" }}>
              {myInfo.role === "p1" ? "Waiting for opponent…" : "Joining room…"}
            </h2>
          </div>
          <div style={{
            background:G.card, border:`1px solid ${G.cardBorder}`,
            borderRadius:20, padding:"28px 24px", backdropFilter:"blur(16px)", textAlign:"center",
          }}>
            {!oppInfo ? (
              <>
                {/* Pulse ring */}
                <div style={{ position:"relative", display:"inline-block", margin:"0 auto 24px" }}>
                  <div style={{
                    width:72, height:72, borderRadius:"50%",
                    background:`linear-gradient(135deg,${G.purple},${G.blue})`,
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:32,
                  }}>🛡️</div>
                  <div style={{
                    position:"absolute", inset:-4, borderRadius:"50%",
                    border:`2px solid ${G.purple}`, animation:"pulse-ring 1.5s ease-out infinite",
                  }}/>
                </div>

                <p style={{ color:G.muted, fontSize:14, margin:"0 0 24px" }}>
                  Share this invite link with your friend
                </p>

                {/* Share URL */}
                <div style={{
                  background:"rgba(0,0,0,0.35)", borderRadius:11, padding:"12px 14px",
                  marginBottom:10, textAlign:"left",
                }}>
                  <div style={{ color:G.muted, fontSize:9, fontWeight:700, letterSpacing:".1em", textTransform:"uppercase", marginBottom:5 }}>
                    Invite link
                  </div>
                  <div style={{
                    color:G.gold, fontSize:12, fontFamily:"monospace",
                    wordBreak:"break-all", lineHeight:1.5,
                  }}>{shareUrl}</div>
                </div>

                <button
                  onClick={copyLink}
                  style={{
                    width:"100%", padding:"13px", borderRadius:12, border:"none",
                    background: copyDone ? "rgba(16,185,129,0.18)" : `linear-gradient(135deg,${G.gold},${G.orange})`,
                    color: copyDone ? G.green : "#000",
                    fontSize:14, fontWeight:700, cursor:"pointer", marginBottom:10, transition:"all .2s",
                  }}
                >
                  {copyDone ? "✅ Copied!" : "📋 Copy Invite Link"}
                </button>

                {/* Room code */}
                <div style={{
                  background:"rgba(245,158,11,0.1)", border:`1px solid rgba(245,158,11,0.3)`,
                  borderRadius:10, padding:"10px 14px", marginBottom:16,
                }}>
                  <div style={{ color:G.muted, fontSize:10, marginBottom:3 }}>Room Code</div>
                  <div style={{ color:G.gold, fontSize:30, fontWeight:900, letterSpacing:".22em" }}>{roomId}</div>
                </div>

                <button
                  onClick={handleLeave}
                  style={{
                    width:"100%", padding:"10px", borderRadius:10,
                    border:`1px solid ${G.cardBorder}`, background:"transparent",
                    color:G.muted, fontSize:13, cursor:"pointer",
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize:52, marginBottom:16 }}>⚔️</div>
                <h2 style={{ color:G.text, fontSize:22, fontWeight:800, margin:"0 0 8px" }}>Opponent Found!</h2>
                <p style={{ color:G.muted, fontSize:14, margin:"0 0 20px" }}>
                  <span style={{color:G.gold,fontWeight:700}}>{myInfo.name}</span>
                  {" vs "}
                  <span style={{color:G.purple,fontWeight:700}}>{oppInfo.name}</span>
                </p>
                <div style={{ color:G.green, fontSize:15, fontWeight:600 }}>⚡ Starting battle…</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
