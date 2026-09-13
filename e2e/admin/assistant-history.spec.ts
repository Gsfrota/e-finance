import { test, expect } from '@playwright/test';
import { getCtx, restCall, resolveScope, waitForApp, navigateToView } from '../fixtures/e2e-test-helpers';

/**
 * BR-BOT-012 — conversas do Assistente ficam salvas e podem ser reabertas.
 *
 * Escreve no banco (é o recurso em teste), então cada conversa criada leva uma
 * marca única no título e é apagada no fim — inclusive se o teste cair no meio.
 * O tenant de QA vive em produção.
 */

const marca = `e2e-hist-${Date.now()}`;

test.afterEach(async ({ page }) => {
  // rede de segurança: a UI já apaga no caminho feliz, isto cobre a falha no meio
  const ctx = await getCtx(page).catch(() => null);
  if (!ctx) return;
  await restCall(ctx, `assistant_conversations?title=like.*${marca}*`, 'DELETE').catch(
    () => undefined,
  );
});

test('Conversas do Assistente sobrevivem a "nova conversa" e podem ser reabertas (BR-BOT-012)', async ({
  page,
}) => {
  await page.goto('/');
  await waitForApp(page, { requireSidebar: true });

  const ctx = await getCtx(page);
  expect(ctx, 'sem credenciais do Supabase na página — env-config.js não injetado').not.toBeNull();
  const { tenantId } = await resolveScope(ctx!);
  expect(tenantId, 'admin de teste sem tenant_id').toBeTruthy();

  await navigateToView(page, 'Assistente');
  const input = page.locator('textarea').first();
  const baloes = page.getByTestId('chat-msg-assistant');

  // começa limpo para não herdar a conversa de outro teste
  await page.getByTestId('nova-conversa').click();
  await expect(baloes).toHaveCount(0);

  // a marca entra na pergunta: vira o título da conversa e me deixa achá-la depois
  await input.click();
  await input.fill(`${marca} quem está atrasado?`);
  await page.keyboard.press('Enter');
  await expect(baloes).toHaveCount(1, { timeout: 20_000 });
  const respostaOriginal = await baloes.first().innerText();

  // o salvamento é assíncrono: a conversa só existe depois de gravar
  await expect
    .poll(
      async () =>
        (
          await restCall(
            ctx!,
            `assistant_conversations?select=id,title&title=like.*${marca}*`,
          )
        ).length,
      { message: 'a conversa não foi gravada no banco', timeout: 15_000 },
    )
    .toBe(1);

  // "nova conversa" limpa a tela sem apagar a anterior
  await page.getByTestId('nova-conversa').click();
  await expect(baloes).toHaveCount(0);

  await page.getByTestId('abrir-historico').click();
  const item = page.getByTestId('conversa-item').filter({ hasText: marca });
  await expect(item, 'a conversa salva não apareceu na lista').toHaveCount(1);

  // reabrir traz a conversa inteira de volta, detalhamento incluso
  await item.click();
  await expect(baloes).toHaveCount(1, { timeout: 15_000 });
  expect(await baloes.first().innerText()).toBe(respostaOriginal);
  expect(
    await baloes.first().getByTestId('reply-line').count(),
    'o detalhamento não sobreviveu à ida e volta do banco',
  ).toBeGreaterThan(0);

  // apagar some da lista e do banco
  await page.getByTestId('abrir-historico').click();
  await page.getByRole('button', { name: new RegExp(`Apagar conversa .*${marca}`) }).click();
  await expect(page.getByTestId('conversa-item').filter({ hasText: marca })).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await restCall(ctx!, `assistant_conversations?select=id&title=like.*${marca}*`)).length,
      { message: 'a conversa apagada continua no banco' },
    )
    .toBe(0);
});
