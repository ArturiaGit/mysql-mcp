import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to resolve ephemeral port')));
        return;
      }
      const { port } = address;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const adminApiEntry = fileURLToPath(new URL('../../admin-api/dist/main.js', import.meta.url));
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

function resolveBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    (() => {
      try {
        return chromium.executablePath();
      } catch {
        return undefined;
      }
    })(),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`No Chromium/Chrome/Edge executable found. Checked: ${candidates.join(', ')}`);
}

async function waitForHttp(url, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (await predicate(response)) return;
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url} (${lastError})`);
}

function spawnManaged(args, options) {
  const child = spawn(process.execPath, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  const append = (chunk) => {
    logs = (logs + chunk.toString('utf8')).slice(-4000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return { child, getLogs: () => logs };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 3_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function measureContrastRatios(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Unable to acquire 2d canvas context');

    const toRgb = (cssColor) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000000';
      ctx.fillStyle = cssColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    };

    const luminance = ([r, g, b]) => {
      const linear = [r, g, b].map((channel) => {
        const s = channel / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };

    const ratio = (fgVar, bgVar) => {
      const rootStyle = getComputedStyle(document.documentElement);
      const fgRgb = toRgb(rootStyle.getPropertyValue(fgVar).trim());
      const bgRgb = toRgb(rootStyle.getPropertyValue(bgVar).trim());
      const l1 = luminance(fgRgb);
      const l2 = luminance(bgRgb);
      const bright = Math.max(l1, l2);
      const dark = Math.min(l1, l2);
      return Number(((bright + 0.05) / (dark + 0.05)).toFixed(2));
    };

    return {
      theme: document.documentElement.dataset.theme,
      colorScheme: document.querySelector('meta[name="color-scheme"]')?.getAttribute('content'),
      mainOnApp: ratio('--color-fg-main', '--color-bg-app'),
      mutedOnCard: ratio('--color-fg-muted', '--color-bg-card'),
      onPrimaryOnPrimary: ratio('--color-on-primary', '--color-primary'),
      safeOnSoft: ratio('--color-safe', '--color-safe-soft'),
      warningOnSoft: ratio('--color-warning', '--color-warning-soft'),
      dangerOnSoft: ratio('--color-danger', '--color-danger-soft'),
      secretOnSoft: ratio('--color-secret', '--color-secret-soft'),
    };
  });
}

async function run() {
  assert(existsSync(adminApiEntry), `Missing ${adminApiEntry}. Run pnpm build before test:e2e.`);
  assert(existsSync(viteBin), `Missing Vite binary at ${viteBin}`);
  assert(
    process.env.METADATA_DB_USER && process.env.METADATA_DB_PASSWORD,
    'E2E requires provisioned real MySQL env vars (METADATA_DB_USER and METADATA_DB_PASSWORD).',
  );

  const apiPort = Number(process.env.ADMIN_API_PORT ?? '8081');
  const devPort = process.env.ADMIN_UI_DEV_PORT
    ? Number(process.env.ADMIN_UI_DEV_PORT)
    : await getFreePort();
  const previewPort = process.env.ADMIN_UI_PREVIEW_PORT
    ? Number(process.env.ADMIN_UI_PREVIEW_PORT)
    : await getFreePort();
  const screenshotDir = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const devBase = `http://127.0.0.1:${devPort}`;
  const previewBase = `http://127.0.0.1:${previewPort}`;

  const api = spawnManaged([adminApiEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ADMIN_API_HOST: '127.0.0.1',
      ADMIN_API_PORT: String(apiPort),
      ADMIN_API_SECRET: process.env.ADMIN_API_SECRET ?? randomBytes(32).toString('hex'),
      SERVER_PEPPER: process.env.SERVER_PEPPER ?? randomBytes(32).toString('hex'),
      GATEWAY_MASTER_KEYS:
        process.env.GATEWAY_MASTER_KEYS ??
        JSON.stringify({
          active_key_id: 'e2e',
          keys: { e2e: randomBytes(32).toString('hex') },
        }),
      BOOTSTRAP_ADMIN_PASSWORD:
        process.env.BOOTSTRAP_ADMIN_PASSWORD ?? `Aa1!${randomBytes(12).toString('base64url')}`,
    },
  });

  let devServer;
  let previewServer;
  let browser;

  try {
    await waitForHttp(`${apiBase}/health/live`, async (res) => res.status === 200);
    await waitForHttp(`${apiBase}/health/ready`, async (res) => {
      if (res.status !== 200) return false;
      const body = await res.json();
      return body.status === 'ready';
    });
    console.log(`admin-api verified ready on ${apiBase} (real MySQL)`);

    devServer = spawnManaged(
      [viteBin, '--host', '127.0.0.1', '--port', String(devPort), '--strictPort'],
      {
        cwd: appRoot,
        env: { ...process.env, VITE_ADMIN_API_TARGET: apiBase },
      },
    );
    await waitForHttp(`${devBase}/_lab`, async (res) => res.status === 200);
    console.log(`Vite dev server listening on ${devBase}`);

    const executablePath = resolveBrowserExecutable();
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await context.newPage();

    const pageErrors = [];
    let allowExpectedUnauth401 = false;
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (allowExpectedUnauth401 && text.includes('status of 401')) {
          return;
        }
        pageErrors.push(text);
      }
    });

    // 1. Navigate to /_lab and verify Tab -> .skip-link first, then real admin-api:8081 live/ready probe
    await page.goto(`${devBase}/_lab`, { waitUntil: 'networkidle' });
    await page.getByTestId('health-status-ready').waitFor({ state: 'visible' });
    await page.keyboard.press('Tab');
    const skipFocused = await page.evaluate(() => document.activeElement?.classList.contains('skip-link'));
    assert.equal(skipFocused, true, 'First Tab stop must focus .skip-link');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="health-status-ready"]')?.textContent?.trim() === 'READY',
    );
    const liveStatus = await page.getByTestId('health-status-live').innerText();
    const readyStatus = await page.getByTestId('health-status-ready').innerText();
    const topbarHealth = await page.getByTestId('topbar-health-badge').innerText();
    assert.equal(liveStatus.trim(), 'OK');
    assert.equal(readyStatus.trim(), 'READY');
    assert.equal(topbarHealth.trim(), 'ADMIN-API READY');
    await page.getByTestId('reprobe-health-btn').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="health-row-ready"]')?.textContent?.includes('HTTP 200'),
    );
    console.log('PASS: /_lab live probe connected to real admin-api:8081 + MySQL (live=OK, ready=READY)');

    // 2. Verify Topbar 56px, Sidebar 240/64px, Table row 38px, locked density & zero Emoji
    const topbarBox = await page.getByTestId('app-topbar').boundingBox();
    assert(topbarBox && Math.round(topbarBox.height) === 56, `Expected Topbar 56px, got ${topbarBox?.height}`);

    const sidebarExpanded = await page.locator('#app-sidebar').boundingBox();
    assert(sidebarExpanded && Math.round(sidebarExpanded.width) === 240, `Expected Sidebar 240px, got ${sidebarExpanded?.width}`);
    await page.getByRole('button', { name: '折叠侧边栏' }).click();
    await page.waitForFunction(() => Math.round(document.querySelector('#app-sidebar').getBoundingClientRect().width) === 64);
    await page.getByRole('button', { name: '展开侧边栏' }).click();
    await page.waitForFunction(() => Math.round(document.querySelector('#app-sidebar').getBoundingClientRect().width) === 240);

    const rowCount = await page.getByTestId('audit-table-row').count();
    assert.equal(rowCount, 6);
    const firstRowBox = await page.getByTestId('audit-table-row').first().boundingBox();
    assert(firstRowBox && Math.round(firstRowBox.height) === 38, `Expected 38px table row, got ${firstRowBox?.height}`);

    const bodyText = await page.evaluate(() => document.body.innerText);
    assert(!bodyText.includes('舒适密度') && !bodyText.includes('紧凑密度'), 'Density toggle must be removed');
    assert(!/\p{Extended_Pictographic}/u.test(bodyText), 'Formal UI must not contain Emoji');
    console.log('PASS: Geometry & hygiene (Topbar=56px, Sidebar=240/64px, Row=38px, no density toggle, 0 Emoji)');

    // 3. Dark & Light OKLCH WCAG 2.1 AA contrast check (>= 4.5:1)
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'lab-dark.png'), fullPage: true });
    }
    const darkContrast = await measureContrastRatios(page);
    assert.equal(darkContrast.theme, 'dark');
    assert.equal(darkContrast.colorScheme, 'dark');
    for (const [pair, score] of Object.entries(darkContrast)) {
      if (typeof score === 'number') {
        assert(score >= 4.5, `Dark contrast ${pair}=${score} < 4.5`);
      }
    }

    await page.getByTestId('theme-toggle-btn').click();
    if (screenshotDir) {
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(screenshotDir, 'lab-light.png'), fullPage: true });
    }
    const lightContrast = await measureContrastRatios(page);
    assert.equal(lightContrast.theme, 'light');
    assert.equal(lightContrast.colorScheme, 'light');
    for (const [pair, score] of Object.entries(lightContrast)) {
      if (typeof score === 'number') {
        assert(score >= 4.5, `Light contrast ${pair}=${score} < 4.5`);
      }
    }
    await page.getByTestId('theme-toggle-btn').click();
    console.log(`PASS: WCAG AA contrast verified Dark=${JSON.stringify(darkContrast)} Light=${JSON.stringify(lightContrast)}`);

    // 4. Keyboard navigation: Ctrl+K -> CommandPalette -> Esc focus restore
    const cmdTrigger = page.getByTestId('command-palette-trigger');
    await cmdTrigger.focus();
    await page.keyboard.press('Control+k');
    await page.getByTestId('command-palette-dialog').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.getByTestId('command-palette-dialog').waitFor({ state: 'hidden' });
    const restoredToTrigger = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') === 'command-palette-trigger',
    );
    assert.equal(restoredToTrigger, true, 'Esc must close CommandPalette and restore focus to invoker');
    console.log('PASS: Keyboard nav (Tab->.skip-link, Ctrl+K->Esc focus restored)');

    // 5. PAT 3-state reveal safeguard & memory clearing on close
    await page.getByRole('button', { name: '生成演示令牌' }).click();
    await page.getByTestId('pat-reveal-dialog').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '生成演示令牌' }).last().click();
    await page.getByTestId('pat-secret-output').waitFor({ state: 'visible' });
    const secretText = (await page.getByTestId('pat-secret-output').innerText()).trim();
    assert.match(secretText, /^mcp_demo_[0-9a-f]{36}$/);
    assert.equal(await page.getByTestId('pat-done-btn').isDisabled(), true);

    await page.keyboard.press('Escape');
    await page.getByTestId('pat-discard-prompt').waitFor({ state: 'visible' });
    await page.locator('#lab-pat-backup-check').check();
    assert.equal(await page.getByTestId('pat-done-btn').isDisabled(), false);
    await page.getByTestId('pat-done-btn').click();
    await page.getByTestId('pat-reveal-dialog').waitFor({ state: 'hidden' });
    const domAfterClose = await page.evaluate(() => document.documentElement.innerHTML);
    assert(!domAfterClose.includes(secretText), 'PAT secret must be cleared from DOM on close');
    console.log('PASS: PAT 3-state reveal safeguard (Esc blocked -> backup checkbox -> cleared on close)');

    // 6. InspectSheet real physical fields & 4 responsive breakpoints
    const rowTrigger = page.getByRole('button', { name: '查看 qi_demo_0005 详情' });
    await rowTrigger.focus();
    await rowTrigger.click();
    const sheet = page.locator('dialog.inspect-sheet-dialog');
    await sheet.waitFor({ state: 'visible' });
    const sheetText = await page.getByTestId('inspect-sheet-content').innerText();
    assert(sheetText.includes('qi_demo_0005') && sheetText.includes('sess_mcp_019a2e') && sheetText.includes('BLOCKED_AST'));
    assert(!sheetText.includes('EXPLAIN') && !sheetText.includes('一键吊销 PAT') && !sheetText.includes('AST 穿透'));
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'lab-inspect-sheet.png') });
    }

    for (const [vp, check] of [
      [{ width: 1500, height: 900 }, (box) => Math.round(box.width) === 600],
      [{ width: 1200, height: 900 }, (box) => Math.round(box.width) === 540],
      [{ width: 900, height: 900 }, (box) => Math.abs(box.width - 630) <= 2],
      [
        { width: 390, height: 844 },
        (box) => Math.round(box.width) === 390 && Math.abs(box.height - 844 * 0.85) <= 2 && Math.abs(box.y + box.height - 844) <= 2,
      ],
    ]) {
      await page.setViewportSize(vp);
      const box = await sheet.boundingBox();
      assert(box && check(box), `InspectSheet geometry mismatch at ${vp.width}x${vp.height}: ${JSON.stringify(box)}`);
    }

    await page.setViewportSize({ width: 1500, height: 900 });
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
    const restoredToRow = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') === '查看 qi_demo_0005 详情',
    );
    assert.equal(restoredToRow, true, 'Esc must close InspectSheet and restore focus to row trigger');
    console.log('PASS: InspectSheet physical fields & breakpoints (600px / 540px / 70vw / 85vh bottom)');

    // 6b. Form simulated SSRF check + Dual-Bucket -1 exemption safeguard
    await page.locator('#lab-hostname').fill('127.0.0.1');
    await page.getByRole('button', { name: '模拟连通性测试' }).click();
    await page.getByText('ALLOWED_OUTBOUND_IPS').waitFor({ state: 'visible' });
    await page.getByRole('switch', { name: /豁免个人限流/ }).check();
    await page.getByRole('button', { name: '模拟资源满载' }).click();
    await page.getByText('资源保护桶已满，请求将被限制').waitFor({ state: 'visible' });
    console.log('PASS: Form SSRF simulation & Dual-Bucket -1 exemption safeguard');

    // 7. Production build verification: /_lab MUST NOT be mounted when import.meta.env.DEV === false
    previewServer = spawnManaged(
      [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'],
      {
        cwd: appRoot,
        env: { ...process.env, VITE_ADMIN_API_TARGET: apiBase },
      },
    );
    await waitForHttp(previewBase, async (res) => res.status === 200);
    await page.goto(`${previewBase}/_lab`, { waitUntil: 'networkidle' });
    await page.getByTestId('route-unavailable-banner').waitFor({ state: 'visible' });
    allowExpectedUnauth401 = true;
    await page.goto(`${previewBase}/`, { waitUntil: 'networkidle' });
    await page.waitForURL(/\/login$/);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="topbar-health-badge"]')?.textContent?.trim() === 'ADMIN-API READY',
    );
    allowExpectedUnauth401 = false;
    console.log('PASS: Production bundle gates /_lab out, redirects unauth / -> /login, and connects to real admin-api:8081');

    assert.equal(pageErrors.length, 0, `Unexpected browser errors: ${pageErrors.join('; ')}`);
  } catch (error) {
    console.error('admin-api logs:\n', api.getLogs());
    if (devServer) console.error('vite dev logs:\n', devServer.getLogs());
    if (previewServer) console.error('vite preview logs:\n', previewServer.getLogs());
    throw error;
  } finally {
    await browser?.close();
    await stopChild(previewServer?.child);
    await stopChild(devServer?.child);
    await stopChild(api.child);
  }
}

await run();
