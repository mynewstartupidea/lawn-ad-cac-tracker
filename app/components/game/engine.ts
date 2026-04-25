// ─── Realm Rush — Game Engine ──────────────────────────────────────────────
// Pure deterministic simulation. No randomness. No side effects.
// Both clients run identical ticks given identical events → identical state.

import { CARD_DEFS } from './cards';

export type PlayerId = 'p1' | 'p2';
export type CardType =
  | 'knight' | 'archer' | 'giant' | 'goblin'
  | 'witch'  | 'barbarian' | 'fireball' | 'dragon';

// Logical canvas: 360 × 640 px (scaled at render time)
export const CW = 360;
export const CH = 640;
export const RIVER_Y = 320;
export const BRIDGE_XS: number[] = [72, 180, 288];

export const MATCH_MS  = 3 * 60 * 1000;   // 3 min
export const OT_MS     = 60 * 1000;        // 1 min overtime
export const ELIXIR_MAX = 10;
export const ELIXIR_RATE_MS = 2800;        // 1 elixir per 2.8 s (≈ CoR pace)
export const ELIXIR_START   = 5;

// Princess towers unlock only when both princess towers on that side are dead
// (king tower only attacked once both princess towers are down)

// ─── Tower ────────────────────────────────────────────────────────────────────

export interface Tower {
  id: string;
  owner: PlayerId;
  kind: 'princess' | 'king';
  side: 'left' | 'right' | 'center';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  range: number;
  dmg: number;
  cooldownMs: number;
  lastShotMs: number;
  alive: boolean;
}

// ─── Unit ─────────────────────────────────────────────────────────────────────

export interface Unit {
  id: string;
  owner: PlayerId;
  type: CardType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speedPxMs: number;   // px per millisecond
  range: number;       // px — attack range
  dmg: number;
  cooldownMs: number;
  lastShotMs: number;
  alive: boolean;
  flying: boolean;
  prefersBuildings: boolean;  // targets towers over units if true
  aoe: boolean;
  aoeRadius: number;
}

// ─── GameEvent (deployed by a player) ────────────────────────────────────────

export interface DeployEvent {
  kind: 'deploy';
  owner: PlayerId;
  card: CardType;
  x: number;
  y: number;
  gameMs: number;       // game-clock ms when event was issued
  unitIds: string[];    // deterministic IDs assigned by sender
}

export interface GameEvent {
  kind: 'deploy';
  owner: PlayerId;
  card: CardType;
  x: number;
  y: number;
  gameMs: number;
  unitIds: string[];
}

// ─── GameState ────────────────────────────────────────────────────────────────

export interface GameState {
  towers: Tower[];
  units: Unit[];
  elixir: Record<PlayerId, number>;
  elixirAccMs: Record<PlayerId, number>;  // accumulated ms toward next elixir
  phase: 'playing' | 'overtime' | 'ended';
  winner: PlayerId | 'draw' | null;
  gameMs: number;       // total game time elapsed
  pendingEvents: GameEvent[];
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initGameState(): GameState {
  const towers: Tower[] = [
    // P1 bottom
    { id: 'p1-left',   owner: 'p1', kind: 'princess', side: 'left',   x: 72,  y: 565, hp: 1400, maxHp: 1400, range: 110, dmg: 80,  cooldownMs: 800,  lastShotMs: -999, alive: true },
    { id: 'p1-right',  owner: 'p1', kind: 'princess', side: 'right',  x: 288, y: 565, hp: 1400, maxHp: 1400, range: 110, dmg: 80,  cooldownMs: 800,  lastShotMs: -999, alive: true },
    { id: 'p1-king',   owner: 'p1', kind: 'king',     side: 'center', x: 180, y: 594, hp: 3000, maxHp: 3000, range: 130, dmg: 110, cooldownMs: 1000, lastShotMs: -999, alive: true },
    // P2 top
    { id: 'p2-left',   owner: 'p2', kind: 'princess', side: 'left',   x: 72,  y: 75,  hp: 1400, maxHp: 1400, range: 110, dmg: 80,  cooldownMs: 800,  lastShotMs: -999, alive: true },
    { id: 'p2-right',  owner: 'p2', kind: 'princess', side: 'right',  x: 288, y: 75,  hp: 1400, maxHp: 1400, range: 110, dmg: 80,  cooldownMs: 800,  lastShotMs: -999, alive: true },
    { id: 'p2-king',   owner: 'p2', kind: 'king',     side: 'center', x: 180, y: 46,  hp: 3000, maxHp: 3000, range: 130, dmg: 110, cooldownMs: 1000, lastShotMs: -999, alive: true },
  ];

  return {
    towers,
    units: [],
    elixir: { p1: ELIXIR_START, p2: ELIXIR_START },
    elixirAccMs: { p1: 0, p2: 0 },
    phase: 'playing',
    winner: null,
    gameMs: 0,
    pendingEvents: [],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dist(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function oppId(id: PlayerId): PlayerId {
  return id === 'p1' ? 'p2' : 'p1';
}

function kingAlive(state: GameState, owner: PlayerId) {
  return state.towers.some(t => t.owner === owner && t.kind === 'king' && t.alive);
}

function princessesAllDead(state: GameState, owner: PlayerId) {
  return !state.towers.some(t => t.owner === owner && t.kind === 'princess' && t.alive);
}

// Towers a unit is allowed to target (king only becomes targetable when both princess towers of that player are dead)
function targetableTowers(state: GameState, attacker: Unit): Tower[] {
  const opp = oppId(attacker.owner);
  const oppPrincessDead = princessesAllDead(state, opp);
  return state.towers.filter(t => {
    if (!t.alive) return false;
    if (t.owner !== opp) return false;
    if (t.kind === 'king' && !oppPrincessDead) return false;
    if (attacker.flying) return true;
    // Ground units can't cross river unless they're at a bridge column
    const atBridge = BRIDGE_XS.some(bx => Math.abs(attacker.x - bx) < 30);
    if (!atBridge && ((attacker.owner === 'p1' && t.y < RIVER_Y) || (attacker.owner === 'p2' && t.y > RIVER_Y))) return false;
    return true;
  });
}

// ─── Deploy a card → produces units ──────────────────────────────────────────

export function deployCard(state: GameState, ev: GameEvent): GameState {
  if (ev.kind !== 'deploy') return state;
  const def = CARD_DEFS[ev.card];
  if (!def) return state;

  const newUnits: Unit[] = [];

  if (ev.card === 'fireball') {
    // Instant AOE — apply damage now
    const updated = applyFireball(state, ev.x, ev.y, ev.owner, def.dmg, def.aoeRadius ?? 80);
    return { ...updated, pendingEvents: state.pendingEvents.filter(e => e !== ev) };
  }

  if (ev.card === 'barbarian') {
    // Spawns 3 barbarians in a triangle
    const offsets = [[-18, 0], [18, 0], [0, -22]] as [number, number][];
    offsets.forEach(([ox, oy], i) => {
      const id = ev.unitIds[i] ?? `${ev.owner}-barb-${ev.gameMs}-${i}`;
      newUnits.push(makeUnit(id, ev.owner, 'barbarian', ev.x + ox, ev.y + oy, ev.gameMs, def));
    });
  } else {
    const id = ev.unitIds[0] ?? `${ev.owner}-${ev.card}-${ev.gameMs}`;
    newUnits.push(makeUnit(id, ev.owner, ev.card, ev.x, ev.y, ev.gameMs, def));
  }

  return {
    ...state,
    units: [...state.units, ...newUnits],
    elixir: {
      ...state.elixir,
      [ev.owner]: Math.max(0, state.elixir[ev.owner] - def.cost),
    },
    pendingEvents: state.pendingEvents.filter(e => e !== ev),
  };
}

interface CardDefLike { hp: number; speed: number; range: number; dmg: number; cooldownMs: number; flying?: boolean; prefersBuildings?: boolean; aoe?: boolean; aoeRadius?: number }

function makeUnit(id: string, owner: PlayerId, type: CardType, x: number, y: number, _gameMs: number, def: CardDefLike): Unit {
  return {
    id, owner, type, x, y,
    hp: def.hp, maxHp: def.hp,
    speedPxMs: def.speed,
    range: def.range,
    dmg: def.dmg,
    cooldownMs: def.cooldownMs,
    lastShotMs: -9999,
    alive: true,
    flying: def.flying ?? false,
    prefersBuildings: def.prefersBuildings ?? false,
    aoe: def.aoe ?? false,
    aoeRadius: def.aoeRadius ?? 0,
  };
}

function applyFireball(state: GameState, x: number, y: number, _owner: PlayerId, dmg: number, radius: number): GameState {
  const units = state.units.map(u => {
    if (!u.alive) return u;
    if (dist(u.x, u.y, x, y) <= radius) {
      const newHp = u.hp - dmg;
      return { ...u, hp: newHp, alive: newHp > 0 };
    }
    return u;
  });
  const towers = state.towers.map(t => {
    if (!t.alive) return t;
    if (dist(t.x, t.y, x, y) <= radius) {
      const newHp = t.hp - Math.round(dmg * 0.35); // towers take reduced fireball dmg
      return { ...t, hp: newHp, alive: newHp > 0 };
    }
    return t;
  });
  return { ...state, units, towers };
}

// ─── Main tick ────────────────────────────────────────────────────────────────

export function tickGame(state: GameState, dt: number, newEvents: GameEvent[]): GameState {
  if (state.phase === 'ended') return state;

  let s = { ...state, gameMs: state.gameMs + dt, pendingEvents: [...state.pendingEvents, ...newEvents] };

  // Apply all events whose gameMs <= current gameMs
  const toApply = s.pendingEvents.filter(e => e.gameMs <= s.gameMs);
  const remaining = s.pendingEvents.filter(e => e.gameMs > s.gameMs);
  for (const ev of toApply) {
    s = deployCard({ ...s, pendingEvents: [ev] }, ev);
  }
  s = { ...s, pendingEvents: remaining };

  // Elixir regen (both players)
  s = regenElixir(s, dt);

  // Unit AI + combat
  s = processUnits(s, dt);

  // Tower combat
  s = processTowers(s, dt);

  // Clean dead
  s = { ...s, units: s.units.filter(u => u.alive) };

  // Win check
  s = checkWin(s);

  return s;
}

function regenElixir(s: GameState, dt: number): GameState {
  const elixir = { ...s.elixir };
  const acc = { ...s.elixirAccMs };
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    if (elixir[pid] < ELIXIR_MAX) {
      acc[pid] += dt;
      while (acc[pid] >= ELIXIR_RATE_MS && elixir[pid] < ELIXIR_MAX) {
        elixir[pid] = Math.min(ELIXIR_MAX, elixir[pid] + 1);
        acc[pid] -= ELIXIR_RATE_MS;
      }
    } else {
      acc[pid] = 0;
    }
  }
  return { ...s, elixir, elixirAccMs: acc };
}

function processUnits(s: GameState, dt: number): GameState {
  const units = s.units.map(unit => {
    if (!unit.alive) return unit;
    return updateUnit(unit, s, dt);
  });
  // Collect AOE damage after all attacks resolved
  return { ...s, units };
}

function updateUnit(unit: Unit, s: GameState, dt: number): Unit {
  const opp = oppId(unit.owner);
  const oppUnits = s.units.filter(u => u.alive && u.owner === opp && !u.flying);
  const oppFlyingUnits = s.units.filter(u => u.alive && u.owner === opp && u.flying);
  const allOppUnits = [...oppUnits, ...oppFlyingUnits];
  const ttowers = targetableTowers(s, unit);

  // Find closest enemy entity
  let closestUnit: Unit | null = null;
  let closestUnitDist = Infinity;
  for (const u of allOppUnits) {
    const d = dist(unit.x, unit.y, u.x, u.y);
    if (d < closestUnitDist) { closestUnitDist = d; closestUnit = u; }
  }

  let closestTower: Tower | null = null;
  let closestTowerDist = Infinity;
  for (const t of ttowers) {
    const d = dist(unit.x, unit.y, t.x, t.y);
    if (d < closestTowerDist) { closestTowerDist = d; closestTower = t; }
  }

  // Decide target: prefer buildings if flag set
  let targetX: number, targetY: number;
  let inRangeTarget: { type: 'unit'; u: Unit } | { type: 'tower'; t: Tower } | null = null;

  if (unit.prefersBuildings) {
    // Giant-style: always target tower, ignore units unless no towers
    if (closestTower) {
      targetX = closestTower.x; targetY = closestTower.y;
      if (closestTowerDist <= unit.range) inRangeTarget = { type: 'tower', t: closestTower };
    } else if (closestUnit) {
      targetX = closestUnit.x; targetY = closestUnit.y;
      if (closestUnitDist <= unit.range) inRangeTarget = { type: 'unit', u: closestUnit };
    } else {
      targetX = unit.x; targetY = unit.owner === 'p1' ? 0 : CH;
    }
  } else {
    // Normal: attack nearest enemy (unit takes priority if in range)
    const unitInRange  = closestUnit  && closestUnitDist  <= unit.range;
    const towerInRange = closestTower && closestTowerDist <= unit.range;

    if (unitInRange && closestUnit) {
      targetX = closestUnit.x; targetY = closestUnit.y;
      inRangeTarget = { type: 'unit', u: closestUnit };
    } else if (towerInRange && closestTower) {
      targetX = closestTower.x; targetY = closestTower.y;
      inRangeTarget = { type: 'tower', t: closestTower };
    } else if (closestUnit && closestTower) {
      // Move toward whichever is closer
      if (closestUnitDist < closestTowerDist) {
        targetX = closestUnit.x; targetY = closestUnit.y;
      } else {
        targetX = closestTower.x; targetY = closestTower.y;
      }
    } else if (closestUnit) {
      targetX = closestUnit.x; targetY = closestUnit.y;
    } else if (closestTower) {
      targetX = closestTower.x; targetY = closestTower.y;
    } else {
      // March to enemy side
      targetX = unit.x;
      targetY = unit.owner === 'p1' ? 0 : CH;
    }
  }

  let nx = unit.x, ny = unit.y;
  let lastShotMs = unit.lastShotMs;

  if (inRangeTarget) {
    // Attack if cooldown passed
    if (s.gameMs - unit.lastShotMs >= unit.cooldownMs) {
      lastShotMs = s.gameMs;
      // Damage applied by mutating target (collected in separate pass in processTowers for towers,
      // here for units we mutate in-place since JS objects are refs — but we're mapping, so we
      // mark damage via a side-channel array. Instead, use a shared damage ledger.)
      // To keep this pure/immutable, damage application is handled in a separate pass below.
      // For now just record the shot time; damage applied in applyUnitAttacks.
    }
  } else {
    // Move toward target
    const dx = targetX - unit.x, dy = targetY - unit.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1) {
      const step = unit.speedPxMs * dt;
      nx = unit.x + (dx / d) * step;
      ny = unit.y + (dy / d) * step;

      // River crossing: ground units must go via bridge
      if (!unit.flying) {
        const crossingRiver =
          (unit.owner === 'p1' && unit.y > RIVER_Y && ny < RIVER_Y) ||
          (unit.owner === 'p2' && unit.y < RIVER_Y && ny > RIVER_Y);
        if (crossingRiver) {
          // Snap to nearest bridge x
          let bestBx = BRIDGE_XS[0], bestDist = Math.abs(unit.x - BRIDGE_XS[0]);
          for (const bx of BRIDGE_XS) {
            const bd = Math.abs(targetX - bx);
            if (bd < bestDist) { bestDist = bd; bestBx = bx; }
          }
          // Move laterally first toward bridge if not aligned
          if (Math.abs(unit.x - bestBx) > 6) {
            const lx = unit.x + Math.sign(bestBx - unit.x) * Math.min(unit.speedPxMs * dt, Math.abs(unit.x - bestBx));
            nx = lx; ny = unit.y; // don't cross yet
          }
        }
      }
    }
  }

  return { ...unit, x: nx, y: ny, lastShotMs };
}

// Second pass: apply unit attacks (to avoid double-counting in same tick)
function processTowers(s: GameState, dt: number): GameState {
  // Build a damage ledger for units and towers
  const unitDmg: Record<string, number> = {};
  const towerDmg: Record<string, number> = {};

  // Units attacking
  for (const unit of s.units) {
    if (!unit.alive) continue;
    if (s.gameMs - unit.lastShotMs > 1) continue; // only units that fired this tick (lastShotMs == gameMs)
    // Strictly: a unit fired if lastShotMs was just set = s.gameMs in updateUnit
    // But since we mapped immutably, lastShotMs already reflects the shot decision.
    // We check: did lastShotMs change this tick?
    // The original unit had lastShotMs = prev value. After mapping, if it changed, it fired.
    // (The prev state units have old lastShotMs; new units have updated.)
    // This works because we compare s.gameMs - unit.lastShotMs <= 1 (one ms threshold).

    const opp = oppId(unit.owner);
    const ttowers = targetableTowers(s, unit);

    // Determine attack target (same logic as in updateUnit)
    const oppUnits = s.units.filter(u => u.alive && u.owner === opp);
    let closestUnit: Unit | null = null, closestUnitDist = Infinity;
    for (const u of oppUnits) {
      const d = dist(unit.x, unit.y, u.x, u.y);
      if (d < closestUnitDist) { closestUnitDist = d; closestUnit = u; }
    }
    let closestTower: Tower | null = null, closestTowerDist = Infinity;
    for (const t of ttowers) {
      const d = dist(unit.x, unit.y, t.x, t.y);
      if (d < closestTowerDist) { closestTowerDist = d; closestTower = t; }
    }

    const unitInRange  = closestUnit  && closestUnitDist  <= unit.range;
    const towerInRange = closestTower && closestTowerDist <= unit.range;

    if (unit.prefersBuildings && closestTower && towerInRange) {
      if (unit.aoe) {
        // AOE around tower
        for (const t of ttowers) {
          if (dist(unit.x, unit.y, t.x, t.y) <= unit.aoeRadius) {
            towerDmg[t.id] = (towerDmg[t.id] ?? 0) + unit.dmg;
          }
        }
        for (const u of oppUnits) {
          if (dist(unit.x, unit.y, u.x, u.y) <= unit.aoeRadius) {
            unitDmg[u.id] = (unitDmg[u.id] ?? 0) + unit.dmg;
          }
        }
      } else {
        towerDmg[closestTower.id] = (towerDmg[closestTower.id] ?? 0) + unit.dmg;
      }
    } else if (unitInRange && closestUnit) {
      if (unit.aoe) {
        for (const u of oppUnits) {
          if (dist(unit.x, unit.y, u.x, u.y) <= unit.aoeRadius) {
            unitDmg[u.id] = (unitDmg[u.id] ?? 0) + unit.dmg;
          }
        }
      } else {
        unitDmg[closestUnit.id] = (unitDmg[closestUnit.id] ?? 0) + unit.dmg;
      }
    } else if (towerInRange && closestTower) {
      towerDmg[closestTower.id] = (towerDmg[closestTower.id] ?? 0) + unit.dmg;
    }
  }

  // Towers attacking
  const towers = s.towers.map(tower => {
    if (!tower.alive) return tower;
    if (s.gameMs - tower.lastShotMs < tower.cooldownMs) return tower;

    const oppUnits = s.units.filter(u => u.alive && u.owner !== tower.owner && !u.flying);
    const oppFlying = s.units.filter(u => u.alive && u.owner !== tower.owner && u.flying);
    const allOpp = [...oppUnits, ...oppFlying];

    let closest: Unit | null = null, closestD = Infinity;
    for (const u of allOpp) {
      const d = dist(tower.x, tower.y, u.x, u.y);
      if (d <= tower.range && d < closestD) { closestD = d; closest = u; }
    }
    if (!closest) return tower;

    unitDmg[closest.id] = (unitDmg[closest.id] ?? 0) + tower.dmg;
    return { ...tower, lastShotMs: s.gameMs };
  });

  // Apply damage
  const units = s.units.map(u => {
    const dmg = unitDmg[u.id] ?? 0;
    if (!dmg) return u;
    const hp = u.hp - dmg;
    return { ...u, hp, alive: hp > 0 };
  });
  const updatedTowers = towers.map(t => {
    const dmg = towerDmg[t.id] ?? 0;
    if (!dmg) return t;
    const hp = t.hp - dmg;
    return { ...t, hp, alive: hp > 0 };
  });

  return { ...s, units, towers: updatedTowers };
}

function checkWin(s: GameState): GameState {
  const p1KingDead = !kingAlive(s, 'p1');
  const p2KingDead = !kingAlive(s, 'p2');

  if (p2KingDead && p1KingDead) return { ...s, phase: 'ended', winner: 'draw' };
  if (p2KingDead) return { ...s, phase: 'ended', winner: 'p1' };
  if (p1KingDead) return { ...s, phase: 'ended', winner: 'p2' };

  if (s.phase === 'playing' && s.gameMs >= MATCH_MS) {
    // Move to overtime or end based on tower count
    const p1Towers = s.towers.filter(t => t.owner === 'p1' && t.alive).length;
    const p2Towers = s.towers.filter(t => t.owner === 'p2' && t.alive).length;
    if (p1Towers !== p2Towers) {
      return { ...s, phase: 'ended', winner: p1Towers > p2Towers ? 'p1' : 'p2' };
    }
    return { ...s, phase: 'overtime' };
  }

  if (s.phase === 'overtime' && s.gameMs >= MATCH_MS + OT_MS) {
    const p1Towers = s.towers.filter(t => t.owner === 'p1' && t.alive).length;
    const p2Towers = s.towers.filter(t => t.owner === 'p2' && t.alive).length;
    if (p1Towers === p2Towers) return { ...s, phase: 'ended', winner: 'draw' };
    return { ...s, phase: 'ended', winner: p1Towers > p2Towers ? 'p1' : 'p2' };
  }

  return s;
}

export function countTowers(state: GameState, owner: PlayerId) {
  return state.towers.filter(t => t.owner === owner && t.alive).length;
}
