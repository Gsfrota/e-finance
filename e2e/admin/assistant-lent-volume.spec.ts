import { test, expect } from '@playwright/test';
import {
  getCtx,
  restCall,
  resolveScope,
  waitForApp,
  navigateToView,
  ymdBR,
  midnightBR,
} from '../fixtures/e2e-test-helpers';

/**
 * BR-BOT-009 — o Assistente responde "quanto emprestei essa semana" com número do banco.
 *
 * O valor esperado é calculado AQUI a partir da regra escrita (janela em BRT, soma de
 * amount_invested por created_at, renovações e status inclusos) lendo o banco pela REST —
 * caminho independente do código do app que está sob teste. Se alguém trocar `created_at`
 * por `start_date`, quebrar o fuso, filtrar renovação/status ou vazar tenant, os números
 * divergem e este teste cai.
 *
 * NÃO escreve no banco: o tenant de QA vive em produção. As bordas de janela (limite de
 * 1 segundo, virada de semana) são cobertas por tests/unit/assistantEngine.test.ts.
 */

const brl = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

test('Assistente responde o volume emprestado da semana com o número do banco (BR-BOT-009)', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page, { requireSidebar: true });

  const ctx = await getCtx(page);
  expect(ctx, 'sem credenciais do Supabase na página — env-config.js não injetado').not.toBeNull();

  const { tenantId, companyId } = await resolveScope(ctx!);
  expect(tenantId, 'admin de teste sem tenant_id').toBeTruthy();

  // --- ORÁCULO: calculado da regra, antes de olhar a tela ---
  const hoje = ymdBR(new Date());
  const weekday = new Date(`${hoje}T00:00:00Z`).getUTCDay(); // 0 = domingo
  const inicioSemana = midnightBR(hoje, -((weekday + 6) % 7)); // segunda
  const inicio7Dias = midnightBR(hoje, -6);
  const fimDeHoje = midnightBR(hoje, 1); // exclusivo

  const maisAntigo = inicioSemana < inicio7Dias ? inicioSemana : inicio7Dias;
  const filtroEmpresa = companyId ? `&company_id=eq.${companyId}` : '';
  const rows: Array<{ amount_invested: string | number; created_at: string }> = await restCall(
    ctx!,
    `investments?select=amount_invested,created_at` +
      `&tenant_id=eq.${tenantId}${filtroEmpresa}` +
      `&created_at=gte.${maisAntigo.toISOString()}&created_at=lt.${fimDeHoje.toISOString()}`,
  );

  const somar = (desde: Date) => {
    const dentro = rows.filter((r) => {
      const at = Date.parse(r.created_at);
      return at >= desde.getTime() && at < fimDeHoje.getTime();
    });
    const total = dentro.reduce((acc, r) => acc + Number(r.amount_invested ?? 0), 0);
    return { total: Math.round(total * 100) / 100, count: dentro.length };
  };

  const esperadoSemana = somar(inicioSemana);
  const esperado7Dias = somar(inicio7Dias);

  /**
   * Outros specs criam e apagam contratos no mesmo tenant enquanto este roda (workers em
   * paralelo), então o banco pode mudar entre o oráculo e a leitura da tela. Relemos depois
   * e aceitamos qualquer um dos dois retratos: uma escrita concorrente muda o total em
   * centenas de reais, enquanto um bug de campo/fuso/escopo não bate com nenhum dos dois.
   */
  const lerNovamente = async () => {
    const atuais: typeof rows = await restCall(
      ctx!,
      `investments?select=amount_invested,created_at` +
        `&tenant_id=eq.${tenantId}${filtroEmpresa}` +
        `&created_at=gte.${maisAntigo.toISOString()}&created_at=lt.${fimDeHoje.toISOString()}`,
    );
    rows.length = 0;
    rows.push(...atuais);
    return { semana: somar(inicioSemana), sete: somar(inicio7Dias) };
  };

  // --- A tela ---
  await navigateToView(page, 'Assistente');
  const input = page.locator('textarea').first();
  await input.click();
  await input.fill('quanto emprestei essa semana?');
  await page.keyboard.press('Enter');

  const balao = page.getByText('Volume emprestado', { exact: false });
  await balao.waitFor({ timeout: 15_000 });
  // NBSP do Intl vira espaço normal para a comparação de texto
  const resposta = (await balao.innerText()).replace(/ /g, ' ');

  // --- Comparação ---
  const depois = await lerNovamente();

  const confere = (esperado: { total: number; count: number }) => {
    if (esperado.count === 0) return resposta.includes('Nenhum contrato cadastrado nesse período');
    const plural = esperado.count === 1 ? 'contrato' : 'contratos';
    return resposta.includes(
      `${brl(esperado.total).replace(/ /g, ' ')} em ${esperado.count} ${plural}`,
    );
  };

  for (const [rotulo, antes, agora] of [
    ['semana corrente', esperadoSemana, depois.semana],
    ['últimos 7 dias', esperado7Dias, depois.sete],
  ] as const) {
    expect(
      confere(antes) || confere(agora),
      `${rotulo}: resposta não bate com o banco — esperado ${brl(antes.total)} em ${antes.count} contrato(s)` +
        ` (ou ${brl(agora.total)} em ${agora.count} após escrita concorrente). Resposta: ${resposta}`,
    ).toBe(true);
  }

  // Pergunta fora do escopo não pode inventar número (BR-BOT-009, exceções)
  await input.fill('qual a cotação do dólar?');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Não entendi a pergunta.')).toBeVisible({ timeout: 10_000 });
});
