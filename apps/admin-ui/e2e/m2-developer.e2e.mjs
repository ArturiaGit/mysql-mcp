import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const adminApiEntry = fileURLToPath(new URL('../../admin-api/dist/main.js', import.meta.url));
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

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
    'M2 browser E2E requires real Docker MySQL 8.0 env vars (METADATA_DB_USER and METADATA_DB_PASSWORD).',
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
      'M2 browser E2E requires a fresh empty MySQL DB (bootstrap_state = PENDING)',
    );

    const serverPepper = randomBytes(32).toString('hex');
    const adminUser = 'm2_super_admin';
    const adminPwd = strongPassword();
    const devUser = 'm2_active_dev';
    const devPwd = strongPassword();
    const emptyProfileDev = 'm2_zero_profile_dev';
    const emptyProfilePwd = strongPassword();

    const apiPort = await getFreePort();
    const uiPort = await getFreePort();
    const apiBase = `http://127.0.0.1:${apiPort}`;
    const uiBase = `http://127.0.0.1:${uiPort}`;

    api = spawnManaged([adminApiEntry], {
      cwd: repoRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ADMIN_API_HOST: '127.0.0.1',
        ADMIN_API_PORT: String(apiPort),
        ADMIN_API_SECRET: randomBytes(32).toString('hex'),
        SERVER_PEPPER: serverPepper,
        GATEWAY_MASTER_KEYS: JSON.stringify({
          active_key_id: 'e2e',
          keys: { e2e: randomBytes(32).toString('hex') },
        }),
        BOOTSTRAP_ADMIN_USERNAME: adminUser,
        BOOTSTRAP_ADMIN_PASSWORD: adminPwd,
        BOOTSTRAP_ADMIN_EMAIL: 'admin@m2-e2e.test',
      },
    });

    await waitForHttp(`${apiBase}/health/ready`, async (res) => {
      if (res.status !== 200) return false;
      const body = await res.json();
      return body.status === 'ready';
    });
    console.log(`PASS: Real admin-api ready on ${apiBase} (MySQL ${dbVersion})`);

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

    // Register two ordinary developer users via real /register UI, then activate & assign roles in real MySQL
    for (const [uname, pwd, email] of [
      [devUser, devPwd, 'dev@m2-e2e.test'],
      [emptyProfileDev, emptyProfilePwd, 'zero@m2-e2e.test'],
    ]) {
      await page.goto(`${uiBase}/register`, { waitUntil: 'networkidle' });
      await page.fill('#register-username', uname);
      await page.fill('#register-password', pwd);
      await page.fill('#register-email', email);
      await page.fill('#register-department', 'Platform R&D');
      await page.fill('#register-reason', 'M2 E2E verification');
      await page.getByTestId('register-submit-btn').click();
      await page.getByTestId('register-complete-card').waitFor({ state: 'visible' });
    }

    const devId = mysqlQuery(`SELECT CAST(id AS CHAR) FROM sys_users WHERE username = '${devUser}'`);
    const zeroId = mysqlQuery(`SELECT CAST(id AS CHAR) FROM sys_users WHERE username = '${emptyProfileDev}'`);
    assert(devId && zeroId, 'Registered users must exist in sys_users');

    // Activate both developers without must_change_password
    mysqlQuery(`UPDATE sys_users SET status = 'ACTIVE', must_change_password = 0 WHERE id IN (${devId}, ${zeroId})`);

    // Bind devUser to DEVELOPER role; bind emptyProfileDev to ANALYST role (no profiles bound)
    mysqlQuery(
      `INSERT INTO sys_user_roles (user_id, role_id)
       SELECT ${devId}, id FROM sys_roles WHERE role_name = 'DEVELOPER'`,
    );
    mysqlQuery(
      `INSERT INTO sys_user_roles (user_id, role_id)
       SELECT ${zeroId}, id FROM sys_roles WHERE role_name = 'ANALYST'`,
    );

    // Seed two real sys_profiles with sensitive ops columns; bind ONLY prod_analytics to DEVELOPER
    mysqlQuery(
      `INSERT INTO sys_profiles
         (name, display_name, environment, host, port, username, password_encrypted, default_database, ssh_config, max_pool_size, profile_capacity_qpm, status)
       VALUES
         ('prod_analytics', '分析只读主库', 'PROD', '10.88.1.21', 3306, 'ro_analytics_secret_user', 'v1:e2e:iv:cipher:tag', 'analytics_db', JSON_OBJECT('use_ssh', true, 'host', '10.88.0.5', 'port', 22), 15, 600, 'ACTIVE'),
         ('prod_finance_vault', '财务核心隐私库', 'PROD', '10.99.9.99', 3306, 'finance_root', 'v1:e2e:iv:cipher2:tag2', 'finance_db', NULL, 10, 300, 'ACTIVE')`,
    );
    mysqlQuery(
      `INSERT INTO sys_role_profiles (role_id, profile_id)
       SELECT r.id, p.id FROM sys_roles r JOIN sys_profiles p ON p.name = 'prod_analytics'
       WHERE r.role_name = 'DEVELOPER'`,
    );

    // Login as ordinary ACTIVE developer
    await page.goto(`${uiBase}/login`, { waitUntil: 'networkidle' });
    await page.fill('#login-username', devUser);
    await page.fill('#login-password', devPwd);
    await page.getByTestId('login-submit-btn').click();
    await page.waitForURL(/\/dashboard$/);
    await page.getByTestId('dashboard-view').waitFor({ state: 'visible' });

    // Navigate via Ctrl+K CommandPalette to /developer/pats
    await page.keyboard.press('Control+k');
    await page.getByTestId('command-palette-dialog').waitFor({ state: 'visible' });
    await page.locator('[data-testid="command-palette-dialog"] input[type="search"]').fill('PAT');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/developer\/pats$/);
    await page.getByTestId('my-tokens-view').waitFor({ state: 'visible' });
    await page.getByTestId('pats-empty-state').waitFor({ state: 'visible' });
    await assertZeroEmoji('/developer/pats (empty)');

    // Verify Topbar = 56px
    const topbarBox = await page.getByTestId('app-topbar').boundingBox();
    assert(topbarBox && Math.round(topbarBox.height) === 56, `Expected Topbar 56px, got ${topbarBox?.height}`);

    // ------------------------------------------------------------------
    // Script 1: Issue real PAT -> Esc & Backdrop intercepted -> Copy & check -> Close -> Reload & DB verify
    // ------------------------------------------------------------------
    await page.getByTestId('open-create-pat-btn').click();
    await page.getByTestId('pat-create-modal').waitFor({ state: 'visible' });

    // Empty name validation check
    await page.getByTestId('pat-create-submit-btn').click();
    await page.locator('#pat-name-error').waitFor({ state: 'visible' });

    await page.getByTestId('pat-name-input').fill('Cursor-Agent-Dev');
    await page.getByTestId('pat-expires-days-input').fill('30');
    await page.getByTestId('pat-create-submit-btn').click();

    // Reveal phase checks
    await page.getByTestId('pat-reveal-danger-banner').waitFor({ state: 'visible' });
    const rawToken = (await page.getByTestId('pat-secret-output').innerText()).trim();
    assert.match(rawToken, /^mcp_pat_[0-9a-f]{64}$/, `Unexpected rawToken format: ${rawToken}`);
    assert.equal(await page.getByTestId('pat-done-btn').isDisabled(), true, 'Done button must be disabled before checkbox');

    // Immediate snippet inside modal must interpolate rawToken
    const modalSnippet = await page.getByTestId('snippet-code-claude-desktop').innerText();
    assert(modalSnippet.includes(rawToken), 'Modal immediate snippet must include freshly issued rawToken');

    // Esc while unchecked MUST be intercepted and show text-only reminder (NO extra buttons!)
    await page.keyboard.press('Escape');
    await page.getByTestId('pat-confirm-reminder').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('pat-create-modal').isVisible(), true, 'Modal must stay open on Esc before checkbox');
    assert.equal(
      await page.getByTestId('pat-confirm-reminder').locator('button').count(),
      0,
      'Reminder banner must be text-only with zero buttons',
    );
    assert.equal(await page.locator('[data-testid="pat-force-discard-btn"]').count(), 0);
    assert.equal(await page.locator('[data-testid="pat-keep-saving-btn"]').count(), 0);

    // Top-right close button (X) while unchecked MUST also be blocked
    await page.getByTestId('pat-modal-close-btn').click();
    assert.equal(await page.getByTestId('pat-create-modal').isVisible(), true, 'Modal must stay open on X click before checkbox');
    assert.equal(await page.getByTestId('pat-confirm-reminder').isVisible(), true);

    // Backdrop click while unchecked MUST also be blocked
    await page.mouse.click(8, 8);
    assert.equal(await page.getByTestId('pat-create-modal').isVisible(), true, 'Modal must stay open on backdrop click before checkbox');
    assert.equal(await page.getByTestId('pat-confirm-reminder').isVisible(), true);

    // Copy + check backup confirmation -> unlocks done button and hides reminder
    await page.getByTestId('pat-copy-raw-btn').click();
    await page.getByTestId('pat-backup-confirm-checkbox').check();
    await page.getByTestId('pat-confirm-reminder').waitFor({ state: 'hidden' });
    assert.equal(await page.getByTestId('pat-done-btn').isDisabled(), false);

    await page.getByTestId('pat-done-btn').click();
    await page.getByTestId('pat-create-modal').waitFor({ state: 'hidden' });

    // Zero-leakage verification: DOM, localStorage, sessionStorage, URL must NOT contain rawToken
    const leakCheck = await page.evaluate((secret) => {
      const domHit = document.documentElement.innerHTML.includes(secret);
      const lsHit = JSON.stringify(window.localStorage).includes(secret);
      const ssHit = JSON.stringify(window.sessionStorage).includes(secret);
      const urlHit = window.location.href.includes(secret);
      return { domHit, lsHit, ssHit, urlHit };
    }, rawToken);
    assert.deepEqual(leakCheck, { domHit: false, lsHit: false, ssHit: false, urlHit: false });

    // Reload /developer/pats -> verify row exists with token_prefix, 38px row height, rawToken never reappears
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('pat-table-row').first().waitFor({ state: 'visible' });
    const rowBox = await page.getByTestId('pat-table-row').first().boundingBox();
    assert(rowBox && Math.round(rowBox.height) === 38, `Expected 38px PAT table row, got ${rowBox?.height}`);
    const prefixText = (await page.getByTestId('pat-row-prefix').first().innerText()).trim();
    assert(prefixText.startsWith(rawToken.slice(0, 16)), `Expected prefix ${rawToken.slice(0, 16)}, got ${prefixText}`);
    const pageHtmlAfterReload = await page.evaluate(() => document.documentElement.innerHTML);
    assert(!pageHtmlAfterReload.includes(rawToken), 'rawToken must NEVER reappear after reload');

    // Verify real MySQL sys_pats stores HMAC-SHA-256 hash only & audit contains no rawToken/token_hash
    const expectedHash = createHmac('sha256', serverPepper).update(rawToken, 'utf8').digest('hex');
    const dbHash = mysqlQuery(`SELECT token_hash FROM sys_pats WHERE user_id = ${devId} AND name = 'Cursor-Agent-Dev'`);
    assert.equal(dbHash, expectedHash, 'sys_pats.token_hash must match HMAC-SHA-256(SERVER_PEPPER, rawToken)');
    assert.notEqual(dbHash, rawToken);
    const auditDetails = mysqlQuery(
      `SELECT CAST(details AS CHAR) FROM sys_user_approvals WHERE user_id = ${devId} AND action = 'CONFIG_UPDATE' AND target_type = 'PAT' ORDER BY id DESC LIMIT 1`,
    );
    assert(auditDetails.includes('PAT_CREATE') && !auditDetails.includes(rawToken) && !auditDetails.includes(expectedHash));
    console.log('PASS: Script 1 — PAT issuance, strict checkbox-gated Esc/X/backdrop block (zero extra buttons), zero-leak close & real MySQL hash verified');

    // Duplicate active PAT name -> real backend 409 ERR_PAT_NAME_EXISTS inline error & draft preservation
    await page.getByTestId('open-create-pat-btn').click();
    await page.getByTestId('pat-create-modal').waitFor({ state: 'visible' });
    await page.getByTestId('pat-name-input').fill('Cursor-Agent-Dev');
    await page.getByTestId('pat-expires-days-input').fill('45');
    await page.getByTestId('pat-create-submit-btn').click();
    await page.getByTestId('pat-name-error').waitFor({ state: 'visible' });
    const dupErrorText = (await page.getByTestId('pat-name-error').innerText()).trim();
    assert(
      dupErrorText.includes('该令牌名称已被占用') && dupErrorText.includes('吊销旧令牌后方可复用同名'),
      `Expected 409 ERR_PAT_NAME_EXISTS inline error, got: ${dupErrorText}`,
    );
    assert.equal(await page.getByTestId('pat-name-input').inputValue(), 'Cursor-Agent-Dev', 'Form draft name must be preserved on 409');
    assert.equal(await page.getByTestId('pat-expires-days-input').inputValue(), '45', 'Form draft expiry must be preserved on 409');
    // Editing name automatically clears the inline error
    await page.getByTestId('pat-name-input').fill('Cursor-Agent-Dev-Alt');
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="pat-name-error"]')?.textContent ?? '').trim() === '',
    );
    await page.getByTestId('pat-modal-close-btn').click();
    await page.getByTestId('pat-create-modal').waitFor({ state: 'hidden' });
    console.log('PASS: Script 1b — Duplicate active PAT name blocked with 409 ERR_PAT_NAME_EXISTS inline form guidance');

    // ------------------------------------------------------------------
    // Script 2: Ordinary ACTIVE developer opens /developer/config
    // -> Only authorized profile options, zero ops sensitive fields in network payload
    // -> 3-tab snippet default placeholder + ephemeral in-memory fill cleared on reload
    // ------------------------------------------------------------------
    let capturedMyOptionsBody = null;
    page.on('response', async (response) => {
      if (response.url().endsWith('/api/v1/profiles/my-options') && response.status() === 200) {
        capturedMyOptionsBody = await response.json();
      }
    });

    await page.goto(`${uiBase}/developer/config`, { waitUntil: 'networkidle' });
    await page.getByTestId('client-config-view').waitFor({ state: 'visible' });
    await page.getByTestId('profile-chip-prod_analytics').waitFor({ state: 'visible' });
    await assertZeroEmoji('/developer/config');

    assert(Array.isArray(capturedMyOptionsBody), 'GET /api/v1/profiles/my-options response must be captured');
    assert.equal(capturedMyOptionsBody.length, 1, `Expected exactly 1 authorized profile, got ${JSON.stringify(capturedMyOptionsBody)}`);
    assert.deepEqual(Object.keys(capturedMyOptionsBody[0]).sort(), ['displayName', 'id', 'name']);
    assert.equal(capturedMyOptionsBody[0].name, 'prod_analytics');
    const serializedOptions = JSON.stringify(capturedMyOptionsBody);
    assert(
      !serializedOptions.includes('10.88.1.21') &&
        !serializedOptions.includes('ro_analytics_secret_user') &&
        !serializedOptions.includes('prod_finance_vault') &&
        !serializedOptions.includes('ssh'),
      'my-options network response must NOT leak any ops fields or unauthorized profiles',
    );

    // Default placeholder across all 3 client tabs
    const claudeDefault = await page.getByTestId('snippet-code-claude-desktop').innerText();
    assert(claudeDefault.includes('<YOUR_SAVED_PAT_TOKEN>') && claudeDefault.includes('--profile=prod_analytics'));

    await page.getByTestId('snippet-tab-codex').click();
    const codexDefault = await page.getByTestId('snippet-code-codex').innerText();
    assert(codexDefault.includes('<YOUR_SAVED_PAT_TOKEN>') && codexDefault.includes('X-MCP-Profile = "prod_analytics"'));

    await page.getByTestId('snippet-tab-curl').click();
    const curlDefault = await page.getByTestId('snippet-code-curl').innerText();
    assert(curlDefault.includes('<YOUR_SAVED_PAT_TOKEN>') && curlDefault.includes("X-MCP-Profile: prod_analytics"));

    // Ephemeral in-memory temporary PAT fill (never persisted)
    await page.getByTestId('temp-pat-input').fill(rawToken);
    const curlFilled = await page.getByTestId('snippet-code-curl').innerText();
    assert(curlFilled.includes(rawToken), 'Temporary in-memory PAT must interpolate into snippet');

    const tempLeakCheck = await page.evaluate((secret) => ({
      lsHit: JSON.stringify(window.localStorage).includes(secret),
      ssHit: JSON.stringify(window.sessionStorage).includes(secret),
      urlHit: window.location.href.includes(secret),
    }), rawToken);
    assert.deepEqual(tempLeakCheck, { lsHit: false, ssHit: false, urlHit: false });

    // Reload -> temporary PAT MUST be gone (back to placeholder)
    await page.reload({ waitUntil: 'networkidle' });
    const claudeAfterReload = await page.getByTestId('snippet-code-claude-desktop').innerText();
    assert(claudeAfterReload.includes('<YOUR_SAVED_PAT_TOKEN>') && !claudeAfterReload.includes(rawToken));

    // Verify Dark/Light theme switching on /developer/config
    await page.getByTestId('theme-toggle-btn').click();
    const lightTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.equal(lightTheme, 'light');
    await page.getByTestId('theme-toggle-btn').click();
    const darkTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.equal(darkTheme, 'dark');
    console.log('PASS: Script 2 — /developer/config my-options least-privilege projection, 3-tab snippets, ephemeral fill & Dark/Light verified');

    // ------------------------------------------------------------------
    // Script 3: Revoke PAT via dangerous confirmation dialog -> DB revoked_at & UI updated
    // ------------------------------------------------------------------
    await page.goto(`${uiBase}/developer/pats`, { waitUntil: 'networkidle' });
    const patId = await page.getByTestId('pat-table-row').first().getAttribute('data-pat-id');
    assert(patId, 'Expected patId attribute on table row');

    await page.getByTestId(`revoke-pat-btn-${patId}`).click();
    await page.getByTestId('pat-revoke-modal').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('pat-revoke-confirm-btn').isDisabled(), true);

    await page.getByTestId('pat-revoke-confirm-input').fill('revoke');
    assert.equal(await page.getByTestId('pat-revoke-confirm-btn').isDisabled(), true, 'Must require exact uppercase REVOKE');

    await page.getByTestId('pat-revoke-confirm-input').fill('REVOKE');
    assert.equal(await page.getByTestId('pat-revoke-confirm-btn').isDisabled(), false);
    await page.getByTestId('pat-revoke-confirm-btn').click();

    await page.getByTestId('pat-revoke-modal').waitFor({ state: 'hidden' });
    await page.getByTestId('pats-empty-state').waitFor({ state: 'visible' });

    const revokedAt = mysqlQuery(`SELECT IF(revoked_at IS NULL, 'NULL', 'SET') FROM sys_pats WHERE id = ${patId}`);
    assert.equal(revokedAt, 'SET', 'sys_pats.revoked_at must be set in real MySQL');
    const revokeAuditCount = mysqlQuery(
      `SELECT COUNT(*) FROM sys_user_approvals WHERE user_id = ${devId} AND action = 'PAT_REVOKE' AND target_type = 'PAT' AND target_id = ${patId}`,
    );
    assert.equal(revokeAuditCount, '1', 'PAT_REVOKE audit record must be written in real MySQL');

    // After revocation, reusing the same PAT name MUST succeed (active-only uniqueness)
    await page.getByTestId('open-create-pat-btn').click();
    await page.getByTestId('pat-create-modal').waitFor({ state: 'visible' });
    await page.getByTestId('pat-name-input').fill('Cursor-Agent-Dev');
    await page.getByTestId('pat-expires-days-input').fill('30');
    await page.getByTestId('pat-create-submit-btn').click();
    await page.getByTestId('pat-reveal-danger-banner').waitFor({ state: 'visible' });
    await page.getByTestId('pat-backup-confirm-checkbox').check();
    await page.getByTestId('pat-done-btn').click();
    await page.getByTestId('pat-create-modal').waitFor({ state: 'hidden' });
    await page.getByTestId('pat-table-row').first().waitFor({ state: 'visible' });
    console.log('PASS: Script 3 — Dangerous REVOKE confirmation dialog revoked PAT in real MySQL, refreshed UI, and allowed post-revoke name reuse');

    // ------------------------------------------------------------------
    // Security P1 Regression: Cross-user React Query cache isolation (in-SPA, ZERO page reload!)
    //   Scenario A: Direct /login account switch without logout
    //   Scenario B: 401 session invalidation (auth_version bump) -> auto /login -> switch to User B
    // ------------------------------------------------------------------
    // Re-issue a fresh PAT for User A so both /developer/pats and /developer/config hold real User A metadata
    const userAPatName = 'UserA-Isolation-Guard-PAT';
    await page.getByTestId('open-create-pat-btn').click();
    await page.getByTestId('pat-create-modal').waitFor({ state: 'visible' });
    await page.getByTestId('pat-name-input').fill(userAPatName);
    await page.getByTestId('pat-expires-days-input').fill('30');
    await page.getByTestId('pat-create-submit-btn').click();
    await page.getByTestId('pat-reveal-danger-banner').waitFor({ state: 'visible' });
    const userARawToken = (await page.getByTestId('pat-secret-output').innerText()).trim();
    const userAPatPrefix = userARawToken.slice(0, 16);
    await page.getByTestId('pat-backup-confirm-checkbox').check();
    await page.getByTestId('pat-done-btn').click();
    await page.getByTestId('pat-create-modal').waitFor({ state: 'hidden' });
    await page.getByTestId('pat-table-row').first().waitFor({ state: 'visible' });

    // Also visit /developer/config in-SPA so User A's profile-options cache is hot in the SAME QueryClient
    await page.locator('#app-sidebar a[href="/developer/config"]').click();
    await page.waitForURL(/\/developer\/config$/);
    await page.getByTestId('profile-chip-prod_analytics').waitFor({ state: 'visible' });

    const forbiddenUserAStrings = [userAPatName, userAPatPrefix, 'prod_analytics', '分析只读主库'];

    const installLeakObserver = async () => {
      await page.evaluate((needles) => {
        const w = window;
        if (w.__m2LeakObserver) {
          w.__m2LeakObserver.disconnect();
        }
        w.__m2LeakHits = [];
        const scan = () => {
          const text = document.body?.innerText ?? '';
          for (const needle of needles) {
            if (text.includes(needle)) {
              w.__m2LeakHits.push(`${window.location.pathname}:${needle}`);
            }
          }
        };
        const observer = new MutationObserver(scan);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        w.__m2LeakObserver = observer;
      }, forbiddenUserAStrings);
    };

    const collectAndStopLeakObserver = async () => {
      return page.evaluate(() => {
        const w = window;
        if (w.__m2LeakObserver) {
          w.__m2LeakObserver.disconnect();
          w.__m2LeakObserver = null;
        }
        return Array.from(new Set(w.__m2LeakHits ?? []));
      });
    };

    // Delay GET /api/v1/pats & /api/v1/profiles/my-options by 250ms during User B checks
    // so any stale cross-user cache flash on initial paint is guaranteed to be observed!
    let delayDeveloperGets = false;
    await page.route(/\/api\/v1\/(pats|profiles\/my-options)$/, async (route) => {
      if (delayDeveloperGets && route.request().method() === 'GET') {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await route.continue();
    });

    // --- Scenario A: Direct SPA navigation to /login WITHOUT clicking logout -> switch to User B ---
    await page.evaluate(() => {
      window.history.pushState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForURL(/\/login$/);
    await page.locator('#login-username').waitFor({ state: 'visible' });

    delayDeveloperGets = true;
    await installLeakObserver();
    await page.fill('#login-username', emptyProfileDev);
    await page.fill('#login-password', emptyProfilePwd);
    await page.getByTestId('login-submit-btn').click();
    await page.waitForURL(/\/dashboard$/);
    await page.getByTestId('dashboard-view').waitFor({ state: 'visible' });

    // Navigate in-SPA to /developer/pats & /developer/config as User B
    await page.locator('#app-sidebar a[href="/developer/pats"]').click();
    await page.waitForURL(/\/developer\/pats$/);
    await page.getByTestId('pats-empty-state').waitFor({ state: 'visible' });

    await page.locator('#app-sidebar a[href="/developer/config"]').click();
    await page.waitForURL(/\/developer\/config$/);
    await page.getByTestId('no-authorized-profiles-alert').waitFor({ state: 'visible' });
    await page.getByTestId('snippet-no-profile-notice').waitFor({ state: 'visible' });

    const scenarioAHits = await collectAndStopLeakObserver();
    delayDeveloperGets = false;
    assert.deepEqual(
      scenarioAHits,
      [],
      `Scenario A leaked User A cached metadata to User B: ${JSON.stringify(scenarioAHits)}`,
    );
    console.log('PASS: Security P1 Scenario A — Direct /login account switch isolated cache with zero transient flash');

    // --- Scenario B: User A session invalidated -> real 401 -> SPA redirect to /login -> User B login ---
    await page.getByTestId('console-logout-btn').click();
    await page.waitForURL(/\/login$/);
    await page.fill('#login-username', devUser);
    await page.fill('#login-password', devPwd);
    await page.getByTestId('login-submit-btn').click();
    await page.waitForURL(/\/dashboard$/);

    // Populate User A caches on both developer pages in-SPA
    await page.locator('#app-sidebar a[href="/developer/config"]').click();
    await page.waitForURL(/\/developer\/config$/);
    await page.getByTestId('profile-chip-prod_analytics').waitFor({ state: 'visible' });

    await page.locator('#app-sidebar a[href="/developer/pats"]').click();
    await page.waitForURL(/\/developer\/pats$/);
    await page.getByTestId('pat-table-row').first().waitFor({ state: 'visible' });

    // Invalidate User A's live session in real MySQL (auth_version bump -> real HTTP 401)
    mysqlQuery(`UPDATE sys_users SET auth_version = auth_version + 1 WHERE id = ${devId}`);

    // Trigger real authenticated API call in-SPA -> 401 handler wipes cache & redirects to /login?returnUrl=...
    await page.getByRole('button', { name: '刷新' }).click();
    await page.waitForURL(/\/login\?returnUrl=%2Fdeveloper%2Fpats$/);
    await page.locator('#login-username').waitFor({ state: 'visible' });

    delayDeveloperGets = true;
    await installLeakObserver();
    await page.fill('#login-username', emptyProfileDev);
    await page.fill('#login-password', emptyProfilePwd);
    await page.getByTestId('login-submit-btn').click();

    // Returns directly to /developer/pats via returnUrl — MUST show zero trace of User A!
    await page.waitForURL(/\/developer\/pats$/);
    await page.getByTestId('pats-empty-state').waitFor({ state: 'visible' });

    await page.locator('#app-sidebar a[href="/developer/config"]').click();
    await page.waitForURL(/\/developer\/config$/);
    await page.getByTestId('no-authorized-profiles-alert').waitFor({ state: 'visible' });

    const scenarioBHits = await collectAndStopLeakObserver();
    delayDeveloperGets = false;
    assert.deepEqual(
      scenarioBHits,
      [],
      `Scenario B leaked User A cached metadata after 401 to User B: ${JSON.stringify(scenarioBHits)}`,
    );
    console.log('PASS: Security P1 Scenario B — 401 invalidation cleared all caches & User B saw zero User A flash');

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
