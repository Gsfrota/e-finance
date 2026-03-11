import { Router, Request, Response } from 'express';
import { config } from '../config';
import { getAllTenantsWithBriefingEnabled, updateBriefingSentAt } from '../actions/bot-config-actions';
import { runMorningBriefingForTenant, isTimeWindowMatch } from './morning-briefing';

export const router = Router();

router.post('/morning-briefing', async (req: Request, res: Response) => {
  const secret = req.headers['x-scheduler-secret'];
  if (!config.scheduler.secret || secret !== config.scheduler.secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const tenantConfigs = await getAllTenantsWithBriefingEnabled();

    const matching = tenantConfigs.filter(c => isTimeWindowMatch(c.morning_briefing_time));

    if (matching.length === 0) {
      return res.json({ dispatched: 0, skipped: tenantConfigs.length, errors: [] });
    }

    const results: Array<{ tenantId: string; sent: number; errors: number }> = [];
    const BRIEFING_COOLDOWN_MS = 23 * 60 * 60 * 1000;
    const now = Date.now();
    let skippedDup = 0;

    for (const tenantConfig of matching) {
      const lastSent = tenantConfig.last_briefing_sent_at
        ? new Date(tenantConfig.last_briefing_sent_at).getTime()
        : 0;

      if (now - lastSent < BRIEFING_COOLDOWN_MS) {
        console.log(
          `[briefing-router] tenant ${tenantConfig.tenant_id} ignorado — briefing já enviado há ${Math.round((now - lastSent) / 60000)} min`
        );
        skippedDup++;
        continue;
      }

      // Stamp BEFORE sending to prevent race on concurrent invocations
      await updateBriefingSentAt(tenantConfig.tenant_id);

      const result = await runMorningBriefingForTenant(
        tenantConfig.tenant_id,
        tenantConfig.morning_briefing_targets
      );
      results.push({ tenantId: tenantConfig.tenant_id, ...result });
    }

    return res.json({
      dispatched: results.reduce((sum, r) => sum + r.sent, 0),
      skipped: tenantConfigs.length - matching.length,
      skippedDuplicate: skippedDup,
      results,
    });
  } catch (err) {
    console.error('[briefing-router] erro:', err);
    return res.status(500).json({ error: 'Erro interno ao disparar briefings' });
  }
});
