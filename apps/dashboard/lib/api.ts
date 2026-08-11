/** Typed client for the agent's read-only API (proxied via /agent rewrites). */

export interface AgentStatus {
  symbol: string;
  loopEnabled: boolean;
  killSwitch: boolean;
  cash: number;
  position: { qty: number; avgEntry: number; stop: number | null; openedAt: number | null } | null;
  markPrice: number;
  equity: number;
  lastCandleTs: number | null;
  strategy: { family: string; params: Record<string, number> };
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
  equity: (hours = 720) => get<EquityPointDto[]>(`/agent/equity?hours=${hours}`),
};
