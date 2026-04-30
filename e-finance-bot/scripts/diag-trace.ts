/**
 * CLI rápido para inspecionar bot_turn_traces (BR-BOT-009).
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/diag-trace.ts --recent 10
 *
 *   --session <uuid>            últimos turnos da sessão
 *   --user <chatId>             últimos turnos de um channel_user_id
 *   --tenant <uuid>             últimos turnos do tenant
 *   --since <ISO>               filtrar por created_at >= ISO
 *   --recent <N>                últimos N turnos do bot inteiro (default 20)
 *   --json                      imprime JSON cru em vez do formato legível
 */

import { fetchTraces } from '../src/observability/turn-tracer-query';

interface Args {
  session?: string;
  user?: string;
  tenant?: string;
  since?: string;
  recent: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { recent: 20, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--session') out.session = next();
    else if (a === '--user') out.user = next();
    else if (a === '--tenant') out.tenant = next();
    else if (a === '--since') out.since = next();
    else if (a === '--recent') out.recent = parseInt(next() || '20', 10);
    else if (a === '--json') out.json = true;
  }
  return out;
}

interface Trace {
  created_at: string;
  channel?: string | null;
  channel_user_id?: string | null;
  tenant_id?: string | null;
  session_id?: string | null;
  user_text?: string | null;
  source?: string | null;
  ai_native_source?: string | null;
  intent?: string | null;
  capability?: string | null;
  result?: string | null;
  reply_text?: string | null;
  total_ms?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  cost_cents?: number | null;
  tool_calls?: Array<{ name: string; outcome_kind?: string }> | null;
  error_message?: string | null;
}

function formatTrace(t: Trace): string {
  const lines: string[] = [];
  const ts = t.created_at?.replace('T', ' ').slice(0, 19) || '?';
  const channel = t.channel || '?';
  const user = t.channel_user_id || '?';
  const tenant = t.tenant_id ? t.tenant_id.slice(0, 8) : '?';
  lines.push(`─── ${ts} | ${channel} | tenant=${tenant} | user=${user} ───`);
  lines.push(`  in:    ${t.user_text || '(empty)'}`);
  const path = [t.source, t.ai_native_source].filter(Boolean).join('/');
  const tools = (t.tool_calls || []).map(tc => `${tc.name}(${tc.outcome_kind})`).join(', ');
  lines.push(`  path:  ${path || 'legacy'}${tools ? ` | tools: ${tools}` : ''}`);
  if (t.intent || t.capability) {
    lines.push(`  intent: ${t.intent || '-'} | capability: ${t.capability || '-'}`);
  }
  lines.push(`  out:   ${t.reply_text || '(empty)'}`);
  const metrics: string[] = [];
  if (t.total_ms != null) metrics.push(`${t.total_ms}ms`);
  if (t.tokens_in || t.tokens_out) metrics.push(`tokens=${t.tokens_in || 0}/${t.tokens_out || 0}`);
  if (t.cost_cents) metrics.push(`cost=${t.cost_cents}¢`);
  if (t.result) metrics.push(`result=${t.result}`);
  if (metrics.length > 0) lines.push(`  metrics: ${metrics.join(' | ')}`);
  if (t.error_message) lines.push(`  ERROR: ${t.error_message}`);
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows = await fetchTraces({
    sessionId: args.session,
    channelUserId: args.user,
    tenantId: args.tenant,
    since: args.since,
    limit: args.recent,
  }) as Trace[];

  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log(`Encontrei ${rows.length} turno(s).\n`);
  for (const t of rows) {
    console.log(formatTrace(t));
    console.log('');
  }
}

main().catch(err => {
  console.error('[diag-trace] FATAL:', err);
  process.exit(1);
});
