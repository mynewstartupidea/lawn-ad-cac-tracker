"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  initGameState, tickGame, countTowers,
  CW, CH, RIVER_Y, BRIDGE_XS, MATCH_MS, OT_MS, ELIXIR_MAX,
  type GameState, type GameEvent, type PlayerId, type Unit, type Tower, type CardType,
} from "./engine";
import { CARD_DEFS, ALL_CARDS, makeStartingHand, nextCard } from "./cards";

interface Props {
  roomId: string;
  myInfo: { id: string; name: string; role: "p1" | "p2" };
  channel: RealtimeChannel;
  onLeave: () => void;
}

// ─── Particle system (visual only, not game state) ────────────────────────────
interface Particle {
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  r: number;
  color: string;
  type: "spark" | "ring" | "float";
}
let pId = 0;

// ─── Color helpers ────────────────────────────────────────────────────────────
function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}
function lighten(hex: string, amt: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.min(255, r + amt)},${Math.min(255, g + amt)},${Math.min(255, b + amt)})`;
}
function darken(hex: string, amt: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.max(0, r - amt)},${Math.max(0, g - amt)},${Math.max(0, b - amt)})`;
}

// ─── Card colors ──────────────────────────────────────────────────────────────
const UNIT_COLORS: Record<CardType, string> = {
  knight:   "#4f46e5",
  archer:   "#16a34a",
  giant:    "#dc2626",
  goblin:   "#ca8a04",
  witch:    "#7c3aed",
  barbarian:"#ea580c",
  fireball: "#f97316",
  dragon:   "#0891b2",
};

const UNIT_RADIUS: Partial<Record<CardType, number>> = {
  giant: 16, dragon: 13,
};
function getRadius(type: CardType) { return UNIT_RADIUS[type] ?? 10; }

// ─── 3D Drawing helpers ───────────────────────────────────────────────────────

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w < 0 || h < 0) return;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawHealthBar(ctx: CanvasRenderingContext2D, cx: number, top: number, barW: number, hp: number, maxHp: number) {
  const ratio = Math.max(0, Math.min(1, hp / maxHp));
  const h = 5;
  // Background
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  drawRoundRect(ctx, cx - barW / 2, top, barW, h, 2);
  ctx.fill();
  // Fill
  const col = ratio > 0.55 ? "#22c55e" : ratio > 0.28 ? "#f59e0b" : "#ef4444";
  ctx.fillStyle = col;
  drawRoundRect(ctx, cx - barW / 2, top, barW * ratio, h, 2);
  ctx.fill();
  // Glass sheen
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  drawRoundRect(ctx, cx - barW / 2, top, barW, h / 2, 1);
  ctx.fill();
}

function draw3DTower(ctx: CanvasRenderingContext2D, t: Tower, scale: number) {
  if (!t.alive) return;
  const x = t.x * scale, cy = t.y * scale;
  const isKing = t.kind === "king";
  const fw = (isKing ? 36 : 26) * scale;
  const fh = (isKing ? 52 : 38) * scale;
  const depth = (isKing ? 10 : 7) * scale;
  const baseCol = t.owner === "p1" ? (isKing ? "#1d4ed8" : "#3b82f6") : (isKing ? "#b91c1c" : "#ef4444");
  const topFace  = lighten(baseCol, 45);
  const sideFace = darken(baseCol, 55);

  const tx = x - fw / 2, ty = cy - fh / 2;

  // Ground glow
  ctx.save();
  ctx.globalAlpha = 0.22;
  const gGlow = ctx.createRadialGradient(x, cy + fh / 2, 0, x, cy + fh / 2, fw);
  gGlow.addColorStop(0, baseCol);
  gGlow.addColorStop(1, "transparent");
  ctx.fillStyle = gGlow;
  ctx.beginPath();
  ctx.ellipse(x, cy + fh / 2, fw * 1.1, fw * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  // Shadow
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(x + depth / 2, cy + fh / 2 + 4 * scale, fw * 0.55, 5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  // ── Right side face (darker) ──
  ctx.fillStyle = sideFace;
  ctx.beginPath();
  ctx.moveTo(tx + fw,      ty);
  ctx.lineTo(tx + fw + depth, ty - depth);
  ctx.lineTo(tx + fw + depth, ty + fh - depth);
  ctx.lineTo(tx + fw,      ty + fh);
  ctx.closePath();
  ctx.fill();

  // ── Top face (lighter) ──
  ctx.fillStyle = topFace;
  ctx.beginPath();
  ctx.moveTo(tx,           ty);
  ctx.lineTo(tx + depth,   ty - depth);
  ctx.lineTo(tx + fw + depth, ty - depth);
  ctx.lineTo(tx + fw,      ty);
  ctx.closePath();
  ctx.fill();

  // ── Front face ──
  const frontGrad = ctx.createLinearGradient(tx, ty, tx + fw, ty + fh);
  frontGrad.addColorStop(0, lighten(baseCol, 20));
  frontGrad.addColorStop(1, darken(baseCol, 20));
  ctx.fillStyle = frontGrad;
  ctx.fillRect(tx, ty, fw, fh);

  // Front face border
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1 * scale;
  ctx.strokeRect(tx, ty, fw, fh);

  // Window slit
  const winH = fh * 0.22, winW = fw * 0.28;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x - winW / 2, cy - winH / 2, winW, winH);
  ctx.fillStyle = "rgba(255,230,100,0.4)";
  ctx.fillRect(x - winW / 2 + 1 * scale, cy - winH / 2 + 1 * scale, winW * 0.6, winH * 0.4);

  // Battlements (crenellations) on front top
  const crenCount = isKing ? 5 : 3;
  const crenW = fw / (crenCount * 2 - 1);
  const crenH = 7 * scale;
  for (let i = 0; i < crenCount; i++) {
    const cx2 = tx + i * crenW * 2;
    // Front cren
    ctx.fillStyle = lighten(baseCol, 15);
    ctx.fillRect(cx2, ty - crenH, crenW, crenH);
    // Side cren (3D)
    ctx.fillStyle = sideFace;
    ctx.beginPath();
    ctx.moveTo(cx2 + crenW, ty - crenH);
    ctx.lineTo(cx2 + crenW + depth * 0.5, ty - crenH - depth * 0.5);
    ctx.lineTo(cx2 + crenW + depth * 0.5, ty - depth * 0.5);
    ctx.lineTo(cx2 + crenW, ty);
    ctx.closePath();
    ctx.fill();
    // Top cren
    ctx.fillStyle = topFace;
    ctx.beginPath();
    ctx.moveTo(cx2, ty - crenH);
    ctx.lineTo(cx2 + depth * 0.5, ty - crenH - depth * 0.5);
    ctx.lineTo(cx2 + crenW + depth * 0.5, ty - crenH - depth * 0.5);
    ctx.lineTo(cx2 + crenW, ty - crenH);
    ctx.closePath();
    ctx.fill();
  }

  // Crown for king
  if (isKing) {
    ctx.font = `${16 * scale}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("👑", x, ty - crenH - 14 * scale);
  }

  // Flag on top
  ctx.fillStyle = t.owner === "p1" ? "#93c5fd" : "#fca5a5";
  ctx.beginPath();
  ctx.moveTo(x, ty - crenH - (isKing ? 24 : 14) * scale);
  ctx.lineTo(x + 10 * scale, ty - crenH - (isKing ? 18 : 8) * scale);
  ctx.lineTo(x, ty - crenH - (isKing ? 12 : 2) * scale);
  ctx.closePath();
  ctx.fill();
  // flagpole
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.5 * scale;
  ctx.beginPath();
  ctx.moveTo(x, ty - crenH);
  ctx.lineTo(x, ty - crenH - (isKing ? 28 : 18) * scale);
  ctx.stroke();

  // HP bar
  const hpY = ty - crenH - (isKing ? 40 : 30) * scale;
  drawHealthBar(ctx, x, hpY, (isKing ? 54 : 42) * scale, t.hp, t.maxHp);

  // HP number
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `bold ${7 * scale}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(Math.max(0, Math.ceil(t.hp))), x, cy);
}

function draw3DUnit(ctx: CanvasRenderingContext2D, u: Unit, scale: number, gameMs: number) {
  if (!u.alive) return;
  const x = u.x * scale, y = u.y * scale;
  const def = CARD_DEFS[u.type];
  const r = getRadius(u.type) * scale;
  const col = UNIT_COLORS[u.type];

  // Bobbing
  const bob = Math.sin(gameMs / 350 + u.id.charCodeAt(0)) * 1.8 * scale;
  const uy = y - bob;

  // Ground shadow (ellipse)
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.55, r * 0.85, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  // Flying wings behind body
  if (u.flying) {
    const wingW = r * 1.6, wingH = r * 0.45;
    const wingFlap = Math.sin(gameMs / 180 + u.id.charCodeAt(0)) * 0.25;
    ctx.save();
    ctx.globalAlpha = 0.55;
    const wingCol = lighten(col, 35);
    // Left wing
    ctx.fillStyle = wingCol;
    ctx.beginPath();
    ctx.ellipse(x - r * 1.25, uy + wingFlap * r, wingW, wingH, -wingFlap - 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Right wing
    ctx.beginPath();
    ctx.ellipse(x + r * 1.25, uy - wingFlap * r, wingW, wingH, wingFlap + 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Glow aura for powerful units
  if (u.type === "witch" || u.type === "dragon" || u.type === "giant") {
    const pulse = 0.25 + 0.12 * Math.sin(gameMs / 300 + u.id.charCodeAt(0));
    ctx.save();
    ctx.globalAlpha = pulse;
    const aura = ctx.createRadialGradient(x, uy, r * 0.5, x, uy, r * 2.2);
    aura.addColorStop(0, col);
    aura.addColorStop(1, "transparent");
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(x, uy, r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // 3D sphere body — radial gradient simulates a point light from top-left
  const sphereGrad = ctx.createRadialGradient(
    x - r * 0.32, uy - r * 0.32, r * 0.05,
    x, uy, r
  );
  sphereGrad.addColorStop(0, lighten(col, 75));
  sphereGrad.addColorStop(0.35, lighten(col, 20));
  sphereGrad.addColorStop(0.75, col);
  sphereGrad.addColorStop(1, darken(col, 65));
  ctx.fillStyle = sphereGrad;
  ctx.beginPath();
  ctx.arc(x, uy, r, 0, Math.PI * 2);
  ctx.fill();

  // Rim light from bottom-right (environment light bounce)
  const rimGrad = ctx.createRadialGradient(x + r * 0.5, uy + r * 0.5, 0, x, uy, r);
  rimGrad.addColorStop(0, "rgba(130,210,255,0.22)");
  rimGrad.addColorStop(0.6, "rgba(130,210,255,0.06)");
  rimGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rimGrad;
  ctx.beginPath();
  ctx.arc(x, uy, r, 0, Math.PI * 2);
  ctx.fill();

  // Specular highlight (small bright dot)
  const specGrad = ctx.createRadialGradient(
    x - r * 0.3, uy - r * 0.35, 0,
    x - r * 0.3, uy - r * 0.35, r * 0.45
  );
  specGrad.addColorStop(0, "rgba(255,255,255,0.7)");
  specGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = specGrad;
  ctx.beginPath();
  ctx.arc(x, uy, r, 0, Math.PI * 2);
  ctx.fill();

  // Outline
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1.2 * scale;
  ctx.beginPath();
  ctx.arc(x, uy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Emoji icon (centered on sphere)
  ctx.font = `${r * 1.1}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(def.emoji, x, uy);

  // HP bar above
  drawHealthBar(ctx, x, uy - r - 8 * scale, r * 2.8, u.hp, u.maxHp);
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle) {
  const alpha = p.life / p.maxLife;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (p.type === "ring") {
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * (1 - alpha) * 30, 0, Math.PI * 2);
    ctx.stroke();
  } else if (p.type === "float") {
    ctx.fillStyle = p.color;
    ctx.font = `${p.r}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✨", p.x, p.y);
  } else {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function spawnAttackParticles(x: number, y: number, col: string): Particle[] {
  const out: Particle[] = [];
  // Sparks
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 2;
    out.push({
      id: ++pId, x, y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1,
      life: 0.5 + Math.random() * 0.4, maxLife: 0.5 + Math.random() * 0.4,
      r: 2 + Math.random() * 3, color: col, type: "spark",
    });
  }
  // Ring
  out.push({ id: ++pId, x, y, vx: 0, vy: 0, life: 0.4, maxLife: 0.4, r: 1, color: col, type: "ring" });
  return out;
}

// ─── Animated grass detail ────────────────────────────────────────────────────
function drawTerrain(ctx: CanvasRenderingContext2D, W: number, H: number, scale: number, ms: number) {
  // Top half background (enemy side)
  const topGrad = ctx.createLinearGradient(0, 0, 0, RIVER_Y * scale);
  topGrad.addColorStop(0, "#12072a");
  topGrad.addColorStop(0.4, "#1a0a38");
  topGrad.addColorStop(1, "#1c3a1e");
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, W, RIVER_Y * scale);

  // Bottom half background (my side)
  const botGrad = ctx.createLinearGradient(0, RIVER_Y * scale, 0, H);
  botGrad.addColorStop(0, "#1a3e22");
  botGrad.addColorStop(0.5, "#152e1a");
  botGrad.addColorStop(1, "#0c1e11");
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, RIVER_Y * scale, W, H - RIVER_Y * scale);

  // Animated firefly / magic mote particles on enemy side
  for (let i = 0; i < 8; i++) {
    const mx = ((Math.sin(ms / 3000 + i * 1.4) * 0.5 + 0.5) * W);
    const my = ((Math.sin(ms / 2500 + i * 2.1) * 0.5 + 0.5) * RIVER_Y * scale * 0.85);
    const mp = 0.3 + 0.5 * Math.sin(ms / 800 + i);
    ctx.save();
    ctx.globalAlpha = Math.max(0, mp);
    ctx.fillStyle = i % 3 === 0 ? "#c084fc" : i % 3 === 1 ? "#60a5fa" : "#34d399";
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // Subtle hex grid on grass
  ctx.strokeStyle = "rgba(0,0,0,0.09)";
  ctx.lineWidth = 0.5;
  const hexSize = 18 * scale;
  const hexW = hexSize * 1.732, hexH = hexSize * 2;
  for (let row = -1; row < H / hexH + 1; row++) {
    for (let col2 = -1; col2 < W / hexW + 1; col2++) {
      const hx = col2 * hexW + (row % 2 === 0 ? 0 : hexW / 2);
      const hy = row * hexH * 0.75;
      if (Math.abs(hy - RIVER_Y * scale) < 30 * scale) continue; // skip river area
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 6;
        const px = hx + hexSize * Math.cos(angle);
        const py = hy + hexSize * Math.sin(angle);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  // Lane markers
  for (const bx of BRIDGE_XS) {
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 18 * scale;
    ctx.setLineDash([8 * scale, 8 * scale]);
    ctx.beginPath();
    ctx.moveTo(bx * scale, 0);
    ctx.lineTo(bx * scale, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // River
  const waveOff = (ms / 1800) % 1;
  const riverGrad = ctx.createLinearGradient(0, (RIVER_Y - 22) * scale, 0, (RIVER_Y + 22) * scale);
  riverGrad.addColorStop(0, "#0c2040");
  riverGrad.addColorStop(0.5, "#1a4a7c");
  riverGrad.addColorStop(1, "#0c2040");
  ctx.fillStyle = riverGrad;
  ctx.fillRect(0, (RIVER_Y - 22) * scale, W, 44 * scale);

  // Animated river shimmer
  for (let i = 0; i < 12; i++) {
    const rx = ((i / 12 + waveOff) % 1) * W;
    const ry = RIVER_Y * scale + Math.sin(i * 1.4) * 8 * scale;
    ctx.fillStyle = "rgba(100,180,255,0.12)";
    ctx.beginPath();
    ctx.ellipse(rx, ry, 22 * scale, 3.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // River edge highlights
  ctx.fillStyle = "rgba(100,180,255,0.18)";
  ctx.fillRect(0, (RIVER_Y - 23) * scale, W, 2 * scale);
  ctx.fillRect(0, (RIVER_Y + 21) * scale, W, 2 * scale);

  // Bridges
  for (const bx of BRIDGE_XS) {
    const bLeft = (bx - 17) * scale, bTop = (RIVER_Y - 23) * scale;
    const bW = 34 * scale, bH = 46 * scale;

    // Bridge shadow
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#000";
    ctx.fillRect(bLeft + 3 * scale, bTop + 3 * scale, bW, bH);
    ctx.globalAlpha = 1;
    ctx.restore();

    // Bridge side
    ctx.fillStyle = "#6b5535";
    ctx.fillRect(bLeft + bW, bTop, 6 * scale, bH - 4 * scale);
    // Bridge top
    ctx.fillStyle = "#9a8060";
    ctx.fillRect(bLeft - 2 * scale, bTop, bW + 2 * scale, 6 * scale);
    // Bridge deck
    ctx.fillStyle = "#8b7355";
    ctx.fillRect(bLeft, bTop + 4 * scale, bW, bH - 4 * scale);
    // Plank lines
    ctx.strokeStyle = "#6b5535";
    ctx.lineWidth = 1.5 * scale;
    for (let py = bTop + 4 * scale; py < bTop + bH; py += 7 * scale) {
      ctx.beginPath();
      ctx.moveTo(bLeft, py);
      ctx.lineTo(bLeft + bW, py);
      ctx.stroke();
    }
    // Bridge edge highlight
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1 * scale;
    ctx.strokeRect(bLeft, bTop + 4 * scale, bW, bH - 4 * scale);

    // Guard rails
    ctx.strokeStyle = "#5a4520";
    ctx.lineWidth = 2.5 * scale;
    ctx.beginPath();
    ctx.moveTo(bLeft, bTop + 4 * scale);
    ctx.lineTo(bLeft, bTop + bH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bLeft + bW, bTop + 4 * scale);
    ctx.lineTo(bLeft + bW, bTop + bH);
    ctx.stroke();
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function GameArena({ roomId: _roomId, myInfo, channel, onLeave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GameState>(initGameState());
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const pendingEventsRef = useRef<GameEvent[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const prevUnitsRef = useRef<Set<string>>(new Set());

  const [gameState, setGameState] = useState<GameState>(stateRef.current);
  const [hand, setHand] = useState<CardType[]>(makeStartingHand());
  const [deck, setDeck] = useState<CardType[]>(ALL_CARDS.slice(4));
  const [selectedCard, setSelectedCard] = useState<CardType | null>(null);
  const [hoveredCard, setHoveredCard] = useState<CardType | null>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [showWin, setShowWin] = useState(false);

  const handRef = useRef(hand);
  const deckRef = useRef(deck);
  handRef.current = hand;
  deckRef.current = deck;
  const scaleRef = useRef(canvasScale);
  scaleRef.current = canvasScale;
  const selectedCardRef = useRef<CardType | null>(null);
  selectedCardRef.current = selectedCard;

  const myRole: PlayerId = myInfo.role;
  const oppRole: PlayerId = myRole === "p1" ? "p2" : "p1";

  // ─── Responsive sizing ──────────────────────────────────────────────────────
  useEffect(() => {
    function resize() {
      const container = containerRef.current;
      if (!container) return;
      const maxH = window.innerHeight - 200;
      const maxW = container.clientWidth;
      const s = Math.min(maxH / CH, maxW / CW, 1.5);
      setCanvasScale(Math.max(0.45, s));
    }
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // ─── Realtime ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const sub = channel.on("broadcast", { event: "deploy_card" }, ({ payload }: { payload: GameEvent }) => {
      if (payload.owner !== myRole) {
        pendingEventsRef.current.push(payload);
      }
    });
    return () => { void sub; };
  }, [channel, myRole]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  const render = useCallback((s: GameState, particles: Particle[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sc = scaleRef.current;
    const W = CW * sc, H = CH * sc;

    ctx.clearRect(0, 0, W, H);
    drawTerrain(ctx, W, H, sc, s.gameMs);

    // Deployment zone highlight
    const selCard = selectedCardRef.current;
    if (selCard) {
      const zoneTop = myRole === "p1" ? (RIVER_Y + 20) * sc : 0;
      const zoneH   = myRole === "p1" ? H - (RIVER_Y + 20) * sc : (RIVER_Y - 20) * sc;
      const pulse = 0.06 + 0.04 * Math.sin(s.gameMs / 300);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(0, zoneTop, W, zoneH);
      ctx.globalAlpha = 1;
      // Dashed border around zone
      ctx.strokeStyle = "rgba(245,158,11,0.55)";
      ctx.lineWidth = 2 * sc;
      ctx.setLineDash([8 * sc, 6 * sc]);
      ctx.strokeRect(2 * sc, zoneTop + 2 * sc, W - 4 * sc, zoneH - 4 * sc);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Decorative trees on sides (fixed positions, drawn once)
    const treePairs: [number, number][] = [
      [12, 60], [12, 200], [12, 420], [12, 580],
      [CW - 12, 60], [CW - 12, 200], [CW - 12, 420], [CW - 12, 580],
    ];
    for (const [tx, ty] of treePairs) {
      if (Math.abs(ty - RIVER_Y) < 45) continue;
      const th = 18 * sc;
      // Trunk
      ctx.fillStyle = "#5a3a1a";
      ctx.fillRect((tx - 2) * sc, (ty - 4) * sc, 4 * sc, th * 0.5);
      // Canopy
      ctx.fillStyle = ty < RIVER_Y ? "#1a5c2a" : "#1c6b30";
      ctx.beginPath();
      ctx.arc(tx * sc, (ty - 6) * sc, th * 0.52, 0, Math.PI * 2);
      ctx.fill();
      // Highlight
      ctx.fillStyle = "rgba(80,200,80,0.2)";
      ctx.beginPath();
      ctx.arc((tx - 2) * sc, (ty - 8) * sc, th * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }

    // Torches near towers (pulsing orange glow)
    const torchPulse = 0.3 + 0.15 * Math.sin(s.gameMs / 200);
    for (const t of s.towers) {
      if (!t.alive) continue;
      ctx.save();
      ctx.globalAlpha = torchPulse;
      const glow = ctx.createRadialGradient(t.x * sc, t.y * sc, 0, t.x * sc, t.y * sc, 55 * sc);
      const glowCol = t.owner === "p1" ? "#4488ff" : "#ff4444";
      glow.addColorStop(0, glowCol);
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(t.x * sc, t.y * sc, 55 * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Towers
    for (const t of s.towers) draw3DTower(ctx, t, sc);

    // Units (sorted by y — painter's algorithm)
    const sortedUnits = [...s.units].sort((a, b) => a.y - b.y);
    for (const u of sortedUnits) draw3DUnit(ctx, u, sc, s.gameMs);

    // Particles
    for (const p of particles) drawParticle(ctx, p);

    // Side labels
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.font = `bold ${8 * sc}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (myRole === "p1") {
      ctx.fillText("YOUR KINGDOM", CW / 2 * sc, (CH - 22) * sc);
      ctx.fillText("ENEMY KINGDOM", CW / 2 * sc, 18 * sc);
    } else {
      ctx.fillText("YOUR KINGDOM", CW / 2 * sc, 18 * sc);
      ctx.fillText("ENEMY KINGDOM", CW / 2 * sc, (CH - 22) * sc);
    }
  }, [myRole]);

  // ─── Game loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    lastTickRef.current = performance.now();

    function loop(now: number) {
      const dt = Math.min(now - lastTickRef.current, 100);
      lastTickRef.current = now;

      // Game tick
      const events = pendingEventsRef.current.splice(0);
      stateRef.current = tickGame(stateRef.current, dt, events);
      const s = stateRef.current;

      // Detect new attacks → spawn particles
      const curIds = new Set(s.units.map(u => u.id));
      for (const u of s.units) {
        if (!prevUnitsRef.current.has(u.id)) {
          // New unit: spawn spawn-flash
          const col = UNIT_COLORS[u.type];
          particlesRef.current.push(...spawnAttackParticles(u.x * scaleRef.current, u.y * scaleRef.current, col));
        }
      }
      // Dead units → death particles
      for (const id of prevUnitsRef.current) {
        if (!curIds.has(id)) {
          const deadUnit = [...s.units, ...events.map(() => null)].find(u => u?.id === id);
          if (deadUnit) {
            particlesRef.current.push(...spawnAttackParticles(deadUnit.x * scaleRef.current, deadUnit.y * scaleRef.current, "#fff"));
          }
        }
      }
      prevUnitsRef.current = curIds;

      // Update particles
      const dtSec = dt / 1000;
      particlesRef.current = particlesRef.current
        .map(p => ({ ...p, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy + 4 * dtSec, life: p.life - dtSec }))
        .filter(p => p.life > 0);

      setGameState({ ...s });

      if (s.phase === "ended") {
        render(s, particlesRef.current);
        setShowWin(true);
        return;
      }

      render(s, particlesRef.current);
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Deploy ─────────────────────────────────────────────────────────────────
  const deployCard = useCallback((card: CardType, canvasX: number, canvasY: number) => {
    const def = CARD_DEFS[card];
    const sc = scaleRef.current;
    if (stateRef.current.elixir[myRole] < def.cost) return;

    const lx = canvasX / sc;
    const ly = canvasY / sc;

    if (myRole === "p1" && ly < RIVER_Y + 20) return;
    if (myRole === "p2" && ly > RIVER_Y - 20) return;

    const count = Math.max(1, def.count);
    const unitIds = Array.from({ length: count }, (_, i) =>
      `${myRole}-${card}-${Date.now()}-${i}`
    );

    const ev: GameEvent = {
      kind: "deploy",
      owner: myRole,
      card,
      x: lx,
      y: ly,
      gameMs: stateRef.current.gameMs,
      unitIds,
    };

    pendingEventsRef.current.push(ev);
    channel.send({ type: "broadcast", event: "deploy_card", payload: ev });

    const { hand: newHand, deck: newDeck } = nextCard(handRef.current, deckRef.current, card);
    setHand(newHand);
    setDeck(newDeck);
    setSelectedCard(null);
  }, [channel, myRole]);

  function handleInteraction(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    if (!canvas || !selectedCard) return;
    const rect = canvas.getBoundingClientRect();
    deployCard(selectedCard, clientX - rect.left, clientY - rect.top);
  }

  const timeLeft = gameState.phase === "overtime"
    ? Math.max(0, MATCH_MS + OT_MS - gameState.gameMs)
    : Math.max(0, MATCH_MS - gameState.gameMs);

  const myTowers  = countTowers(gameState, myRole);
  const oppTowers = countTowers(gameState, oppRole);
  const myElixir  = gameState.elixir[myRole];
  const myElixirInt = Math.floor(myElixir);

  const canvasW = Math.round(CW * canvasScale);
  const canvasH = Math.round(CH * canvasScale);

  // ─── Win Screen ─────────────────────────────────────────────────────────────
  if (showWin) {
    const won = gameState.winner === myRole, draw = gameState.winner === "draw";
    return (
      <div style={{
        minHeight: "100vh",
        background: won
          ? "linear-gradient(135deg, #0f2c14, #1a4d1a)"
          : draw
          ? "linear-gradient(135deg, #1a1a2e, #2a2a4e)"
          : "linear-gradient(135deg, #2c0f0f, #4d1a1a)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Geist Sans', system-ui, sans-serif",
      }}>
        <div style={{
          textAlign: "center", padding: "48px 36px",
          background: "rgba(255,255,255,0.06)", borderRadius: 28,
          border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(20px)",
          maxWidth: 380, width: "100%", margin: 16,
          boxShadow: "0 32px 64px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 90, marginBottom: 12, filter: `drop-shadow(0 0 20px ${won ? "#f59e0b" : draw ? "#94a3b8" : "#ef4444"})` }}>
            {draw ? "🤝" : won ? "🏆" : "💀"}
          </div>
          <h1 style={{
            fontSize: 42, fontWeight: 900, margin: "0 0 8px", letterSpacing: "-0.02em",
            background: draw
              ? "linear-gradient(135deg,#94a3b8,#cbd5e1)"
              : won
              ? "linear-gradient(135deg,#f59e0b,#fbbf24)"
              : "linear-gradient(135deg,#ef4444,#f87171)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            {draw ? "DRAW!" : won ? "VICTORY!" : "DEFEAT"}
          </h1>
          <p style={{ color: "rgba(241,245,249,0.6)", fontSize: 15, margin: "0 0 32px" }}>
            {draw ? "An honorable stalemate." : won ? "Your kingdom stands victorious!" : "Your kingdom has fallen today."}
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 32, marginBottom: 32 }}>
            {[
              { label: "Your Towers", val: myTowers, col: myRole === "p1" ? "#3b82f6" : "#ef4444" },
              { label: "Enemy Towers", val: oppTowers, col: oppRole === "p1" ? "#3b82f6" : "#ef4444" },
            ].map(s => (
              <div key={s.label} style={{ textAlign: "center" }}>
                <div style={{ color: s.col, fontSize: 36, fontWeight: 900, lineHeight: 1 }}>{s.val}</div>
                <div style={{ color: "rgba(241,245,249,0.45)", fontSize: 12, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <button
            onClick={onLeave}
            style={{
              padding: "15px 36px", borderRadius: 14, border: "none",
              background: "linear-gradient(135deg, #8b5cf6, #3b82f6)",
              color: "white", fontSize: 17, fontWeight: 700, cursor: "pointer",
              boxShadow: "0 8px 32px rgba(139,92,246,0.5)",
              width: "100%", letterSpacing: "-0.01em",
            }}
          >
            ⚔️ Play Again
          </button>
        </div>
      </div>
    );
  }

  // ─── Main render ─────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #0a0612 0%, #0f0c29 40%, #1a1a2e 100%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      fontFamily: "'Geist Sans', system-ui, sans-serif",
      userSelect: "none", WebkitUserSelect: "none",
      overflowX: "hidden",
    }}>
      <style>{`
        @keyframes elixir-glow { 0%,100%{opacity:.8} 50%{opacity:1} }
        @keyframes card-select { 0%{box-shadow:0 0 0 0 rgba(245,158,11,0)} 100%{box-shadow:0 0 20px 4px rgba(245,158,11,0.5)} }
        @keyframes overtime-flash { 0%,100%{background:rgba(239,68,68,0.15)} 50%{background:rgba(239,68,68,0.35)} }
        @keyframes shimmer { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
        canvas { touch-action: none; display: block; }
        .card-btn { transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s; }
        .card-btn:hover:not(:disabled) { transform: translateY(-6px) scale(1.06) !important; }
        .card-btn.sel { animation: card-select 0.8s ease-in-out infinite alternate; transform: translateY(-10px) scale(1.1) !important; }
        .card-btn:active:not(:disabled) { transform: scale(0.95) !important; }
      `}</style>

      {/* ── Top HUD ────────────────────────────────────────────────────────── */}
      <div style={{
        width: "100%", maxWidth: canvasW, padding: "6px 10px",
        display: "flex", alignItems: "center", gap: 8,
        boxSizing: "border-box",
      }}>
        {/* Opponent tower pips */}
        <div style={{ display: "flex", gap: 4, flex: 1 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 16, height: 22, borderRadius: 4,
              background: i < oppTowers
                ? (oppRole === "p1" ? "linear-gradient(180deg,#60a5fa,#1d4ed8)" : "linear-gradient(180deg,#f87171,#b91c1c)")
                : "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: i < oppTowers ? "0 0 8px rgba(239,68,68,0.4)" : "none",
              transition: "all 0.4s",
            }} />
          ))}
        </div>

        {/* Timer */}
        <div style={{
          background: gameState.phase === "overtime" ? "rgba(239,68,68,0.2)" : "rgba(0,0,0,0.55)",
          border: `1px solid ${gameState.phase === "overtime" ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.1)"}`,
          borderRadius: 12, padding: "3px 14px", textAlign: "center", minWidth: 68,
          animation: gameState.phase === "overtime" ? "overtime-flash 1s ease-in-out infinite" : "none",
        }}>
          {gameState.phase === "overtime" && (
            <div style={{ color: "#ef4444", fontSize: 8, fontWeight: 700, letterSpacing: "0.1em" }}>OVERTIME</div>
          )}
          <div style={{
            color: timeLeft < 30000 ? "#ef4444" : "#f59e0b",
            fontSize: 20, fontWeight: 800, lineHeight: 1.1,
            fontVariantNumeric: "tabular-nums",
            textShadow: timeLeft < 30000 ? "0 0 12px #ef4444" : "0 0 8px rgba(245,158,11,0.4)",
          }}>
            {`${Math.floor(timeLeft / 60000)}:${String(Math.floor((timeLeft % 60000) / 1000)).padStart(2, "0")}`}
          </div>
        </div>

        {/* My tower pips */}
        <div style={{ display: "flex", gap: 4, flex: 1, justifyContent: "flex-end" }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 16, height: 22, borderRadius: 4,
              background: i < myTowers
                ? (myRole === "p1" ? "linear-gradient(180deg,#60a5fa,#1d4ed8)" : "linear-gradient(180deg,#f87171,#b91c1c)")
                : "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: i < myTowers ? "0 0 8px rgba(59,130,246,0.4)" : "none",
              transition: "all 0.4s",
            }} />
          ))}
        </div>
      </div>

      {/* ── Canvas ─────────────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{
          position: "relative", width: "100%", maxWidth: canvasW,
          cursor: selectedCard ? "crosshair" : "default",
          boxShadow: "0 0 60px rgba(139,92,246,0.15), 0 16px 40px rgba(0,0,0,0.6)",
        }}
      >
        <canvas
          ref={canvasRef}
          width={canvasW}
          height={canvasH}
          onClick={e => handleInteraction(e.clientX, e.clientY)}
          onTouchEnd={e => {
            e.preventDefault();
            const t = e.changedTouches[0];
            if (t) handleInteraction(t.clientX, t.clientY);
          }}
        />

        {/* Deploy hint */}
        {selectedCard && (
          <div style={{
            position: "absolute",
            bottom: myRole === "p1" ? 4 : undefined,
            top: myRole === "p2" ? 4 : undefined,
            left: "50%", transform: "translateX(-50%)",
            pointerEvents: "none",
            background: "rgba(245,158,11,0.18)",
            border: "1.5px dashed rgba(245,158,11,0.6)",
            borderRadius: 8, padding: "5px 14px",
            fontSize: 12 * Math.min(canvasScale, 1),
            color: "#fbbf24", whiteSpace: "nowrap",
            backdropFilter: "blur(4px)",
          }}>
            Tap your side → deploy {CARD_DEFS[selectedCard].name}
          </div>
        )}
      </div>

      {/* ── Elixir bar ─────────────────────────────────────────────────────── */}
      <div style={{
        width: "100%", maxWidth: canvasW, padding: "5px 10px 3px",
        display: "flex", alignItems: "center", gap: 8, boxSizing: "border-box",
      }}>
        <span style={{ fontSize: 18, filter: "drop-shadow(0 0 6px #8b5cf6)" }}>💜</span>
        <div style={{ flex: 1, height: 15, borderRadius: 8, overflow: "hidden", position: "relative", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(139,92,246,0.3)" }}>
          <div style={{
            position: "absolute", inset: 0,
            width: `${(myElixir / ELIXIR_MAX) * 100}%`,
            background: "linear-gradient(90deg, #5b21b6, #7c3aed, #8b5cf6)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), 0 0 12px rgba(139,92,246,0.7)",
            transition: "width 0.18s linear",
            animation: "elixir-glow 1.5s ease-in-out infinite",
          }} />
          {Array.from({ length: ELIXIR_MAX - 1 }, (_, i) => (
            <div key={i} style={{
              position: "absolute", top: 2, bottom: 2,
              left: `${((i + 1) / ELIXIR_MAX) * 100}%`,
              width: 1, background: "rgba(0,0,0,0.35)",
            }} />
          ))}
        </div>
        <span style={{ color: "#c4b5fd", fontWeight: 800, fontSize: 16, minWidth: 24, textAlign: "right" }}>
          {myElixirInt}
        </span>
      </div>

      {/* ── Card Hand ──────────────────────────────────────────────────────── */}
      <div style={{
        width: "100%", maxWidth: canvasW, padding: "4px 6px 12px",
        display: "flex", gap: 6, justifyContent: "center",
        overflowX: "auto", boxSizing: "border-box", position: "relative",
      }}>
        {/* Tooltip */}
        {hoveredCard && (() => {
          const td = CARD_DEFS[hoveredCard];
          const col = UNIT_COLORS[hoveredCard];
          return (
            <div style={{
              position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
              background: "rgba(10,5,25,0.95)", border: `1px solid ${col}55`,
              borderRadius: 12, padding: "10px 14px", minWidth: 160, zIndex: 100,
              boxShadow: `0 0 24px ${col}33, 0 8px 24px rgba(0,0,0,0.5)`,
              backdropFilter: "blur(12px)", pointerEvents: "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 24 }}>{td.emoji}</span>
                <div>
                  <div style={{ color: "#f1f5f9", fontWeight: 800, fontSize: 13 }}>{td.name}</div>
                  <div style={{ color: col, fontSize: 10 }}>{td.description}</div>
                </div>
              </div>
              {td.type !== "fireball" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px" }}>
                  {[
                    { label: "HP", val: td.hp, max: 2200, col: "#22c55e" },
                    { label: "DMG", val: td.dmg, max: 420, col: "#ef4444" },
                    { label: "SPD", val: Math.round(td.speed * 1000), max: 100, col: "#f59e0b" },
                    { label: "RNG", val: td.range, max: 160, col: "#8b5cf6" },
                  ].map(s => (
                    <div key={s.label}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                        <span style={{ color: "rgba(241,245,249,0.5)", fontSize: 9 }}>{s.label}</span>
                        <span style={{ color: s.col, fontSize: 9, fontWeight: 700 }}>{s.val}</span>
                      </div>
                      <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.1)" }}>
                        <div style={{ height: "100%", borderRadius: 2, background: s.col, width: `${Math.min(100, (s.val / s.max) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {td.type === "fireball" && (
                <div style={{ color: "#f97316", fontSize: 11, fontWeight: 700 }}>
                  💥 {td.dmg} AOE · radius {td.aoeRadius}px
                </div>
              )}
            </div>
          );
        })()}

        {hand.map(card => {
          const def = CARD_DEFS[card];
          const canAfford = myElixir >= def.cost;
          const isSel = selectedCard === card;
          const col = UNIT_COLORS[card];
          return (
            <button
              key={card}
              className={`card-btn${isSel ? " sel" : ""}`}
              disabled={!canAfford}
              onClick={() => setSelectedCard(isSel ? null : card)}
              onMouseEnter={() => setHoveredCard(card)}
              onMouseLeave={() => setHoveredCard(null)}
              style={{
                flex: "0 0 auto", width: 70, minHeight: 96,
                borderRadius: 14,
                border: `2px solid ${isSel ? "#f59e0b" : canAfford ? `${col}55` : "rgba(255,255,255,0.06)"}`,
                background: isSel
                  ? `linear-gradient(160deg, rgba(245,158,11,0.25), rgba(245,158,11,0.08))`
                  : canAfford
                  ? `linear-gradient(160deg, ${col}18, ${col}06)`
                  : "rgba(255,255,255,0.02)",
                cursor: canAfford ? "pointer" : "not-allowed",
                padding: "8px 4px 6px",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                opacity: canAfford ? 1 : 0.38,
                position: "relative",
                backdropFilter: "blur(8px)",
                boxShadow: isSel
                  ? `0 0 24px ${col}66, 0 0 8px rgba(245,158,11,0.4), inset 0 1px 0 rgba(255,255,255,0.2)`
                  : canAfford
                  ? `0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 ${col}30`
                  : "none",
                overflow: "hidden",
              }}
            >
              {/* Card color shimmer stripe at top */}
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, height: 3,
                background: canAfford ? `linear-gradient(90deg, transparent, ${col}, transparent)` : "transparent",
                opacity: 0.7,
              }} />

              {/* Elixir cost badge */}
              <div style={{
                position: "absolute", top: -7, right: -7,
                width: 22, height: 22, borderRadius: "50%",
                background: canAfford ? `linear-gradient(135deg,#5b21b6,#7c3aed)` : "#374151",
                border: "2px solid rgba(255,255,255,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 900, color: "white",
                boxShadow: canAfford ? "0 0 10px rgba(139,92,246,0.7)" : "none",
              }}>{def.cost}</div>

              {/* Card emoji art */}
              <div style={{
                fontSize: 32,
                filter: canAfford
                  ? `drop-shadow(0 0 6px ${col}) drop-shadow(0 2px 4px rgba(0,0,0,0.6))`
                  : "grayscale(1) opacity(0.5)",
              }}>
                {def.emoji}
              </div>

              {/* Name */}
              <div style={{
                color: isSel ? "#fbbf24" : canAfford ? "#f1f5f9" : "#64748b",
                fontSize: 9, fontWeight: 700, textAlign: "center", lineHeight: 1.2,
              }}>
                {def.name}
              </div>

              {/* Trait tag */}
              <div style={{
                color: canAfford ? `${col}cc` : "rgba(100,116,139,0.5)",
                fontSize: 8, textAlign: "center", fontWeight: 600,
              }}>
                {def.count > 1 ? `×${def.count} units` : def.flying ? "✈ flying" : def.aoe ? "💥 splash" : def.prefersBuildings ? "🏰 siege" : "⚔ melee"}
              </div>

              {/* Mini HP bar */}
              {def.hp > 0 && (
                <div style={{ width: "80%", height: 2, borderRadius: 1, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
                  <div style={{ height: "100%", background: "#22c55e", width: `${Math.min(100, (def.hp / 2200) * 100)}%`, borderRadius: 1 }} />
                </div>
              )}

              {/* Next card indicator */}
              {deck[0] === card && (
                <div style={{
                  position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%)",
                  fontSize: 7, color: "#94a3b8", background: "rgba(0,0,0,0.7)",
                  padding: "1px 5px", borderRadius: 3, whiteSpace: "nowrap",
                }}>NEXT</div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Leave ──────────────────────────────────────────────────────────── */}
      <button
        onClick={() => { if (confirm("Surrender and leave?")) onLeave(); }}
        style={{
          marginBottom: 12, padding: "5px 16px", borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
          color: "rgba(241,245,249,0.35)", fontSize: 11, cursor: "pointer",
          transition: "color 0.15s, border-color 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.4)"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "rgba(241,245,249,0.35)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
      >
        🏳 Surrender
      </button>
    </div>
  );
}
