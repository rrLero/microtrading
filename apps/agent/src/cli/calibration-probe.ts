import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { CalibrationProbeService } from '../trading/calibration-probe.service.js';

/**
 * One §6.3 calibration probe, now:  pnpm calibration-probe
 *
 * Places a tiny buy→sell round trip on the Bybit DEMO venue and journals both
 * legs as demo-fill pairs (probe: true). Use it to verify the probe end to end
 * before trusting the daily cron, and to sanity-check the venue after any
 * key/credential change. Ignores ENABLE_CALIBRATION_PROBE (that flag gates the
 * schedule, not the human), but still respects the kill switch.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  try {
    await app.get(CalibrationProbeService).runOnce('manual');
    console.log('\nProbe finished. Inspect the pair with:  pnpm calibrate-report');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
