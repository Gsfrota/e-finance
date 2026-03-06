import { Router, Request, Response } from 'express';
import { config } from '../config';
import { getAllTenantsWithBriefingEnabled } from '../actions/bot-config-actions';
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

    for (const tenantConfig of matching) {
      const result = await runMorningBriefingForTenant(
        tenantConfig.tenant_id,
        tenantConfig.morning_briefing_targets
      );
      results.push({ tenantId: tenantConfig.tenant_id, ...result });
    }

    return res.json({
      dispatched: results.reduce((sum, r) => sum + r.sent, 0),
      skipped: tenantConfigs.length - matching.length,
      results,
    });
  } catch (err) {
    console.error('[briefing-router] erro:', err);
    return res.status(500).json({ error: 'Erro interno ao disparar briefings' });
  }
});
