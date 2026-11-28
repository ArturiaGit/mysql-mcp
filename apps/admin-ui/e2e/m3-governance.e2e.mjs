import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
    logs = (logs + chunk.toString('utf8')).slice(-8000);
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
    'M3 browser E2E requires real Docker MySQL 8.0 env vars (METADATA_DB_USER and METADATA_DB_PASSWORD).',
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
      'M3 browser E2E requires a fresh empty MySQL DB (bootstrap_state = PENDING)',
    );

    const serverPepper = randomBytes(32).toString('hex');
    const adminUser = 'm3_super_admin';
    const adminInitPwd = strongPassword();
    const adminPwd = strongPassword();

    const applicantUser = 'm3_applicant';
    const applicantPwd = strongPassword();

    const secAdminUser = 'm3_sec_admin';
    const secAdminPwd = strongPassword();

    const tempUser = 'm3_temp_user';
    const tempPwd = strongPassword();

    const escCheckUser = 'm3_esc_check';
    const escCheckPwd = strongPassword();

    const rejectedOnlyUser = 'm3_rejected_only';
    const rejectedOnlyPwd = strongPassword();

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
        BOOTSTRAP_ADMIN_PASSWORD: adminInitPwd,
        BOOTSTRAP_ADMIN_EMAIL: 'admin@m3-e2e.test',
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
    const consoleErrors = [];
    let expectedHttpStatuses = new Set();

    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // Chromium automatically logs "Failed to load resource: the server responded with a status of 409 (Conflict)"
      // when intentionally exercising optimistic-lock conflict handling (409) or unauthenticated probes (401).
      const statusMatch = text.match(/responded with a status of (\d{3})/);
      if (statusMatch && expectedHttpStatuses.has(Number(statusMatch[1]))) {
        return;
      }
      consoleErrors.push(text);
    });

    const assertZeroEmoji = async (label) => {
      const text = await page.evaluate(() => document.body.innerText);
      assert(!/\p{Extended_Pictographic}/u.test(text), `Emoji detected on ${label}`);
    };

    const assertAuthTopbarStatusBadge = async (
      targetPage,
      expectedLabel,
      expectedCode,
      expectedVariantClass,
      routeLabel,
    ) => {
      const topbarBadge = targetPage.getByTestId('auth-topbar-user-status-badge');
      await topbarBadge.waitFor({ state: 'visible' });
      assert.equal(
        (await topbarBadge.innerText()).trim(),
        expectedLabel,
        `Expected AuthLayout topbar status badge on ${routeLabel} to display "${expectedLabel}"`,
      );
      assert.equal(
        await topbarBadge.getAttribute('title'),
        expectedCode,
        `Expected AuthLayout topbar status badge title on ${routeLabel} to be "${expectedCode}"`,
      );
      const className = (await topbarBadge.getAttribute('class')) ?? '';
      assert(
        className.includes(expectedVariantClass),
        `Expected AuthLayout topbar status badge on ${routeLabel} to keep semantic variant "${expectedVariantClass}", got "${className}"`,
      );
      assert(
        !className.includes('font-mono'),
        `Expected AuthLayout topbar status badge on ${routeLabel} NOT to use font-mono, got "${className}"`,
      );
    };

    const loginAs = async (username, password) => {
      await page.goto(`${uiBase}/login`, { waitUntil: 'networkidle' });
      await page.fill('#login-username', username);
      await page.fill('#login-password', password);
      await page.getByTestId('login-submit-btn').click();
    };

    const registerUser = async (username, password, email, department, reason) => {
      await page.goto(`${uiBase}/register`, { waitUntil: 'networkidle' });
      await page.fill('#register-username', username);
      await page.fill('#register-password', password);
      await page.fill('#register-email', email);
      await page.fill('#register-department', department);
      await page.fill('#register-reason', reason);
      await page.getByTestId('register-submit-btn').click();
      await page.getByTestId('register-complete-card').waitFor({ state: 'visible' });
    };

    // ------------------------------------------------------------------
    // Step 0: Bootstrap SUPER_ADMIN first login & mandatory password change
    // ------------------------------------------------------------------
    await loginAs(adminUser, adminInitPwd);
    await page.waitForURL(/\/change-password$/);
    await assertAuthTopbarStatusBadge(page, '活跃', 'ACTIVE', 'text-safe', '/change-password');
    await page.fill('#old-password', adminInitPwd);
    await page.fill('#new-password', adminPwd);
    await page.fill('#confirm-password', adminPwd);
    await page.getByTestId('change-password-submit-btn').click();
    await page.waitForURL(/\/dashboard$/);
    await page.getByTestId('dashboard-view').waitFor({ state: 'visible' });

    await page.getByTestId('console-logout-btn').click();
    await page.waitForURL(/\/login$/);
    console.log('PASS: Bootstrap SUPER_ADMIN activated via mandatory password change');

    // ------------------------------------------------------------------
    // Script 1: Full Onboarding Loop
    // Anonymous register -> /approvals empty-reason block -> Reject -> /approvals/re Resubmit -> Approve with real role -> New user login
    // ------------------------------------------------------------------
    await registerUser(
      applicantUser,
      applicantPwd,
      'applicant@m3-e2e.test',
      'Data Platform',
      'Initial access request for analytics queries',
    );
    await registerUser(
      secAdminUser,
      secAdminPwd,
      'secadmin@m3-e2e.test',
      'Security Ops',
      'Security administrator onboarding',
    );
    await registerUser(
      tempUser,
      tempPwd,
      'temp@m3-e2e.test',
      'Core Engineering',
      'Temporary account for lifecycle tests',
    );
    await registerUser(
      escCheckUser,
      escCheckPwd,
      'esccheck@m3-e2e.test',
      'QA Lab',
      'Pending ticket for SECURITY_ADMIN privilege escalation check',
    );
    await registerUser(
      rejectedOnlyUser,
      rejectedOnlyPwd,
      'rejected@m3-e2e.test',
      'External Partner',
      'Rejected ticket retained for /users status localization and 4-column alignment check',
    );

    // Super admin logs in and navigates to /approvals
    await loginAs(adminUser, adminPwd);
    await page.waitForURL(/\/dashboard$/);
    await page.locator('#app-sidebar a[href="/approvals"]').click();
    await page.waitForURL(/\/approvals$/);
    await page.getByTestId('approvals-view').waitFor({ state: 'visible' });
    await page.getByTestId(`reject-ticket-btn-${applicantUser}`).waitFor({ state: 'visible' });
    await assertZeroEmoji('/approvals');

    // Verify localized Chinese pending badge on /approvals with title="PENDING"
    const approvalsPendingBadge = page.getByTestId('approvals-pending-badge');
    assert.match(
      (await approvalsPendingBadge.innerText()).trim(),
      /^\d+\s*条待审批$/,
      'Expected Chinese pending count badge on /approvals',
    );
    assert.equal(await approvalsPendingBadge.getAttribute('title'), 'PENDING');

    // Verify Topbar=56px and Table Row=38px on /approvals
    const approvalsTopbarBox = await page.getByTestId('app-topbar').boundingBox();
    assert(
      approvalsTopbarBox && Math.round(approvalsTopbarBox.height) === 56,
      `Expected Topbar 56px on /approvals, got ${approvalsTopbarBox?.height}`,
    );
    const approvalRowBox = await page.getByTestId('approval-table-row').first().boundingBox();
    assert(
      approvalRowBox && Math.round(approvalRowBox.height) === 38,
      `Expected 38px table row on /approvals, got ${approvalRowBox?.height}`,
    );

    // Reject with empty / whitespace-only reason -> MUST be blocked client-side
    await page.getByTestId(`reject-ticket-btn-${applicantUser}`).click();
    await page.getByTestId('reject-approval-modal').waitFor({ state: 'visible' });
    await page.getByTestId('reject-confirm-submit-btn').click();
    await page.getByTestId('reject-reason-error').waitFor({ state: 'visible' });
    const emptyReasonErr = (await page.getByTestId('reject-reason-error').innerText()).trim();
    assert(emptyReasonErr.length > 0, 'Empty reject reason must show explicit validation error');

    await page.getByTestId('reject-reason-input').fill('    ');
    await page.getByTestId('reject-confirm-submit-btn').click();
    assert.equal(await page.getByTestId('reject-approval-modal').isVisible(), true);

    // Fill real reject reason and submit
    const rejectReasonText = '请补充业务主管审批单号，并写明目标查询库范围';
    await page.getByTestId('reject-reason-input').fill(rejectReasonText);
    await page.getByTestId('reject-confirm-submit-btn').click();
    await page.getByTestId('reject-approval-modal').waitFor({ state: 'hidden' });
    await page.getByTestId(`reject-ticket-btn-${applicantUser}`).waitFor({ state: 'hidden' });

    // Reject rejectedOnlyUser so /users renders a REJECTED row alongside ACTIVE/DISABLED/PENDING
    await page.getByTestId(`reject-ticket-btn-${rejectedOnlyUser}`).click();
    await page.getByTestId('reject-approval-modal').waitFor({ state: 'visible' });
    await page.getByTestId('reject-reason-input').fill('外部协作账号暂不开放直连权限');
    await page.getByTestId('reject-confirm-submit-btn').click();
    await page.getByTestId('reject-approval-modal').waitFor({ state: 'hidden' });
    await page.getByTestId(`reject-ticket-btn-${rejectedOnlyUser}`).waitFor({ state: 'hidden' });

    // Also approve secAdminUser (SECURITY_ADMIN) and tempUser (DEVELOPER)
    await page.getByTestId(`approve-ticket-btn-${secAdminUser}`).click();
    await page.getByTestId('approve-approval-modal').waitFor({ state: 'visible' });
    // Empty role selection MUST be blocked
    await page.getByTestId('approve-confirm-submit-btn').click();
    await page.getByTestId('approve-roles-error').waitFor({ state: 'visible' });
    await page.getByTestId('approve-role-checkbox-SECURITY_ADMIN').check();
    await page.getByTestId('approve-confirm-submit-btn').click();
    await page.getByTestId('approve-approval-modal').waitFor({ state: 'hidden' });
    await page.getByTestId(`approve-ticket-btn-${secAdminUser}`).waitFor({ state: 'hidden' });

    await page.getByTestId(`approve-ticket-btn-${tempUser}`).click();
    await page.getByTestId('approve-approval-modal').waitFor({ state: 'visible' });
    await page.getByTestId('approve-role-checkbox-DEVELOPER').check();
    await page.getByTestId('approve-confirm-submit-btn').click();
    await page.getByTestId('approve-approval-modal').waitFor({ state: 'hidden' });
    await page.getByTestId(`approve-ticket-btn-${tempUser}`).waitFor({ state: 'hidden' });

    // Logout super admin -> applicant logs in -> /approvals/re -> verifies reject reason -> resubmits
    await page.getByTestId('console-logout-btn').click();
    await page.waitForURL(/\/login$/);

    await loginAs(applicantUser, applicantPwd);
    await page.waitForURL(/\/approvals\/re$/);
    await page.getByTestId('resubmit-approval-card').waitFor({ state: 'visible' });
    const rejectedBadge = page.getByTestId('rejected-status-badge');
    assert.equal(
      (await rejectedBadge.innerText()).trim(),
      '已驳回',
      'Expected /approvals/re status badge to display Chinese label 已驳回',
    );
    assert.equal(await rejectedBadge.getAttribute('title'), 'REJECTED');
    await assertAuthTopbarStatusBadge(page, '已驳回', 'REJECTED', 'text-danger', '/approvals/re');
    const displayedRejectReason = (await page.getByTestId('reject-reason-box').innerText()).trim();
    assert(
      displayedRejectReason.includes(rejectReasonText),
      `Expected /approvals/re to show reject reason "${rejectReasonText}", got "${displayedRejectReason}"`,
    );

    const resubmittedReason = '已补充审批单 REQ-2026-M3，仅需 analytics_db 只读分析权限';
    await page.fill('#resubmit-reason', resubmittedReason);
    await page.getByTestId('resubmit-submit-btn').click();
    await page.waitForURL(/\/approvals\/wait$/);
    await page.getByTestId('pending-approval-card').waitFor({ state: 'visible' });
    const pendingBadge = page.getByTestId('pending-status-badge');
    assert.equal(
      (await pendingBadge.innerText()).trim(),
      '待审批',
      'Expected /approvals/wait status badge to display Chinese label 待审批',
    );
    assert.equal(await pendingBadge.getAttribute('title'), 'PENDING');
    await assertAuthTopbarStatusBadge(page, '待审批', 'PENDING', 'text-warning', '/approvals/wait');

    // Logout applicant -> SECURITY_ADMIN logs in -> verifies privilege escalation lock on SUPER_ADMIN role
    await page.getByTestId('auth-logout-btn').click();
    await page.waitForURL(/\/login$/);

    await loginAs(secAdminUser, secAdminPwd);
    await page.waitForURL(/\/dashboard$/);
    await page.locator('#app-sidebar a[href="/approvals"]').click();
    await page.waitForURL(/\/approvals$/);
    await page.getByTestId(`approve-ticket-btn-${escCheckUser}`).waitFor({ state: 'visible' });

    await page.getByTestId(`approve-ticket-btn-${escCheckUser}`).click();
    await page.getByTestId('approve-approval-modal').waitFor({ state: 'visible' });
    assert.equal(
      await page.getByTestId('approve-role-checkbox-SUPER_ADMIN').isDisabled(),
      true,
      'SECURITY_ADMIN must NOT be allowed to assign SUPER_ADMIN role',
    );
    await page.keyboard.press('Escape');
    await page.getByTestId('approve-approval-modal').waitFor({ state: 'hidden' });

    // SECURITY_ADMIN cannot access /users (L4 RoleGuard blocks -> renders 403 rbac-forbidden-card)
    await page.goto(`${uiBase}/users`, { waitUntil: 'networkidle' });
    await page.getByTestId('rbac-forbidden-card').waitFor({ state: 'visible' });

    // Approve resubmitted applicant as SECURITY_ADMIN with DEVELOPER role
    await page.goto(`${uiBase}/approvals`, { waitUntil: 'networkidle' });
    const applicantRowText = await page
      .locator(`[data-testid="approval-table-row"][data-username="${applicantUser}"]`)
      .innerText();
    assert(
      applicantRowText.includes(resubmittedReason),
      `Expected resubmitted reason in /approvals table, got: ${applicantRowText}`,
    );
    await page.getByTestId(`approve-ticket-btn-${applicantUser}`).click();
    await page.getByTestId('approve-approval-modal').waitFor({ state: 'visible' });
    await page.getByTestId('approve-role-checkbox-DEVELOPER').check();
    await page.getByTestId('approve-confirm-submit-btn').click();
    await page.getByTestId('approve-approval-modal').waitFor({ state: 'hidden' });
    await page.getByTestId(`approve-ticket-btn-${applicantUser}`).waitFor({ state: 'hidden' });

    // Logout SECURITY_ADMIN -> newly approved applicant logs in and enters /dashboard
    await page.getByTestId('console-logout-btn').click();
    await page.waitForURL(/\/login$/);
    await loginAs(applicantUser, applicantPwd);
    await page.waitForURL(/\/dashboard$/);
    await page.getByTestId('dashboard-view').waitFor({ state: 'visible' });
    await page.getByTestId('console-logout-btn').click();
    await page.waitForURL(/\/login$/);
    console.log(
      'PASS: Script 1 — Full onboarding loop (register -> empty reason block -> reject -> resubmit -> SECURITY_ADMIN guard -> approve -> active login)',
    );

    // ------------------------------------------------------------------
    // Script 2: /users Geometry, Hygiene, URL-SSOT Filters & Self / Last-SUPER_ADMIN Guardrails
    // ------------------------------------------------------------------
    await loginAs(adminUser, adminPwd);
    await page.waitForURL(/\/dashboard$/);
    await page.locator('#app-sidebar a[href="/users"]').click();
    await page.waitForURL(/\/users$/);
    await page.getByTestId('users-view').waitFor({ state: 'visible' });
    await page.getByTestId('user-table-row').first().waitFor({ state: 'visible' });
    await assertZeroEmoji('/users');

    // Verify zero fabricated inviteUser button
    const usersBodyText = await page.evaluate(() => document.body.innerText);
    assert(!usersBodyText.includes('邀请新成员'), 'Fabricated inviteUser UI must NOT exist on /users');

    // Verify Topbar=56px and 38px table row height on /users
    const usersTopbarBox = await page.getByTestId('app-topbar').boundingBox();
    assert(
      usersTopbarBox && Math.round(usersTopbarBox.height) === 56,
      `Expected Topbar 56px on /users, got ${usersTopbarBox?.height}`,
    );
    const userRowBox = await page.getByTestId('user-table-row').first().boundingBox();
    assert(
      userRowBox && Math.round(userRowBox.height) === 38,
      `Expected 38px table row on /users, got ${userRowBox?.height}`,
    );

    // Verify Self & Last SUPER_ADMIN guardrails (disabled buttons + lock icon + Tooltip)
    await page.getByTestId(`user-self-badge-${adminUser}`).waitFor({ state: 'visible' });
    await page.getByTestId(`user-last-super-badge-${adminUser}`).waitFor({ state: 'visible' });

    const selfDisableBtn = page.getByTestId(`toggle-status-btn-${adminUser}`);
    const selfDeleteBtn = page.getByTestId(`delete-user-btn-${adminUser}`);
    assert.equal(await selfDisableBtn.isDisabled(), true, 'Self/Last SUPER_ADMIN disable button must be disabled');
    assert.equal(await selfDeleteBtn.isDisabled(), true, 'Self/Last SUPER_ADMIN delete button must be disabled');
    assert.equal(
      await selfDisableBtn.locator('svg').count(),
      1,
      'Self/Last SUPER_ADMIN disable button must display lock icon',
    );
    assert.equal(
      await selfDeleteBtn.locator('svg').count(),
      1,
      'Self/Last SUPER_ADMIN delete button must display lock icon',
    );

    // Hover & focus guardrail wrappers to verify Tooltip renders clear protection message
    await page.getByTestId(`toggle-status-guard-wrap-${adminUser}`).hover();
    await page.getByTestId(`toggle-status-tooltip-${adminUser}`).waitFor({ state: 'visible' });
    const disableTooltipText = (
      await page.getByTestId(`toggle-status-tooltip-${adminUser}`).innerText()
    ).trim();
    assert(
      disableTooltipText.includes('当前登录账号自身') && disableTooltipText.includes('活跃超级管理员'),
      `Unexpected disable guardrail tooltip: ${disableTooltipText}`,
    );

    // Dismiss first tooltip before inspecting the adjacent delete guardrail tooltip (also validates keyboard focus)
    await page.mouse.move(10, 10);
    await page.keyboard.press('Escape');
    await page.getByTestId(`toggle-status-tooltip-${adminUser}`).waitFor({ state: 'hidden' });

    await page.getByTestId(`delete-user-guard-wrap-${adminUser}`).focus();
    await page.getByTestId(`delete-user-tooltip-${adminUser}`).waitFor({ state: 'visible' });
    const deleteTooltipText = (
      await page.getByTestId(`delete-user-tooltip-${adminUser}`).innerText()
    ).trim();
    assert(
      deleteTooltipText.includes('当前登录账号自身') && deleteTooltipText.includes('活跃超级管理员'),
      `Unexpected delete guardrail tooltip: ${deleteTooltipText}`,
    );
    await page.keyboard.press('Escape');

    // Open Edit Roles modal for self/last SUPER_ADMIN -> SUPER_ADMIN checkbox MUST be checked & disabled
    await page.getByTestId(`edit-roles-btn-${adminUser}`).click();
    await page.getByTestId('edit-user-roles-modal').waitFor({ state: 'visible' });
    await page.getByTestId('edit-roles-super-admin-lock-notice').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('edit-role-checkbox-SUPER_ADMIN').isChecked(), true);
    assert.equal(await page.getByTestId('edit-role-checkbox-SUPER_ADMIN').isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.getByTestId('edit-user-roles-modal').waitFor({ state: 'hidden' });

    // PENDING user row (escCheckUser) must route to /approvals instead of showing toggle button
    await page.getByTestId(`go-approval-link-${escCheckUser}`).waitFor({ state: 'visible' });
    assert.equal(await page.locator(`[data-testid="toggle-status-btn-${escCheckUser}"]`).count(), 0);

    // REJECTED user row (rejectedOnlyUser) must display approval flow indicator instead of toggle button
    await page.getByTestId(`approval-flow-badge-${rejectedOnlyUser}`).waitFor({ state: 'visible' });
    assert.equal(await page.locator(`[data-testid="toggle-status-btn-${rejectedOnlyUser}"]`).count(), 0);

    // Verify Chinese status badges + English code hover titles on /users
    const assertStatusBadge = async (username, expectedLabel, expectedCode) => {
      const badge = page.getByTestId(`user-status-badge-${username}`);
      assert.equal(
        (await badge.innerText()).trim(),
        expectedLabel,
        `Expected status badge for ${username} to be "${expectedLabel}"`,
      );
      assert.equal(
        await badge.getAttribute('title'),
        expectedCode,
        `Expected status badge title for ${username} to be "${expectedCode}"`,
      );
    };
    await assertStatusBadge(adminUser, '活跃', 'ACTIVE');
    await assertStatusBadge(escCheckUser, '待审批', 'PENDING');
    await assertStatusBadge(rejectedOnlyUser, '已驳回', 'REJECTED');

    // Verify Chinese bound role display names + English role_name hover titles
    const superAdminRoleBadge = page.locator(
      `[data-testid="user-roles-cell-${adminUser}"] [data-role-name="SUPER_ADMIN"]`,
    );
    assert.equal((await superAdminRoleBadge.innerText()).trim(), '超级管理员');
    assert.equal(await superAdminRoleBadge.getAttribute('title'), 'SUPER_ADMIN');

    const secAdminRoleBadge = page.locator(
      `[data-testid="user-roles-cell-${secAdminUser}"] [data-role-name="SECURITY_ADMIN"]`,
    );
    assert.equal((await secAdminRoleBadge.innerText()).trim(), '安全管理员');
    assert.equal(await secAdminRoleBadge.getAttribute('title'), 'SECURITY_ADMIN');

    // URL SearchParams SSOT filter check (search + status + role + reload persistence)
    await page.getByTestId('users-search-input').fill(tempUser);
    await page.getByTestId('users-search-submit-btn').click();
    await page.waitForURL(new RegExp(`search=${tempUser}`));
    await page.getByTestId('users-status-filter').selectOption('ACTIVE');
    await page.waitForURL(/status=ACTIVE/);
    await page.getByTestId('users-role-filter').selectOption('DEVELOPER');
    await page.waitForURL(/role=DEVELOPER/);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.getByTestId('users-search-input').inputValue(), tempUser);
    assert.equal(await page.getByTestId('user-table-row').count(), 1);
    await page.getByTestId('users-clear-filters-btn').click();
    await page.waitForURL(/\/users$/);
    console.log(
      'PASS: Script 2 — /users geometry (56px/38px), zero Emoji, URL-SSOT filters & self/last SUPER_ADMIN guardrails (disabled + lock icon + Tooltip) verified',
    );

    // ------------------------------------------------------------------
    // Script 3: Edit Roles + Real 409 Optimistic Lock Conflict Draft Preservation
    // ------------------------------------------------------------------
    await page.getByTestId(`edit-roles-btn-${tempUser}`).click();
    await page.getByTestId('edit-user-roles-modal').waitFor({ state: 'visible' });
    // Draft change: also grant ANALYST
    await page.getByTestId('edit-role-checkbox-ANALYST').check();
    assert.equal(await page.getByTestId('edit-role-checkbox-ANALYST').isChecked(), true);

    // Simulate concurrent edit in real MySQL -> triggers real HTTP 409 ERR_CONCURRENCY_CONFLICT
    mysqlQuery(`UPDATE sys_users SET version = version + 1 WHERE username = '${tempUser}'`);

    expectedHttpStatuses = new Set([409]);
    await page.getByTestId('edit-roles-submit-btn').click();
    await page.getByTestId('edit-roles-conflict-banner').waitFor({ state: 'visible' });
    expectedHttpStatuses = new Set();

    // Draft MUST remain intact after 409
    assert.equal(
      await page.getByTestId('edit-role-checkbox-ANALYST').isChecked(),
      true,
      'Role selection draft MUST be preserved on 409 ERR_CONCURRENCY_CONFLICT',
    );
    assert.equal(
      await page.getByTestId('edit-role-checkbox-DEVELOPER').isChecked(),
      true,
      'Existing role selection MUST remain checked on 409',
    );

    // Load latest version preserving draft -> retry submit -> succeeds
    await page.getByTestId('edit-roles-load-latest-keep-draft-btn').click();
    await page.getByTestId('edit-roles-version-reloaded-notice').waitFor({ state: 'visible' });
    assert.equal(
      await page.getByTestId('edit-role-checkbox-ANALYST').isChecked(),
      true,
      'Role draft MUST remain preserved after loading latest version',
    );
    await page.getByTestId('edit-roles-submit-btn').click();
    await page.getByTestId('edit-user-roles-modal').waitFor({ state: 'hidden' });

    await page.waitForFunction(
      (uname) => {
        const cell = document.querySelector(`[data-testid="user-roles-cell-${uname}"]`);
        const dev = cell?.querySelector('[data-role-name="DEVELOPER"]');
        const analyst = cell?.querySelector('[data-role-name="ANALYST"]');
        return (
          dev?.textContent?.trim() === '业务研发人员' &&
          dev?.getAttribute('title') === 'DEVELOPER' &&
          analyst?.textContent?.trim() === '数据分析师' &&
          analyst?.getAttribute('title') === 'ANALYST'
        );
      },
      tempUser,
    );
    console.log('PASS: Script 3 — Edit roles 409 conflict preserved draft, reloaded latest version, persisted to real MySQL, and rendered Chinese role badges with English code titles');

    // ------------------------------------------------------------------
    // Script 4: Status Toggle (ACTIVE -> DISABLED -> ACTIVE) + 4-Column Alignment Across All 4 Statuses
    // ------------------------------------------------------------------
    await page.getByTestId(`toggle-status-btn-${tempUser}`).click();
    await page.getByTestId('toggle-user-status-modal').waitFor({ state: 'visible' });
    assert.equal((await page.getByTestId('toggle-status-from-badge').innerText()).trim(), '活跃');
    assert.equal(await page.getByTestId('toggle-status-from-badge').getAttribute('title'), 'ACTIVE');
    assert.equal((await page.getByTestId('toggle-status-to-badge').innerText()).trim(), '已停用');
    assert.equal(await page.getByTestId('toggle-status-to-badge').getAttribute('title'), 'DISABLED');
    await page.getByTestId('toggle-status-confirm-btn').click();
    await page.getByTestId('toggle-user-status-modal').waitFor({ state: 'hidden' });
    await page.waitForFunction(
      (uname) => {
        const badge = document.querySelector(`[data-testid="user-status-badge-${uname}"]`);
        return badge?.textContent?.trim() === '已停用' && badge?.getAttribute('title') === 'DISABLED';
      },
      tempUser,
    );
    assert.equal(mysqlQuery(`SELECT status FROM sys_users WHERE username = '${tempUser}'`), 'DISABLED');

    // Now all 4 statuses (ACTIVE, DISABLED, PENDING, REJECTED) are simultaneously rendered in /users!
    // Verify 38px row height AND pixel-exact 4-column action alignment across all 4 status rows.
    const mixedStatusRows = [
      { status: 'ACTIVE', user: adminUser, slot2TestId: `toggle-status-btn-${adminUser}` },
      { status: 'DISABLED', user: tempUser, slot2TestId: `toggle-status-btn-${tempUser}` },
      { status: 'PENDING', user: escCheckUser, slot2TestId: `go-approval-link-${escCheckUser}` },
      { status: 'REJECTED', user: rejectedOnlyUser, slot2TestId: `approval-flow-badge-${rejectedOnlyUser}` },
    ];

    const slotBoxes = { slot1: [], slot2: [], slot3: [], slot4: [] };
    for (const entry of mixedStatusRows) {
      const rowBox = await page
        .locator(`[data-testid="user-table-row"][data-username="${entry.user}"]`)
        .boundingBox();
      assert(
        rowBox && Math.round(rowBox.height) === 38,
        `Expected 38px row height for ${entry.status} row (${entry.user}), got ${rowBox?.height}`,
      );
      const b1 = await page.getByTestId(`edit-roles-btn-${entry.user}`).boundingBox();
      const b2 = await page.getByTestId(entry.slot2TestId).boundingBox();
      const b3 = await page.getByTestId(`reset-password-btn-${entry.user}`).boundingBox();
      const b4 = await page.getByTestId(`delete-user-btn-${entry.user}`).boundingBox();
      assert(b1 && b2 && b3 && b4, `Missing action slot boundingBox for ${entry.status} (${entry.user})`);
      slotBoxes.slot1.push({ ...entry, ...b1 });
      slotBoxes.slot2.push({ ...entry, ...b2 });
      slotBoxes.slot3.push({ ...entry, ...b3 });
      slotBoxes.slot4.push({ ...entry, ...b4 });
    }

    for (const [slotName, boxes] of Object.entries(slotBoxes)) {
      const ref = boxes[0];
      for (const box of boxes.slice(1)) {
        assert(
          Math.abs(box.x - ref.x) <= 0.5 && Math.abs(box.width - ref.width) <= 0.5,
          `Action ${slotName} misaligned between ${ref.status} (${ref.user}: x=${ref.x}, w=${ref.width}) and ${box.status} (${box.user}: x=${box.x}, w=${box.width})`,
        );
      }
    }
    console.log(
      `PASS: 4-column action alignment verified across ACTIVE/DISABLED/PENDING/REJECTED rows (slot1 x=${slotBoxes.slot1[0].x.toFixed(1)} w=${slotBoxes.slot1[0].width.toFixed(1)}, slot2 x=${slotBoxes.slot2[0].x.toFixed(1)} w=${slotBoxes.slot2[0].width.toFixed(1)}, slot3 x=${slotBoxes.slot3[0].x.toFixed(1)} w=${slotBoxes.slot3[0].width.toFixed(1)}, slot4 x=${slotBoxes.slot4[0].x.toFixed(1)} w=${slotBoxes.slot4[0].width.toFixed(1)})`,
    );

    // Verify DISABLED user login hits /forbidden with localized AuthLayout topbar & card status badges
    const disabledContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const disabledPage = await disabledContext.newPage();
      disabledPage.on('pageerror', (err) => pageErrors.push(err.message));
      await disabledPage.goto(`${uiBase}/login`, { waitUntil: 'networkidle' });
      await disabledPage.fill('#login-username', tempUser);
      await disabledPage.fill('#login-password', tempPwd);
      await disabledPage.getByTestId('login-submit-btn').click();
      await disabledPage.waitForURL(/\/forbidden$/);
      await disabledPage.getByTestId('account-disabled-card').waitFor({ state: 'visible' });
      const disabledCardBadge = disabledPage.getByTestId('disabled-status-badge');
      assert.equal((await disabledCardBadge.innerText()).trim(), '已停用');
      assert.equal(await disabledCardBadge.getAttribute('title'), 'DISABLED');
      await assertAuthTopbarStatusBadge(disabledPage, '已停用', 'DISABLED', 'text-danger', '/forbidden');
      await disabledPage.getByTestId('auth-logout-btn').click();
      await disabledPage.waitForURL(/\/login$/);
    } finally {
      await disabledContext.close();
    }

    // Re-enable back to ACTIVE
    await page.getByTestId(`toggle-status-btn-${tempUser}`).click();
    await page.getByTestId('toggle-user-status-modal').waitFor({ state: 'visible' });
    assert.equal((await page.getByTestId('toggle-status-from-badge').innerText()).trim(), '已停用');
    assert.equal((await page.getByTestId('toggle-status-to-badge').innerText()).trim(), '活跃');
    await page.getByTestId('toggle-status-confirm-btn').click();
    await page.getByTestId('toggle-user-status-modal').waitFor({ state: 'hidden' });
    await page.waitForFunction(
      (uname) => {
        const badge = document.querySelector(`[data-testid="user-status-badge-${uname}"]`);
        return badge?.textContent?.trim() === '活跃' && badge?.getAttribute('title') === 'ACTIVE';
      },
      tempUser,
    );
    assert.equal(mysqlQuery(`SELECT status FROM sys_users WHERE username = '${tempUser}'`), 'ACTIVE');
    console.log('PASS: Script 4 — User status disable & re-enable persisted in real MySQL and updated Chinese status UI');

    // ------------------------------------------------------------------
    // Script 5: Reset Password (409 Draft Preservation + One-Time Reveal + Close Memory Wipe)
    // ------------------------------------------------------------------
    const draftManualPwd = 'DraftKeep!2026Aa';
    await page.getByTestId(`reset-password-btn-${tempUser}`).click();
    await page.getByTestId('reset-password-modal').waitFor({ state: 'visible' });
    await page.getByTestId('reset-mode-manual-btn').click();
    await page.getByTestId('reset-manual-password-input').fill(draftManualPwd);
    await page.getByTestId('reset-must-change-checkbox').uncheck();

    // Simulate concurrent update in real MySQL -> triggers real HTTP 409
    mysqlQuery(`UPDATE sys_users SET version = version + 1 WHERE username = '${tempUser}'`);
    expectedHttpStatuses = new Set([409]);
    await page.getByTestId('reset-password-submit-btn').click();
    await page.getByTestId('reset-password-conflict-banner').waitFor({ state: 'visible' });
    expectedHttpStatuses = new Set();

    // Password & checkbox draft MUST be preserved on 409
    assert.equal(
      await page.getByTestId('reset-manual-password-input').inputValue(),
      draftManualPwd,
      'Manual temporary password draft MUST be preserved on 409',
    );
    assert.equal(
      await page.getByTestId('reset-must-change-checkbox').isChecked(),
      false,
      'mustChangePassword checkbox draft MUST be preserved on 409',
    );

    // Load latest version preserving draft
    await page.getByTestId('reset-password-load-latest-keep-draft-btn').click();
    await page.getByTestId('reset-password-version-reloaded-notice').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('reset-manual-password-input').inputValue(), draftManualPwd);
    assert.equal(await page.getByTestId('reset-must-change-checkbox').isChecked(), false);

    // Switch to auto-generated password + mustChangePassword=true and submit
    await page.getByTestId('reset-mode-auto-btn').click();
    await page.getByTestId('reset-must-change-checkbox').check();
    await page.getByTestId('reset-password-submit-btn').click();
    await page.getByTestId('reset-password-reveal-modal').waitFor({ state: 'visible' });

    const revealedTempPwd = (await page.getByTestId('reset-temporary-password-output').innerText()).trim();
    assert(revealedTempPwd.length >= 8, `Expected strong generated temporary password, got length ${revealedTempPwd.length}`);
    assert.notEqual(revealedTempPwd, draftManualPwd);

    // Verify visibility toggle hides and restores plaintext before closing
    await page.getByTestId('reset-reveal-toggle-visibility-btn').click();
    const maskedText = (await page.getByTestId('reset-temporary-password-output').innerText()).trim();
    assert(!maskedText.includes(revealedTempPwd), 'Toggling visibility off must mask temporary password');
    await page.getByTestId('reset-reveal-toggle-visibility-btn').click();

    // Verify zero storage/URL leakage while open
    const openLeak = await page.evaluate((secret) => ({
      lsHit: JSON.stringify(window.localStorage).includes(secret),
      ssHit: JSON.stringify(window.sessionStorage).includes(secret),
      urlHit: window.location.href.includes(secret),
    }), revealedTempPwd);
    assert.deepEqual(openLeak, { lsHit: false, ssHit: false, urlHit: false });

    // Close modal -> MUST wipe temporary password from DOM & memory
    await page.getByTestId('reset-reveal-done-btn').click();
    await page.getByTestId('reset-password-reveal-modal').waitFor({ state: 'hidden' });

    const closedLeak = await page.evaluate((secret) => ({
      domHit: document.documentElement.innerHTML.includes(secret),
      lsHit: JSON.stringify(window.localStorage).includes(secret),
      ssHit: JSON.stringify(window.sessionStorage).includes(secret),
      urlHit: window.location.href.includes(secret),
    }), revealedTempPwd);
    assert.deepEqual(closedLeak, { domHit: false, lsHit: false, ssHit: false, urlHit: false });

    // Re-opening reset modal must start fresh in form phase with zero previous secret
    await page.getByTestId(`reset-password-btn-${tempUser}`).click();
    await page.getByTestId('reset-password-modal').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-testid="reset-password-reveal-modal"]').count(), 0);
    const reopenDomHit = await page.evaluate(
      (secret) => document.documentElement.innerHTML.includes(secret),
      revealedTempPwd,
    );
    assert.equal(reopenDomHit, false, 'Temporary password must NEVER reappear after reopen');
    await page.keyboard.press('Escape');
    await page.getByTestId('reset-password-modal').waitFor({ state: 'hidden' });
    console.log(
      'PASS: Script 5 — Reset password 409 draft preservation, one-time reveal, and close-time memory wipe verified',
    );

    // ------------------------------------------------------------------
    // Script 6: Delete Non-Super-Admin User + Real MySQL Verification
    // ------------------------------------------------------------------
    await page.getByTestId(`delete-user-btn-${tempUser}`).click();
    await page.getByTestId('delete-user-modal').waitFor({ state: 'visible' });
    assert.equal(await page.getByTestId('delete-user-confirm-btn').isDisabled(), true);

    await page.getByTestId('delete-user-confirm-input').fill('wrong_user');
    assert.equal(await page.getByTestId('delete-user-confirm-btn').isDisabled(), true);

    await page.getByTestId('delete-user-confirm-input').fill(tempUser);
    assert.equal(await page.getByTestId('delete-user-confirm-btn').isDisabled(), false);
    await page.getByTestId('delete-user-confirm-btn').click();
    await page.getByTestId('delete-user-modal').waitFor({ state: 'hidden' });

    await page.waitForFunction(
      (uname) => document.querySelector(`[data-testid="user-table-row"][data-username="${uname}"]`) === null,
      tempUser,
    );
    assert.equal(
      mysqlQuery(`SELECT COUNT(*) FROM sys_users WHERE username = '${tempUser}'`),
      '0',
      'Deleted user must be physically removed from real MySQL sys_users',
    );
    console.log('PASS: Script 6 — Non-super-admin user deletion confirmed and verified in real MySQL');

    // ------------------------------------------------------------------
    // Script 7: Dark & Light Theme Switch Check on /users & /approvals
    // ------------------------------------------------------------------
    await page.getByTestId('theme-toggle-btn').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await page.getByTestId('theme-toggle-btn').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');

    assert.equal(pageErrors.length, 0, `Unexpected browser pageerrors: ${pageErrors.join('; ')}`);
    assert.equal(consoleErrors.length, 0, `Unexpected browser console errors: ${consoleErrors.join('; ')}`);
    console.log('PASS: Script 7 — Dark/Light themes verified with ZERO pageerrors and ZERO console errors');
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
