import ccxt from 'ccxt';

/**
 * Connectivity check for the §6.3 mirror:  pnpm demo-ping
 * Verifies the Bybit DEMO keys authenticate (api-demo.bybit.com), the market
 * exists, and prints demo balances. Read-only — places no orders.
 */
async function main(): Promise<void> {
  const apiKey = process.env['BYBIT_DEMO_API_KEY'];
  const secret = process.env['BYBIT_DEMO_API_SECRET'];
  if (!apiKey || !secret) {
    console.error('BYBIT_DEMO_API_KEY / BYBIT_DEMO_API_SECRET not set in .env');
    process.exitCode = 1;
    return;
  }
  const symbol = process.env['SYMBOL'] ?? 'BTC/USDC';
  const ex = new ccxt.bybit({ apiKey, secret, enableRateLimit: true, options: { defaultType: 'spot' } });
  (ex as unknown as { enableDemoTrading: (on: boolean) => void }).enableDemoTrading(true);
  await ex.loadMarkets();
  const market = ex.markets?.[symbol];
  console.log(`Demo venue reachable. Market ${symbol}: ${market ? 'available' : 'NOT FOUND — check symbol on Bybit demo spot'}`);
  if (market?.limits?.amount?.min) console.log(`Min order qty: ${market.limits.amount.min}`);
  const bal = await ex.fetchBalance();
  const show = ['USDC', 'USDT', 'BTC'];
  for (const c of show) {
    const total = (bal.total as unknown as Record<string, number | undefined> | undefined)?.[c];
    if (total !== undefined) console.log(`Demo balance ${c}: ${total}`);
  }
  console.log('\nKeys OK — the mirror will activate on the next fresh paper fill.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
