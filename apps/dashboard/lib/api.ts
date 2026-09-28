/** Typed client for the agent's read-only API (proxied via /agent rewrites). */

export interface AgentStatus {
  symbol: string;
  loopEnabled: boolean;
  killSwitch: boolean;
  cash: number;
  position: { qty: number; avgEntry: number; stop: number | null; openedAt: number | null } | null;
  markPrice: number;
  equity: number;
  initialCash: number;
  lastCandleTs: number | null;
  strategy: { family: string; params: Record<string, number> };
  channel: {
    upper: number;
    lower: number;
    lastClose4h: number;
    entryLookback: number;
    exitLookback: number;
    toEntryPct: number;
    toExitPct: number;
  } | null;
  costs: { venue: string; takerFeeRate: number; slippageRate: number };
  spread: {
    pairs: number;
    at: string;
    modeledSlippageRate: number;
    worstSymbol: string;
    worstHalfSpreadRate: number;
    worstUtilisation: number;
    breaches: string[];
  } | null;
  health: {
    lastDecisionAt: string | null;
    lastSpreadSampleAt: string | null;
    lastProbeAt: string | null;
    serverNow: string;
  };
}

export interface JournalRow {
  id: number;
  at: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface EquityPointDto {
  ts: number;
  equity: number;
  price: number;
  positionQty: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  status: () => get<AgentStatus>('/agent/status'),
  journal: (limit = 25) => get<JournalRow[]>(`/agent/journal?limit=${limit}`),
  journalKind: (kind: string, limit = 5) => get<JournalRow[]>(`/agent/journal?limit=${limit}&kind=${kind}`),
  equity: (hours = 720) => get<EquityPointDto[]>(`/agent/equity?hours=${hours}`),
};
