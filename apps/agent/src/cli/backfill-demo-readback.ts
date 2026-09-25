import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { asc, inArray } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { DbService } from '../db/db.service.js';
import { journal } from '../db/schema.js';
import { BybitDemoMirrorService } from '../trading/bybit-demo-mirror.service.js';

/**
 * Recover demo fills whose read-back failed:  pnpm backfill-demo-readback
 *
 * Finds demo-fill rows with a null demoAvgPrice, asks the Bybit DEMO order
 * endpoint what the order actually executed at (read-only — places no orders),
 * and appends one 'demo-fill-readback' row per recovered fill, keyed by the
 * demo-fill's journal id. The journal is append-only, so the original row is
 * never touched; calibrate-report overlays the readback. Idempotent: fills that
 * already have a readback row are skipped.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const dbs = app.get(DbService);
    const mirror = app.get(BybitDemoMirrorService);
    const rows = await dbs.db
      .select()
      .from(journal)
      .where(inArray(journal.kind, ['demo-fill', 'demo-fill-readback']))
      .orderBy(asc(journal.id));

    const done = new Set(
      rows.filter((r) => r.kind === 'demo-fill-readback').map((r) => (r.payload as { demoFillId: number }).demoFillId),
    );
    const missing = rows.filter(
      (r) => r.kind === 'demo-fill' && (r.payload as { demoAvgPrice: unknown }).demoAvgPrice === null && !done.has(r.id),
    );
    console.log(`${missing.length} demo fill(s) without price data and no readback yet.`);

    for (const r of missing) {
      const p = r.payload as { demoOrderId: string; symbol: string; side: string };
      const got = await mirror.readbackOrder(String(p.demoOrderId), p.symbol);
      if (!got) {
        console.log(`#${r.id} order ${p.demoOrderId}: not filled on the venue — nothing to recover`);
        continue;
      }
      await dbs.db.insert(journal).values({
        kind: 'demo-fill-readback',
        payload: {
          demoFillId: r.id,
          demoOrderId: p.demoOrderId,
          source: 'order',
          demoAvgPrice: got.avgPrice,
          demoFilledQty: got.filledQty,
          demoFeeUsdc: got.feeUsdc,
          note: 'execution list was empty at mirror time; recovered from the order record',
        },
      });
      console.log(`#${r.id} ${p.side} ${got.filledQty} ${p.symbol} @ ${got.avgPrice} fee ${got.feeUsdc}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
