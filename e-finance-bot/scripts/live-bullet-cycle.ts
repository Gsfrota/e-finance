/**
 * Live Bullet Cycle — valida BOT-005 ponta-a-ponta contra Gemini + Supabase REAIS.
 *
 * Cria tenant/admin descartável, cria um contrato BULLET (juros simples) por
 * linguagem natural, dá baixa por ROLAGEM (só juros) e depois QUITA (settlement),
 * cruzando o estado no Supabase a cada passo. Apaga tudo no finally.
 *
 *   set -a; . ./.env; set +a; npx tsx scripts/live-bullet-cycle.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { handleMessage } from "../src/handlers/message-handler";

type TranscriptEntry = { role: "user" | "bot"; text: string; ms?: number };
type CheckResult = { label: string; ok: boolean; detail: string };

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes (carregue o .env)");
}
if (!process.env.GEMINI_API_KEY) {
  console.warn("[warn] GEMINI_API_KEY ausente — roteamento cai só em regras");
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const now = Date.now();
  const suffix = `${now}`.slice(-6);
  const email = `bot.bullet.${now}@example.com`;
  const password = `Temp#${randomUUID().slice(0, 12)}`;
  const fullName = `Bot Bullet Admin ${suffix}`;
  const linkCode = `BL${suffix.slice(-4)}`.toUpperCase();
  const channelUserId = `telegram-bullet-${suffix}`;

  let authUserId: string | null = null;
  let tenantId: string | null = null;
  let profileId: string | null = null;
  const transcript: TranscriptEntry[] = [];
  const checks: CheckResult[] = [];
  let step = 0;

  const ask = async (text: string): Promise<string> => {
    step += 1;
    transcript.push({ role: "user", text });
    const t0 = Date.now();
    let replyText: string;
    try {
      const out = await handleMessage({
        messageId: `bullet-${suffix}-${step}`,
        channel: "telegram",
        channelUserId,
        senderName: fullName,
        text,
      });
      replyText = out.text;
    } catch (e: any) {
      replyText = `__EXCEPTION__ ${e?.message || String(e)}`;
    }
    const ms = Date.now() - t0;
    transcript.push({ role: "bot", text: replyText, ms });
    return replyText;
  };

  const check = (label: string, ok: boolean, detail: string) => {
    checks.push({ label, ok, detail });
  };

  const isBulletModePrompt = (reply: string) => /juros simples|rolagem|quitar/i.test(reply);

  const requestBulletModePrompt = async (contractId: string): Promise<{ reply: string; path: "direct" | "selection" }> => {
    const initialReply = await ask(`baixar contrato ${contractId}`);
    if (isBulletModePrompt(initialReply)) {
      return { reply: initialReply, path: "direct" };
    }

    // Path-aware: o caminho capability/legado pode listar parcelas e exigir seleção.
    // No AI-native, "baixar contrato" já costuma abrir a escolha juros/quitar; enviar
    // um "1" extra nesse caso torna o teste flaky porque o LLM interpreta outro turno.
    const selectionReply = await ask("1");
    return { reply: selectionReply, path: "selection" };
  };

  try {
    const { data: createdUser, error: createUserError } = await sb.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: fullName, company_name: `Bot Bullet Tenant ${suffix}` },
    });
    if (createUserError || !createdUser?.user) {
      throw new Error(`Falha ao criar auth user: ${createUserError?.message || "sem usuário"}`);
    }
    authUserId = createdUser.user.id;
    await sleep(1200);

    const { data: profile, error: profileError } = await sb
      .from("profiles").select("id, tenant_id").eq("id", authUserId).single();
    if (profileError || !profile) {
      throw new Error(`Falha ao carregar profile: ${profileError?.message || "não encontrado"}`);
    }
    profileId = String(profile.id);
    tenantId = String(profile.tenant_id);

    await sb.from("bot_link_codes").insert({
      code: linkCode, channel: "telegram", profile_id: profileId,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    // BOT-008: liga ai_enabled p/ exercitar o caminho AI-native quando
    // AI_NATIVE_ENABLED=true (defaults preenchem as demais colunas NOT NULL).
    const { error: cfgErr } = await sb.from("bot_tenant_config").insert({ tenant_id: tenantId, ai_enabled: true });
    if (cfgErr) console.warn("[warn] bot_tenant_config insert:", cfgErr.message);
    console.log(`[info] AI_NATIVE_ENABLED=${process.env.AI_NATIVE_ENABLED || "(off)"}`);

    // ---- Vincular conta ----
    await ask("/start");
    await ask(linkCode);

    // ---- 1) Criar contrato BULLET por linguagem natural ----
    const createReply = await ask(
      "Empréstimo só juros para Icaro Soares, CPF 529.982.247-25, 5000 reais, 10% ao mês, mensal todo dia 10",
    );
    check("criar-bullet-confirma", /Juros simples|prazo indeterminado/i.test(createReply),
      createReply.slice(0, 200));

    const confirmReply = await ask("sim");
    const contractId = confirmReply.match(/Contrato #(\d+)/i)?.[1] ?? null;
    check("criar-bullet-criado", Boolean(contractId), confirmReply.slice(0, 200));

    // ---- Cross-check criação no Supabase ----
    let investmentId: string | null = null;
    if (contractId) {
      const { data: inv } = await sb
        .from("investments")
        .select("id, calculation_mode, current_value, installment_value, remaining_balance, total_installments, status")
        .eq("tenant_id", tenantId)
        .eq("id", contractId)
        .maybeSingle();
      investmentId = inv ? String((inv as any).id) : null;
      check("db-bullet-calculation_mode", (inv as any)?.calculation_mode === "interest_only",
        `calculation_mode=${(inv as any)?.calculation_mode}`);
      check("db-bullet-installment_value-500", Number((inv as any)?.installment_value) === 500,
        `installment_value=${(inv as any)?.installment_value}`);
      check("db-bullet-remaining-5000",
        Number((inv as any)?.remaining_balance ?? (inv as any)?.current_value) === 5000,
        `remaining=${(inv as any)?.remaining_balance} current=${(inv as any)?.current_value}`);
    }

    // ---- 2) Baixa por ROLAGEM (só juros) ----
    if (contractId) {
      const modePrompt = await requestBulletModePrompt(contractId);
      check("baixa-bullet-pergunta-modo", isBulletModePrompt(modePrompt.reply),
        `path=${modePrompt.path} ${modePrompt.reply.slice(0, 200)}`);
      await ask("juros");
      const rolloverReply = await ask("sim");
      check("baixa-bullet-rolagem-ok", /Pagamento confirmado|Rolagem/i.test(rolloverReply),
        rolloverReply.slice(0, 200));

      if (investmentId) {
        const { data: invAfter } = await sb
          .from("investments").select("remaining_balance, status").eq("id", investmentId).maybeSingle();
        check("db-rolagem-mantem-saldo",
          Number((invAfter as any)?.remaining_balance) === 5000 && (invAfter as any)?.status === "active",
          `remaining=${(invAfter as any)?.remaining_balance} status=${(invAfter as any)?.status}`);
        const { count: paidCount } = await sb
          .from("loan_installments").select("id", { count: "exact", head: true })
          .eq("investment_id", investmentId).eq("status", "paid");
        check("db-rolagem-parcela-paga", Number(paidCount || 0) >= 1, `parcelas pagas=${paidCount}`);
      }

      // ---- 3) QUITAÇÃO (settlement) na próxima parcela ----
      const settleModePrompt = await requestBulletModePrompt(contractId);
      check("baixa-bullet-pergunta-modo-quitacao", isBulletModePrompt(settleModePrompt.reply),
        `path=${settleModePrompt.path} ${settleModePrompt.reply.slice(0, 200)}`);
      await ask("quitar");
      const settleReply = await ask("sim");
      check("baixa-bullet-quita-ok", /quitado|encerrado|Pagamento confirmado/i.test(settleReply),
        settleReply.slice(0, 200));

      if (investmentId) {
        const { data: invFinal } = await sb
          .from("investments").select("remaining_balance, status").eq("id", investmentId).maybeSingle();
        check("db-quitacao-encerra",
          Number((invFinal as any)?.remaining_balance) === 0 && (invFinal as any)?.status === "completed",
          `remaining=${(invFinal as any)?.remaining_balance} status=${(invFinal as any)?.status}`);
      }
    }

    const summary = {
      ranAt: new Date().toISOString(),
      tenantId, contractId,
      checks: { total: checks.length, passed: checks.filter((c) => c.ok).length, results: checks },
      transcript,
    };
    console.log("__BULLET_SUMMARY_START__");
    console.log(JSON.stringify(summary, null, 2));
    console.log("__BULLET_SUMMARY_END__");
  } finally {
    const cleanupErrors: string[] = [];
    const cleanup = async (label: string, operation: PromiseLike<{ error: any }>) => {
      const { error } = await operation;
      if (error) cleanupErrors.push(`${label}: ${error.message || String(error)}`);
    };

    if (channelUserId) {
      const { data: sessions, error: sessionsError } = await sb
        .from("bot_sessions").select("id").eq("channel", "telegram").eq("channel_user_id", channelUserId);
      if (sessionsError) cleanupErrors.push(`bot_sessions select: ${sessionsError.message}`);
      const sessionIds = (sessions || []).map((s: any) => s.id);
      if (sessionIds.length) await cleanup("bot_messages", sb.from("bot_messages").delete().in("session_id", sessionIds));
      await cleanup("bot_sessions", sb.from("bot_sessions").delete().eq("channel", "telegram").eq("channel_user_id", channelUserId));
    }
    if (profileId) await cleanup("bot_link_codes", sb.from("bot_link_codes").delete().eq("profile_id", profileId));
    if (tenantId) {
      // audit_events referencia tenants/investments/installments/payment_transactions;
      // precisa sair antes das tabelas financeiras para não mascarar cleanup com FK.
      await cleanup("audit_events", sb.from("audit_events").delete().eq("tenant_id", tenantId));
      await cleanup("bot_tenant_config", sb.from("bot_tenant_config").delete().eq("tenant_id", tenantId));
      await cleanup("loan_installments", sb.from("loan_installments").delete().eq("tenant_id", tenantId));
      await cleanup("payment_transactions", sb.from("payment_transactions").delete().eq("tenant_id", tenantId));
      await cleanup("investments", sb.from("investments").delete().eq("tenant_id", tenantId));
      await cleanup("profiles", sb.from("profiles").delete().eq("tenant_id", tenantId));
      await cleanup("companies", sb.from("companies").delete().eq("tenant_id", tenantId));
      await cleanup("tenants", sb.from("tenants").delete().eq("id", tenantId));
    }
    if (authUserId) {
      const { error } = await sb.auth.admin.deleteUser(authUserId);
      if (error) cleanupErrors.push(`auth.users: ${error.message || String(error)}`);
    }

    if (cleanupErrors.length > 0) {
      console.error("[cleanup] falhou; tenant descartável pode ter resíduos:");
      for (const error of cleanupErrors) console.error(`  - ${error}`);
      process.exitCode = 1;
    } else {
      console.log("[cleanup] tenant bullet descartável removido");
    }
  }
}

main().catch((err: any) => {
  console.error("__BULLET_ERROR_START__");
  console.error(err?.stack || err?.message || String(err));
  console.error("__BULLET_ERROR_END__");
  process.exit(1);
});
