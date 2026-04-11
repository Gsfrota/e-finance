import { test } from '@playwright/test';

test('caderneta header screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto('http://localhost:3001');
  await page.waitForTimeout(1000);
  
  // Login manual
  await page.fill('input[type="email"]', 'teste1@teste');
  await page.fill('input[type="password"]', 'teste123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  
  const btns = await page.$$eval('button, a', els => els.map(e => e.textContent?.trim()).filter(t => t && t.length > 2 && t.length < 50));
  console.log('Botoes após login:', btns.slice(0, 20).join(' | '));
  
  await page.screenshot({ path: '/tmp/home-logado2.png' });

  // Tentar clicar em qualquer botão que seja da caderneta
  const cadernetaBtn = page.locator('button, [role="button"]').filter({ hasText: /caderneta|bullet/i }).first();
  const visible = await cadernetaBtn.isVisible().catch(() => false);
  console.log('Caderneta button visible:', visible);
  
  if (visible) {
    await cadernetaBtn.click();
    await page.waitForTimeout(1500);
  }
  
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.screenshot({ path: '/tmp/caderneta-light-new.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: '/tmp/caderneta-dark-new.png' });
});
