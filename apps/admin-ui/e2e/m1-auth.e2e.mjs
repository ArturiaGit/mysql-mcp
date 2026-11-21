import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

function mysqlQuery(sql) {
  const user = process.env.METADATA_DB_USER;
  const password = process.env.METADATA_DB_PASSWORD;
  const database = process.env.METADATA_DB_NAME ?? 'mysql_mcp_metadata';
  const result = spawnSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      '-e',
      `MYSQL_PWD=${password}`,
      'mysql',
      'mysql',
      '--default-character-set=utf8mb4',
      '--protocol=TCP',
      '-h',
      '127.0.0.1',
      '-u',
      user,
      '-D',
      database,
      '-NBe',
      sql,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, `MySQL command failed: ${result.stderr}`);
  return result.stdout.trim();
}

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
    logs = (logs + chunk.toString('utf8')).slice(-6000);
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

const strongPassword = () => `Aa1!${randomBytes(12).toString('base64url')}`;

async function run() {
  assert(existsSync(adminApiEntry), `Missing ${adminApiEntry}. Run pnpm build first.`);
  assert(existsSync(viteBin), `Missing Vite binary at ${viteBin}`);
  assert(
    process.env.METADATA_DB_USER && process.env.METADATA_DB_PASSWORD,
    'M1 browser E2E requires real Docker MySQL 8.0 env vars (METADATA_DB_USER and METADATA_DB_PASSWORD).',
  );

  let api;
  let previewServer;
  let browser;

  try {
    const dbVersion = mysqlQuery('SELECT VERSION()');
    assert.match(dbVersion, /^8\.0\./, `Expected MySQL 8.0, got ${dbVersion}`);

    const seedState = mysqlQuery(
      "SELECT setting_value FROM sys_system_settings WHERE setting_key = 'bootstrap_state'",
    );
    assert.equal(
      seedState,
      'PENDING',
      'M1 browser E2E requires a fresh empty MySQL DB (bootstrap_state = PENDING)',
    );
    const userCount = mysqlQuery('SELECT COUNT(*) FROM sys_users');
    assert.equal(userCount, '0', 'M1 browser E2E requires 0 initial users');

    const adminUser = 'e2e_super_admin';
    const initialAdminPwd = strongPassword();
    const updatedAdminPwd = strongPassword();
    const pendingUser = 'e2e_pending_dev';
    const pendingPwd = strongPassword();
    const rejectedUser = 'e2e_rejected_dev';
    const rejectedPwd = strongPassword();
    const disabledUser = 'e2e_disabled_dev';
    const disabledPwd = strongPassword();
    const bruteUser = 'e2e_brute_user';
    const brutePwd = strongPassword();

    const apiPort = await getFreePort();
    const uiPort = await getFreePort();
    const apiBase = `http://127.0.0.1:${apiPort}`;
    const uiBase = `http://127.0.0.1:${uiPort}`;

    // NOTE: NODE_ENV=development allows HTTP localhost cookies (non-Secure) on 127.0.0.1 proxy
    api = spawnManaged([adminApiEntry], {
      cwd: repoRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ADMIN_API_HOST: '127.0.0.1',
        ADMIN_API_PORT: String(apiPort),
        ADMIN_API_SECRET: randomBytes(32).toString('hex'),
        SERVER_PEPPER: process.env.SERVER_PEPPER ?? randomBytes(32).toString('hex'),
        GATEWAY_MASTER_KEYS: JSON.stringify({
          active_key_id: 'e2e',
          keys: { e2e: randomBytes(32).toString('hex') },
        }),
        BOOTSTRAP_ADMIN_USERNAME: adminUser,
        BOOTSTRAP_ADMIN_PASSWORD: initialAdminPwd,
        BOOTSTRAP_ADMIN_EMAIL: 'admin@e2e.test',
      },
    });

    await waitForHttp(`${apiBase}/health/ready`, async (res) => {
      if (res.status !== 200) return false;
      const body = await res.json();
      return body.status === 'ready';
    });
    console.log(`PASS: Real admin-api bootstrapped empty Docker MySQL ${dbVersion} on ${apiBase}`);

    previewServer = spawnManaged(
      [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'],
      {
        cwd: appRoot,
        env: { ...process.env, VITE_ADMIN_API_TARGET: apiBase },
      },
    );
    await waitForHttp(`${uiBase}/login`, async (res) => res.status === 200);
    console.log(`PASS: Production admin-ui preview listening on ${uiBase}`);

    const executablePath = resolveBrowserExecutable();
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const assertZeroEmoji = async (label) => {
      const text = await page.evaluate(() => document.body.innerText);
      assert(!/\p{Extended_Pictographic}/u.test(text), `Emoji detected on ${label}`);
    };

    // ------------------------------------------------------------------
    // Scenario 1: Empty-DB Bootstrap -> Login -> Forced /change-password
    // -> Hard-block /audits -> Wrong old pwd 400 preserves session
    // -> Change pwd -> Unlock /dashboard + CSRF rotated -> Policy edit + disable high-risk confirm -> Logout
    // ------------------------------------------------------------------
    await page.goto(`${uiBase}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForURL(/\/login$/);
    await assertZeroEmoji('/login');

    await page.fill('#login-username', adminUser);
    await page.fill('#login-password', initialAdminPwd);
    await page.getByTestId('login-submit-btn').click();
    await page.waitForURL(/\/change-password$/);
    await page.getByTestId('forced-password-lock-banner').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#app-sidebar').count(), 0, 'Sidebar must be hidden during forced password lock');
    await assertZeroEmoji('/change-password (locked)');
    console.log('PASS: Bootstrap SUPER_ADMIN auto-routed to locked /change-password');

    // Manual jump to /audits MUST be hard-blocked back to /change-password
    await page.goto(`${uiBase}/audits`, { waitUntil: 'networkidle' });
    await page.waitForURL(/\/change-password$/);
    await page.getByTestId('forced-password-lock-banner').waitFor({ state: 'visible' });
    console.log('PASS: Manual navigation to /audits hard-blocked by L3 MustChangePwdGuard');

    // Wrong old password returns 400 ERR_OLD_PASSWORD_INVALID -> keeps session & form inputs
    await page.fill('#old-password', 'WrongOldPassword1!');
    await page.fill('#new-password', updatedAdminPwd);
    await page.fill('#confirm-password', updatedAdminPwd);
    await page.getByTestId('change-password-submit-btn').click();
    await page.getByTestId('change-password-error-banner').waitFor({ state: 'visible' });
    assert.match(page.url(), /\/change-password$/, '400 wrong old password must NOT kick out to /login');
    assert.equal(await page.inputValue('#new-password'), updatedAdminPwd, 'Form draft must be preserved');
    console.log('PASS: Wrong old password returned 400 and preserved session & form inputs');

    // Correct old password unlocks console -> /dashboard
    await page.fill('#old-password', initialAdminPwd);
    await page.getByTestId('change-password-submit-btn').click();
    await page.waitForURL(/\/dashboard$/);
    await page.getByTestId('dashboard-view').waitFor({ state: 'visible' });
    assert.equal((await page.getByTestId('dashboard-user-id').innerText()).trim(), '1');
    console.log('PASS: Password change succeeded, rotated CSRF/session, and unlocked /dashboard');

    // Voluntary /change-password -> Edit policy to 60d -> Disable rotation triggers high-risk dialog
    await page.goto(`${uiBase}/change-password`, { waitUntil: 'networkidle' });
    await page.getByTestId('password-policy-summary').waitFor({ state: 'visible' });
    await page.fill('#password-expires-days', '60');
    await page.getByTestId('save-password-policy-btn').click();
    await page.waitForFunction(
      () => document.querySelector('[data-testid="password-policy-summary"]')?.textContent?.includes('60 天'),
    );

    await page.getByTestId('password-rotation-switch').uncheck();
    await page.getByTestId('save-password-policy-btn').click();
    await page.getByTestId('disable-rotation-confirm-dialog').waitFor({ state: 'visible' });
    assert.equal(
      await page.getByTestId('confirm-disable-rotation-btn').isDisabled(),
      true,
      'Disable rotation confirm button must stay disabled until risk checkbox is checked',
    );
    await page.locator('#confirm-disable-rotation-risk').check();
    assert.equal(await page.getByTestId('confirm-disable-rotation-btn').isDisabled(), false);
    await page.getByTestId('confirm-disable-rotation-btn').click();
    await page.getByTestId('disable-rotation-confirm-dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="password-days-remaining"]')?.textContent?.includes('-1'),
    );
    console.log('PASS: Password rotation policy updated (60d -> null with high-risk confirmation dialog)');

    // Logout clears session completely
    await page.getByTestId('console-logout-btn').click();
    await page.waitForURL(/\/login$/);
    await page.goto(`${uiBase}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForURL(/\/login$/);
    console.log('PASS: Logout cleared session and protected route redirects to /login');

    // ------------------------------------------------------------------
    // Scenario 2: Register PENDING user -> L2 StatusGuard -> /approvals/wait
    // (NEVER triggers MustChangePwdGuard even when navigating to /change-password)
    // ------------------------------------------------------------------
    await page.goto(`${uiBase}/register`, { waitUntil: 'networkidle' });
    await assertZeroEmoji('/register');
    await page.fill('#register-username', pendingUser);
    await page.fill('#register-password', pendingPwd);
    await page.fill('#register-email', 'pending@e2e.test');
    await page.fill('#register-department', 'AI Data Team');
    await page.fill('#register-reason', 'Need read-only query access for analytics.');
    await page.getByTestId('register-submit-btn').click();
    await page.getByTestId('register-complete-card').waitFor({ state: 'visible' });

    await page.getByTestId('register-goto-login-btn').click();
    await page.waitForURL(/\/login/);
    await page.fill('#login-username', pendingUser);
    await page.fill('#login-password', pendingPwd);
    await page.getByTestId('login-submit-btn').click();
    await page.waitForURL(/\/approvals\/wait$/);
    await page.getByTestId('pending-approval-card').waitFor({ state: 'visible' });
    await assertZeroEmoji('/approvals/wait');

    // Force-navigate PENDING user to /dashboard and /change-password -> L2 StatusGuard MUST hold at /approvals/wait
    await page.goto(`${uiBase}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForURL(/\/approvals\/wait$/);
    await page.goto(`${uiBase}/change-password`, { waitUntil: 'networkidle' });
    await page.waitForURL(/\/approvals\/wait$/);
    console.log('PASS: PENDING user intercepted by L2 StatusGuard -> /approvals/wait (never hits MustChangePwdGuard)');

    await page.getByTestId('auth-logout-btn').click();
    await page.waitForURL(/\/login$/);

    // ------------------------------------------------------------------
    // Scenario 3: REJECTED user -> /approvals/re shows reject_reason -> resubmit -> /approvals/wait
    // ------------------------------------------------------------------
    await page.goto(`${uiBase}/register`, { waitUntil: 'networkidle' });
    await page.fill('#register-username', rejectedUser);
    await page.fill('#register-password', rejectedPwd);
    await page.fill('#register-department', 'Risk Ops');
    await page.fill('#register-reason', 'Initial request');
    await page.getByTestId('register-submit-btn').click();
    await page.getByTestId('register-complete-card').waitFor({ state: 'visible' });

    const rejectReasonText = '请补充业务主管 OA 审批单号，并明确需要访问的脱敏视图范围。';
    const rejId = mysqlQuery(`SELECT CAST(id AS CHAR) FROM sys_users WHERE username = '${rejectedUser}'`);
    assert(rejId, 'Missing registered rejected user ID');
    mysqlQuery(`UPDATE sys_users SET status = 'REJECTED', version = version + 1 WHERE id = ${rejId}`);
    mysqlQuery(
      `UPDATE sys_user_approvals SET action = 'REJECT', reason = '${rejectReasonText}', operator_id = 1, decided_at = UTC_TIMESTAMP(3) WHERE user_id = ${rejId} AND action = 'SUBMIT'`,
    );

    await page.goto(`${uiBase}/login`, { waitUntil: 'networkidle' });
    await page.fill('#login-username', rejectedUser);
    await page.fill('#login-password', rejectedPwd);
    await page.getByTestId('login-submit-btn').click();
    await page.waitForURL(/\/approvals\/re$/);
    await page.getByTestId('resubmit-approval-card').waitFor({ state: 'visible' });
    const renderedReason = await page.getByTestId('reject-reason-box').innerText();
    assert(renderedReason.includes(rejectReasonText), `Expected reject_reason in UI, got: ${renderedReason}`);
    await assertZeroEmoji('/approvals/re');

    await page.fill('#resubmit-email', 'rejected_updated@e2e.test');
    await page.fill('#resubmit-reason', '已补充审批单号 OA-20261120-008，仅访问 order_summary 视图。');
    await page.getByTestId('resubmit-submit-btn').click();
    await page.waitForURL(/\/approvals\/wait$/);
    await page.getByTestId('pending-approval-card').waitFor({ state: 'visible' });
    console.log('PASS: REJECTED user saw reject_reason on /approvals/re and resubmitted back to PENDING (/approvals/wait)');

    await page.getByTestId('auth-logout-btn').click();
    await page.waitForURL(/\/login$/);

    // ------------------------------------------------------------------
    // Scenario 4: DISABLED user -> /forbidden (L2 StatusGuard)
    // ------------------------------------------------------------------
    await page.goto(`${uiBase}/register`, { waitUntil: 'networkidle' });
    await page.fill('#register-username', disabledUser);
    await page.fill('#register-password', disabledPwd);
    await page.getByTestId('register-submit-btn').click();
    await page.getByTestId('register-complete-card').waitFor({ state: 'visible' });

    const disId = mysqlQuery(`SELECT CAST(id AS CHAR) FROM sys_users WHERE username = '${disabledUser}'`);
    assert(disId, 'Missing registered disabled user ID');
    mysqlQuery(`UPDATE sys_users SET status = 'DISABLED', version = version + 1 WHERE id = ${disId}`);

    await page.goto(`${uiBase}/login`, { waitUntil: 'networkidle' });
    await page.fill('#login-username', disabledUser);
    await page.fill('#login-password', disabledPwd);
    await page.getByTestId('login-submit-btn').click();
    await page.waitForURL(/\/forbidden$/);
    await page.getByTestId('account-disabled-card').waitFor({ state: 'visible' });
    await assertZeroEmoji('/forbidden');

    await page.goto(`${uiBase}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForURL(/\/forbidden$/);
    console.log('PASS: DISABLED user routed to /forbidden and blocked from /dashboard');

    await page.getByTestId('auth-logout-btn').click();
    await page.waitForURL(/\/login$/);

    // ------------------------------------------------------------------
    // Scenario 5: Brute-force remaining_attempts & 429 lockout countdown
    // ------------------------------------------------------------------
    await page.goto(`${uiBase}/register`, { waitUntil: 'networkidle' });
    await page.fill('#register-username', bruteUser);
    await page.fill('#register-password', brutePwd);
    await page.getByTestId('register-submit-btn').click();
    await page.getByTestId('register-complete-card').waitFor({ state: 'visible' });

    await page.goto(`${uiBase}/login`, { waitUntil: 'networkidle' });
    await page.fill('#login-username', bruteUser);

    for (const expectedRemaining of [4, 3, 2, 1]) {
      await page.fill('#login-password', `WrongAttempt${expectedRemaining}!`);
      await page.getByTestId('login-submit-btn').click();
      await page.getByTestId('login-remaining-attempts').waitFor({ state: 'visible' });
      const text = await page.getByTestId('login-remaining-attempts').innerText();
      assert(
        text.includes(`${expectedRemaining}`),
        `Expected remaining_attempts=${expectedRemaining}, got "${text}"`,
      );
    }

    // 5th wrong attempt triggers 429 ERR_AUTH_ACCOUNT_LOCKED + live countdown
    await page.fill('#login-password', 'WrongAttempt5!');
    await page.getByTestId('login-submit-btn').click();
    await page.getByTestId('login-lockout-countdown').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('login-submit-btn').isDisabled(), true);
    console.log('PASS: Brute-force remaining_attempts (4->3->2->1) and 429 lockout countdown verified');

    assert.equal(pageErrors.length, 0, `Unexpected browser pageerrors: ${pageErrors.join('; ')}`);
  } catch (error) {
    if (browser) {
      const pages = browser.contexts().flatMap((c) => c.pages());
      for (const p of pages) {
        try {
          console.error('Current page URL:', p.url());
          console.error('Current page text:\n', (await p.evaluate(() => document.body.innerText)).slice(0, 1500));
        } catch {
          // ignore
        }
      }
    }
    if (api) console.error('admin-api logs:\n', api.getLogs());
    if (previewServer) console.error('vite preview logs:\n', previewServer.getLogs());
    throw error;
  } finally {
    await browser?.close();
    await stopChild(previewServer?.child);
    await stopChild(api?.child);
  }
}

await run();
