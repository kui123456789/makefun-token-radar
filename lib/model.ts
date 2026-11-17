// Early Radar — the value model for token-radar-01.
//
// The model turns the sealed snapshot's own figures into one number per
// pre-token protocol: an implied value in whole dollars. It is this entry's
// own claim about what a token would be worth if the protocol's record
// stayed as it is. It never predicts whether or when a token is issued, and
// it never special-cases a protocol by name: every row runs through the
// same five factors, computed only from tvl_usd, change_7d, listed_at,
// chains and category.
//
//   size      = sqrt(tvl_usd / 1e6) * SIZE_USD
//               Square-root scale: doubling TVL lifts the value by ~41%,
//               so a giant protocol does not swallow the board whole, and
//               a $5M protocol still scores in the millions.
//   growth    = 1 + GROWTH_WEIGHT * tanh(clamp(change_7d, -80, 200) / 55)
//               tanh soft-caps the upside (a +200% week is worth at most
//               ~1.85x) and punishes steep falls hard (a -60% week costs
//               ~68% of the value). Missing growth counts as 0%.
//   maturity  = MATURITY_FLOOR + MATURITY_RANGE * sigmoid((age-540)/240)
//               An S-curve in days since listing: a protocol younger than
//               ~6 months scores low (unproven), it rises steeply through
//               year one and two, and flattens after ~3 years. Unknown age
//               counts as 365 days.
//   chains    = 1 + 0.04 * min(chains-1, 6)
//               A small bonus for being live on more chains: multi-chain
//               reach is real distribution, but it never dominates.
//   category  = a risk factor from the category string alone:
//               RWA / payments 1.05, lending / dex / yield 1.00,
//               gaming / social / nft 0.92, derivatives / leveraged 0.90,
//               liquid staking / restaking 0.85, anything else 0.97.
//               Categories are DefiLlama's labels, not our judgement
//               about any single protocol.
//   implied   = max(1, round(size * growth * maturity * chains * category))
//
// Selection: every watchlist slug, plus the 160 highest-scoring pre-token
// protocols below the watchlist floor. A protocol is pre-token when the
// snapshot records no token for it (gecko_id and symbol both null).
// Protocols that already have a token are kept apart as the live set:
// they are shown in the dashboard for contrast and never ranked.
//
// Exclusions: a pre-token record is still not a launch candidate when it
// is a wrapped, staked or bridged product or a centralised exchange — a
// CEX's billions of TVL would otherwise top the board, and a CEX is not
// waiting on a token launch. These are the snapshot README's own watchlist
// exclusions, applied here to the whole board as generic rules over
// category and name shape, never over a slug: excluded categories, a whole
// word wrapped / staked / staking in the name, or a name starting with an
// exchange's name. The watchlist itself was produced by these same rules,
// so all 40 of its slugs pass them.
// One watchlist rule is NOT carried over: the version marker. A versioned
// deployment (a V2 or V3 of a DEX or vault) is still a protocol of its own
// that may issue a token, and the rules say a protocol the watchlist
// leaves out is no worse a subject — so versioned protocols may enter as
// early finds, ranked on their figures like everything else.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  size_usd: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_scale: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_mid_days: number;
  maturity_scale_days: number;
  unknown_age_days: number;
  chain_bonus: number;
  chain_bonus_max: number;
}

export const MODEL: ModelConstants = {
  size_usd: 4_000_000,
  growth_weight: 0.85,
  growth_floor: -80,
  growth_cap: 200,
  growth_scale: 55,
  maturity_floor: 0.55,
  maturity_range: 0.65,
  maturity_mid_days: 540,
  maturity_scale_days: 240,
  unknown_age_days: 365,
  chain_bonus: 0.04,
  chain_bonus_max: 6,
};

export const MODEL_VERSION = 'early-radar-1';
export const BOARD_ROWS = 200;
export const EARLY_ROWS = 160;

export interface Multipliers {
  size: number;
  growth: number;
  maturity: number;
  chains: number;
  category: number;
}

export interface Score {
  implied: number;
  growth_pct: number;
  age_days: number | null;
  mult: Multipliers;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  model: {
    growth_pct: number;
    size_mult: number;
    growth_mult: number;
    maturity_mult: number;
    chain_mult: number;
    category_mult: number;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
}

export interface RadarData {
  meta: {
    model: string;
    as_of: string;
    source: string;
    floor_usd: number;
    board_rows: number;
    watchlist_rows: number;
    early_rows: number;
    pre_token_total: number;
    formula: string;
  };
  rows: BoardRow[];
  live: LiveRow[];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Days from listed_at to as_of; null when the snapshot gives no date. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const d = Math.floor((a - b) / 86_400_000);
  return d < 0 ? 0 : d;
}

/** The category risk factor, from the category label alone. */
export function categoryFactor(category: string | null): number {
  if (category === null) return 0.97;
  const c = category.toLowerCase();
  if (c.includes('rwa') || c.includes('payment')) return 1.05;
  if (c.includes('lending') || c.includes('dex') || c.includes('yield')) return 1.0;
  if (c.includes('gaming') || c.includes('social') || c.includes('nft')) return 0.92;
  if (c.includes('deriv') || c.includes('leverag') || c.includes('option')) return 0.9;
  if (c.includes('liquid staking') || c.includes('restak')) return 0.85;
  return 0.97;
}

/** All five factors and the implied value for one protocol. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, m: ModelConstants = MODEL): Score {
  const size = Math.sqrt(Math.max(p.tvl_usd, 1) / 1_000_000) * m.size_usd;
  const rawGrowth = p.change_7d ?? 0;
  const growthPct = clamp(rawGrowth, m.growth_floor, m.growth_cap);
  const growth = 1 + m.growth_weight * Math.tanh(growthPct / m.growth_scale);
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? m.unknown_age_days;
  const s = 1 / (1 + Math.exp(-(ageForModel - m.maturity_mid_days) / m.maturity_scale_days));
  const maturity = m.maturity_floor + m.maturity_range * s;
  const chains = 1 + m.chain_bonus * Math.min(Math.max(p.chains.length - 1, 0), m.chain_bonus_max);
  const category = categoryFactor(p.category);
  const implied = Math.max(1, Math.round(size * growth * maturity * chains * category));
  return { implied, growth_pct: growthPct, age_days: age, mult: { size, growth, maturity, chains, category } };
}

/** True when the snapshot records no token for the protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set([
  'bridge',
  'canonical bridge',
  'liquid staking',
  'liquid restaking',
  'restaked btc',
  'cex',
]);

const EXCHANGE_PREFIXES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** True when the protocol is a wrapped/staked/bridged product or a CEX. */
export function isExcluded(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category.toLowerCase())) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  const lower = p.name.toLowerCase();
  for (const prefix of EXCHANGE_PREFIXES) if (lower.startsWith(prefix)) return true;
  return false;
}

/** True when the protocol is a genuine launch candidate: pre-token and not excluded. */
export function isCandidate(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isExcluded(p);
}

// ---------------------------------------------------------------- farm plans

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Position size from TVL: bigger protocols get bigger tickets. */
function ticketFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 2000;
  if (tvl >= 100_000_000) return 1000;
  if (tvl >= 10_000_000) return 500;
  return 250;
}

/** How long to keep farming, from the protocol's age. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 540) return 60;
  return 30;
}

function mainChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

function actionVerb(category: string | null): string {
  if (category === null) return 'use the protocol';
  const c = category.toLowerCase();
  if (c.includes('dex')) return 'swap and add liquidity';
  if (c.includes('lending')) return 'supply assets and borrow a small amount';
  if (c.includes('yield') || c.includes('farm')) return 'deposit into the main vault';
  if (c.includes('deriv') || c.includes('leverag')) return 'open a small hedged position';
  if (c.includes('rwa')) return 'take a position in the tokenised asset';
  if (c.includes('bridge')) return 'bridge assets through the protocol';
  if (c.includes('gaming')) return 'play and stake in-game assets';
  if (c.includes('liquid staking') || c.includes('restak')) return 'stake and hold the receipt token';
  if (c.includes('payment')) return 'pay and settle through the protocol';
  return 'use the protocol';
}

/**
 * Six concrete farm steps, generated from the protocol's own record:
 * category, chains, TVL and age. Each step names what to do, what it
 * costs and how long it takes. Nothing here names a token that does not
 * exist yet, and nothing promises an airdrop.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const ticket = ticketFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const chain = mainChain(p);
  const verb = actionVerb(p.category);
  const extra = p.chains.length > 1 ? ` Also try the same flow on ${p.chains[1]} once, so the activity is not single-chain.` : '';
  return [
    `Set up a fresh wallet, fund it with ${money(ticket)} plus about $25 for gas on ${chain}, and write the seed phrase down offline; never paste it anywhere.`,
    `Go to ${p.name} on ${chain} and ${verb} with ${money(ticket)}; expect $3 to $15 in gas and slippage on the first transaction, and keep the receipt.`,
    `Repeat the core action once a week for ${hold} days, changing the amount by 10 to 20 percent each time so the activity reads as real use, not a script.${extra}`,
    `Use a second feature of ${p.name} at least twice inside the ${hold}-day window, such as its staking, vault or governance page, and vote or stake if it offers one.`,
    `Check the position every week; if total value locked falls more than 20 percent in a week, halve the position to ${money(ticket / 2)} and wait a week before adding more.`,
    `Before any claim, open ${p.name}'s points or rewards page from its own site and claim only from the link it publishes; read every transaction in the wallet before signing it.`,
  ];
}

// ---------------------------------------------------------------- board build

export function buildBoard(snapshot: Snapshot, m: ModelConstants = MODEL): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = snapshot.watchlist.map((s) => bySlug.get(s)).filter((p): p is SnapshotProtocol => p !== undefined);
  const pre = snapshot.protocols.filter((p) => isCandidate(p));
  const watchSet = new Set(snapshot.watchlist);
  const early = pre
    .filter((p) => !watchSet.has(p.slug))
    .map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of, m) }))
    .sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, EARLY_ROWS)
    .map((x) => x.p);
  const chosen = [...watch, ...early];
  const scored = chosen.map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of, m) }));
  scored.sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : 1));
  // Force strictly decreasing implied values so the ranking is a ranking.
  let prev = Number.POSITIVE_INFINITY;
  return scored.map((s, i) => {
    let implied = s.score.implied;
    if (implied >= prev) implied = prev - 1;
    if (implied < 1) implied = 1;
    prev = implied;
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: implied,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_days: s.score.age_days,
      watchlist: watchSet.has(s.p.slug),
      model: {
        growth_pct: s.score.growth_pct,
        size_mult: round4(s.score.mult.size),
        growth_mult: round4(s.score.mult.growth),
        maturity_mult: round4(s.score.mult.maturity),
        chain_mult: round4(s.score.mult.chains),
        category_mult: round4(s.score.mult.category),
      },
      farm_steps: farmSteps(s.p, s.score.age_days),
    };
  });
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (b.tvl_usd - a.tvl_usd))
    .slice(0, 30)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
    }));
}

export function buildRadar(snapshot: Snapshot, m: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, m);
  const radar: RadarData = {
    meta: {
      model: MODEL_VERSION,
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      board_rows: board.length,
      watchlist_rows: board.filter((r) => r.watchlist).length,
      early_rows: board.filter((r) => !r.watchlist).length,
      pre_token_total: snapshot.protocols.filter(isPreToken).length,
      formula:
        'implied = sqrt(TVL/1M) x $4,000,000 x (1 + 0.85 x tanh(clamped 7d change / 55)) x (0.55 + 0.65 x sigmoid((age-540)/240)) x chain factor x category factor',
    },
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The dashboard's data file: one global, no network, no imports. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

// ---------------------------------------------------------------- validation

export function parseSnapshot(text: string): Snapshot {
  const d = JSON.parse(text) as Snapshot;
  if (typeof d !== 'object' || d === null) throw new Error('snapshot is not an object');
  if (!Array.isArray(d.protocols) || !Array.isArray(d.watchlist)) throw new Error('snapshot lacks protocols or watchlist');
  if (typeof d.as_of !== 'string' || typeof d.floor_usd !== 'number') throw new Error('snapshot lacks as_of or floor_usd');
  return d;
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, need 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (!slugs.has(r.slug)) return `row ${i + 1} names ${r.slug}, not in the snapshot`;
    if (seen.has(r.slug)) return `row ${i + 1} repeats ${r.slug}`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `row ${i + 1} has rank ${r.rank}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (i > 0 && r.implied_value_usd >= board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
    if (!r.name) return `row ${i + 1} has no name`;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'all rows share the same implied value';
  }
  for (const s of snapshot.watchlist) if (!seen.has(s)) return `watchlist slug ${s} is missing from the board`;
  return null;
}
