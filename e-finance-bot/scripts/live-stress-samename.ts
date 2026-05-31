/**
 * Live Stress — nomes idênticos (erro humano / ambiguidade).
 *
 * Cria tenant/admin descartável, cria DOIS contratos para devedores de MESMO NOME
 * ("João Silva") com CPFs diferentes e a mesma dívida, e então testa:
 *   (1) "quanto o João Silva deve"        → deve DESAMBIGUAR (lista com CPF)
 *   (2) "baixar a parcela ... do João Silva" → observa se desambigua ou pega 1 silenciosamente
 * Cruza o nº de perfis no Supabase e apaga tudo no finally.
 *
 *   set -a; . ./.env; set +a; npx tsx scripts/live-stress-samename.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { handleMessage } from "../src/handlers/message-handler";
import { getInstallmentByDebtorAndMonth } from "../src/actions/admin-actions";
import { routeIntent } from "../src/ai/intent-router";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes (carregue o .env)");
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Dois CPFs válidos distintos (dígitos verificadores corretos).
const CPF_A = "529.982.247-25";
const CPF_B = "111.444.777-35";
const SAME_NAME = "João Silva";

async function main() {
  const now = Date.now();
  const suffix = `${now}`.slice(-6);
  const email = `bot.stress.${now}@example.com`;
  const fullName = `Bot Stress Admin ${suffix}`;
  const linkCode = `ST${suffix.slice(-4)}`.toUpperCase();
  const channelUserId = `telegram-stress-${suffix}`;

  let authUserId: string | null = null;
  let tenantId: string | null = null;
  let profileId: string | null = null;
  const transcript: { role: "user" | "bot"; text: string }[] = [];
  let step = 0;

  const ask = async (text: string): Promise<string> => {
    step += 1;
    transcript.push({ role: "user", text });
    let replyText: string;
    try {
      const out = await handleMessage({
        messageId: `stress-${suffix}-${step}`, channel: "telegram",
        channelUserId, senderName: fullName, text,
      });
      replyText = out.text;
    } catch (e: any) {
      replyText = `__EXCEPTION__ ${e?.message || String(e)}`;
    }
    transcript.push({ role: "bot", text: replyText });
    return replyText;
  };

  try {
    const { data: createdUser, error: createUserError } = await sb.auth.admin.createUser({
      email, password: `Temp#${randomUUID().slice(0, 12)}`, email_confirm: true,
      user_metadata: { full_name: fullName, company_name: `Bot Stress Tenant ${suffix}` },
    });
    if (createUserError || !createdUser?.user) throw new Error(`auth user: ${createUserError?.message}`);
    authUserId = createdUser.user.id;
    await sleep(1200);

    const { data: profile } = await sb.from("profiles").select("id, tenant_id").eq("id", authUserId).single();
    profileId = String(profile!.id);
    tenantId = String(profile!.tenant_id);
    await sb.from("bot_link_codes").insert({
      code: linkCode, channel: "telegram", profile_id: profileId,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    await ask("/start");
    await ask(linkCode);

    // --- Cria 2 contratos, MESMO NOME, CPFs diferentes ---
    await ask(`Empréstimo para ${SAME_NAME}, CPF ${CPF_A}, 1000 reais, 5% ao mês, 2 parcelas, mensal todo dia 10`);
    const c1 = await ask("sim");
    await ask(`Empréstimo para ${SAME_NAME}, CPF ${CPF_B}, 1000 reais, 5% ao mês, 2 parcelas, mensal todo dia 10`);
    const c2 = await ask("sim");
    const id1 = c1.match(/Contrato #(\d+)/i)?.[1] ?? null;
    const id2 = c2.match(/Contrato #(\d+)/i)?.[1] ?? null;

    // --- Cruza perfis no banco ---
    const { data: profiles } = await sb
      .from("profiles").select("id, full_name, cpf").eq("tenant_id", tenantId).eq("role", "debtor");
    const sameNameProfiles = (profiles || []).filter((p: any) => String(p.full_name).includes("João"));

    // --- DIAGNÓSTICO: chama a função direto (isola função vs roteamento LLM) ---
    const { data: instRows } = await sb
      .from("loan_installments").select("due_date, status, investment_id").eq("tenant_id", tenantId).order("due_date");
    const directJune = await getInstallmentByDebtorAndMonth(tenantId!, SAME_NAME, 6);
    const directJuly = await getInstallmentByDebtorAndMonth(tenantId!, SAME_NAME, 7);
    const routed = await routeIntent(`baixar a parcela de junho do ${SAME_NAME}`, []);
    const diag = {
      routedIntent: routed.intent,
      routedEntities: routed.normalizedEntities,
      installmentDueDates: (instRows || []).map((r: any) => r.due_date),
      directJune_kind: (directJune as any)?.ambiguousDebtors ? `ambiguous(${(directJune as any).ambiguousDebtors.length})` : directJune ? `resolved(${directJune.installments.length})` : "null",
      directJuly_kind: (directJuly as any)?.ambiguousDebtors ? `ambiguous(${(directJuly as any).ambiguousDebtors.length})` : directJuly ? `resolved(${directJuly.installments.length})` : "null",
    };

    // --- (2) Baixa por nome+mês COM histórico cheio (LLM tende a injetar
    // contract_id) — BOT-007 deve desambiguar a pessoa mesmo assim ---
    const baixaReply = await ask(`baixar a parcela de junho do ${SAME_NAME}`);

    // --- (1) Saldo por nome → espera DESAMBIGUAÇÃO ---
    const balanceReply = await ask(`quanto o ${SAME_NAME} deve`);

    const summary = {
      tenantId, id1, id2, diag,
      profilesSameName: sameNameProfiles.length,
      profilesDetail: sameNameProfiles.map((p: any) => ({ name: p.full_name, cpf: String(p.cpf).slice(-2) })),
      analysis: {
        criou_dois_perfis_distintos: sameNameProfiles.length === 2,
        saldo_desambigua: /Encontrei (mais de um|estes|vários)|qual( deles)?|CPF|escolha|\*1\*.*\*2\*/i.test(balanceReply),
        baixa_desambigua: /Encontrei (mais de um|estes|vários)|qual( deles)?|dois clientes|CPF/i.test(baixaReply),
      },
      balanceReply: balanceReply.slice(0, 400),
      baixaReply: baixaReply.slice(0, 400),
      transcript,
    };
    console.log("__STRESS_SUMMARY_START__");
    console.log(JSON.stringify(summary, null, 2));
    console.log("__STRESS_SUMMARY_END__");
  } finally {
    if (channelUserId) {
      const { data: sessions } = await sb.from("bot_sessions").select("id")
        .eq("channel", "telegram").eq("channel_user_id", channelUserId);
      const ids = (sessions || []).map((s: any) => s.id);
      if (ids.length) await sb.from("bot_messages").delete().in("session_id", ids);
      await sb.from("bot_sessions").delete().eq("channel", "telegram").eq("channel_user_id", channelUserId);
    }
    if (profileId) await sb.from("bot_link_codes").delete().eq("profile_id", profileId);
    if (tenantId) {
      await sb.from("loan_installments").delete().eq("tenant_id", tenantId);
      await sb.from("payment_transactions").delete().eq("tenant_id", tenantId);
      await sb.from("investments").delete().eq("tenant_id", tenantId);
      await sb.from("profiles").delete().eq("tenant_id", tenantId);
      await sb.from("companies").delete().eq("tenant_id", tenantId);
      await sb.from("tenants").delete().eq("id", tenantId);
    }
    if (authUserId) await sb.auth.admin.deleteUser(authUserId);
    console.log("[cleanup] tenant stress removido");
  }
}

main().catch((err: any) => {
  console.error("__STRESS_ERROR__", err?.stack || err?.message || String(err));
  process.exit(1);
});
