import type { CardType } from './engine';

export interface CardDef {
  type: CardType;
  name: string;
  cost: number;       // elixir
  hp: number;
  dmg: number;
  range: number;      // px
  speed: number;      // px/ms
  cooldownMs: number;
  flying: boolean;
  prefersBuildings: boolean;
  aoe: boolean;
  aoeRadius: number;
  count: number;      // how many units spawned (barbarian = 3)
  emoji: string;
  color: string;      // unit fill color
  description: string;
}

export const CARD_DEFS: Record<CardType, CardDef> = {
  knight: {
    type: 'knight', name: 'Knight', cost: 3,
    hp: 800,  dmg: 100, range: 50,  speed: 0.06, cooldownMs: 1100,
    flying: false, prefersBuildings: false, aoe: false, aoeRadius: 0, count: 1,
    emoji: '⚔️', color: '#4f46e5',
    description: 'Tanky melee fighter. Strong vs. ground units.',
  },
  archer: {
    type: 'archer', name: 'Archer', cost: 3,
    hp: 300,  dmg: 80,  range: 160, speed: 0.055, cooldownMs: 900,
    flying: false, prefersBuildings: false, aoe: false, aoeRadius: 0, count: 1,
    emoji: '🏹', color: '#16a34a',
    description: 'Ranged attacker. Can hit air units.',
  },
  giant: {
    type: 'giant', name: 'Giant', cost: 5,
    hp: 2200, dmg: 140, range: 60,  speed: 0.035, cooldownMs: 1500,
    flying: false, prefersBuildings: true, aoe: false, aoeRadius: 0, count: 1,
    emoji: '🔨', color: '#dc2626',
    description: 'Tanky tower-destroyer. Ignores troops.',
  },
  goblin: {
    type: 'goblin', name: 'Goblin', cost: 2,
    hp: 200,  dmg: 65,  range: 40,  speed: 0.10,  cooldownMs: 700,
    flying: false, prefersBuildings: false, aoe: false, aoeRadius: 0, count: 1,
    emoji: '👺', color: '#ca8a04',
    description: 'Cheap and fast. Great for distractions.',
  },
  witch: {
    type: 'witch', name: 'Witch', cost: 5,
    hp: 500,  dmg: 130, range: 130, speed: 0.045, cooldownMs: 1000,
    flying: false, prefersBuildings: false, aoe: true, aoeRadius: 70, count: 1,
    emoji: '🔮', color: '#7c3aed',
    description: 'AOE ranged attacker. Wrecks groups.',
  },
  barbarian: {
    type: 'barbarian', name: 'Barbarians', cost: 5,
    hp: 400,  dmg: 90,  range: 45,  speed: 0.07,  cooldownMs: 1000,
    flying: false, prefersBuildings: false, aoe: false, aoeRadius: 0, count: 3,
    emoji: '⚡', color: '#ea580c',
    description: 'Spawns 3 barbarians. Great swarm.',
  },
  fireball: {
    type: 'fireball', name: 'Fireball', cost: 4,
    hp: 0,    dmg: 420, range: 0,   speed: 0,    cooldownMs: 0,
    flying: false, prefersBuildings: false, aoe: true, aoeRadius: 80, count: 0,
    emoji: '🔥', color: '#f97316',
    description: 'Instant AOE spell. Decimates groups.',
  },
  dragon: {
    type: 'dragon', name: 'Dragon', cost: 4,
    hp: 650,  dmg: 130, range: 110, speed: 0.075, cooldownMs: 1200,
    flying: true, prefersBuildings: false, aoe: true, aoeRadius: 60, count: 1,
    emoji: '🐉', color: '#0891b2',
    description: 'Flying AOE unit. Flies over the river.',
  },
};

export function getCardDef(type: CardType): CardDef {
  return CARD_DEFS[type];
}

export const ALL_CARDS: CardType[] = [
  'knight', 'archer', 'giant', 'goblin', 'witch', 'barbarian', 'fireball', 'dragon',
];

// Each player always has 4 cards in hand cycling through all 8
export function makeStartingHand(): CardType[] {
  return ALL_CARDS.slice(0, 4);
}

export function nextCard(hand: CardType[], deck: CardType[], played: CardType): { hand: CardType[]; deck: CardType[] } {
  const newHand = hand.filter(c => c !== played);
  const next = deck[0];
  if (next) newHand.push(next);
  const newDeck = [...deck.slice(1), played]; // played card goes to back of deck
  return { hand: newHand, deck: newDeck };
}
