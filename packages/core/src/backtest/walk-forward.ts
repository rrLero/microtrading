/**
 * Walk-forward windowing (SPEC §7.2): rolling 18-month train / 6-month test,
 * stepping 6 months. Only concatenated TEST segments count as evidence.
 * All boundaries are UTC month starts.
 */

export interface WalkForwardWindow {
  readonly trainFrom: number;
  readonly trainTo: number; // exclusive
  readonly testFrom: number;
  readonly testTo: number; // exclusive
}

export function addUtcMonths(ts: number, months: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), d.getUTCHours());
}

export function startOfUtcMonth(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function buildWalkForwardWindows(
  dataFrom: number,
  dataTo: number,
  trainMonths = 18,
  testMonths = 6,
  stepMonths = 6,
): WalkForwardWindow[] {
  const windows: WalkForwardWindow[] = [];
  let trainFrom = startOfUtcMonth(dataFrom);
  // First full window must start at a month boundary at/after data start
  if (trainFrom < dataFrom) trainFrom = startOfUtcMonth(addUtcMonths(dataFrom, 1));

  for (;;) {
    const trainTo = addUtcMonths(trainFrom, trainMonths);
    const testTo = addUtcMonths(trainTo, testMonths);
    if (testTo > dataTo) break;
    windows.push({ trainFrom, trainTo, testFrom: trainTo, testTo });
    trainFrom = addUtcMonths(trainFrom, stepMonths);
  }
  return windows;
}
