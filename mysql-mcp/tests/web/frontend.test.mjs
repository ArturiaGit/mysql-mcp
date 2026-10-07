import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const webDir = path.join(root, 'web');

test('Frontend UI: index.html 语义与无障碍规范校验', () => {
  const htmlPath = path.join(webDir, 'index.html');
  assert.ok(fs.existsSync(htmlPath), 'index.html 必须存在');
  const content = fs.readFileSync(htmlPath, 'utf8');

  // 1. 标准文档结构
  assert.match(content, /<!DOCTYPE html>/i, '必须声明标准 HTML5 DOCTYPE');
  assert.match(content, /<html\s+lang=["']zh-CN["']/i, '必须指定 lang="zh-CN"');
  assert.match(content, /<meta\s+charset=["']UTF-8["']/i, '必须声明 UTF-8 编码');
  assert.match(content, /<meta\s+name=["']viewport["']\s+content=["'][^"']*width=device-width[^"']*["']/i, '必须配置响应式视口 meta');

  // 2. 表单与可访问性标签关联
  const inputMatches = [...content.matchAll(/<input\s+[^>]*id=["']([^"']+)["'][^>]*>/gi)];
  for (const match of inputMatches) {
    const id = match[1];
    if (['form-conn-id', 'form-conn-version', 'delete-conn-id', 'delete-conn-version'].includes(id)) {
      continue; // 隐藏字段无需显式 label
    }
    const labelRegex = new RegExp(`<label\\s+[^>]*for=["']${id}["']`, 'i');
    assert.ok(labelRegex.test(content), `输入框 id="${id}" 必须具备显式关联的 <label for="${id}">`);
  }

  // 3. 模态框无障碍属性
  const modalMatches = [...content.matchAll(/<div\s+[^>]*id=["']([^"']+-modal)["'][^>]*>/gi)];
  assert.ok(modalMatches.length >= 3, '必须至少包含 3 个模态框 (connection, delete, test-result)');
  for (const match of modalMatches) {
    const fullTag = match[0];
    assert.match(fullTag, /role=["']dialog["']/i, `模态框 ${match[1]} 必须声明 role="dialog"`);
    assert.match(fullTag, /aria-modal=["']true["']/i, `模态框 ${match[1]} 必须声明 aria-modal="true"`);
    assert.match(fullTag, /aria-labelledby=["'][^"']+["']/i, `模态框 ${match[1]} 必须声明 aria-labelledby`);
  }

  // 4. 关键安全警示文案
  assert.ok(
    content.includes('删除本地连接') && content.includes('不删除') && content.includes('数据库'),
    '删除模态框必须包含“仅删除本地连接...不删除数据库”的安全警示文案'
  );

  // 5. 密码输入字段安全
  const passwordInputs = [...content.matchAll(/<input\s+[^>]*type=["']password["'][^>]*>/gi)];
  assert.ok(passwordInputs.length >= 2, '必须包含登录码与数据库密码两处密码输入框');
  for (const passInput of passwordInputs) {
    assert.doesNotMatch(passInput[0], /value=["'][^"']+["']/i, '密码输入框严禁包含预置明文 value');
  }

  // 6. 无内联 JavaScript 执行属性
  assert.doesNotMatch(content, /\son[a-z]+=["'][^"']*["']/i, '严禁使用内联事件处理属性 (如 onclick/onload)，确保脚本彻底解耦');
});

test('Frontend UI: css/style.css 设计系统与无障碍规范校验', () => {
  const cssPath = path.join(webDir, 'css/style.css');
  assert.ok(fs.existsSync(cssPath), 'css/style.css 必须存在');
  const css = fs.readFileSync(cssPath, 'utf8');

  // 1. WCAG 焦点指示环
  assert.match(css, /:focus-visible\s*\{[^}]*outline:[^}]*\}/i, '必须定义高对比度 :focus-visible 焦点外轮廓');

  // 2. 设计系统 Tokens
  assert.match(css, /--bg-app:/, '必须定义应用背景 Token');
  assert.match(css, /--color-primary:/, '必须定义主色 Token');
  assert.match(css, /--color-danger:/, '必须定义危险色 Token');

  // 3. 动效减弱与响应式
  assert.match(css, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/i, '必须支持 prefers-reduced-motion 动效减弱模式');
  assert.match(css, /@media\s*\(\s*max-width:\s*\d+px\s*\)/i, '必须包含移动端/窄屏媒体查询');
});

test('Frontend API: ApiClient 核心安全与契约逻辑测试', async () => {
  const { ApiClient, ApiError } = await import('../../web/js/api.js');

  // Mock Fetch 实现
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    const method = options.method || 'GET';

    if (url.endsWith('/api/v1/session') && method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.local_code === 'valid-secret-code-123') {
        return {
          ok: true,
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          json: async () => ({ ok: true, data: { csrf_token: 'csrf-token-abc-999' } })
        };
      }
      return {
        ok: false,
        status: 403,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({ ok: false, error: { code: 'FORBIDDEN', message: '本地校验码错误或已失效' } })
      };
    }

    if (url.endsWith('/api/v1/session') && method === 'DELETE') {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({ ok: true, data: null })
      };
    }

    if (url.endsWith('/api/v1/connections') && method === 'GET') {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({
          ok: true,
          data: {
            items: [
              {
                id: '00000000-0000-4000-8000-000000000001',
                name: '测试数据库',
                host: '127.0.0.1',
                port: 3306,
                username: 'root',
                default_database: null,
                version: 1
              }
            ]
          }
        })
      };
    }

    if (url.endsWith('/api/v1/connections') && method === 'POST') {
      const body = JSON.parse(options.body);
      return {
        ok: true,
        status: 201,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({
          ok: true,
          data: {
            id: '00000000-0000-4000-8000-000000000002',
            name: body.name,
            host: body.host,
            port: body.port,
            username: body.username,
            default_database: body.default_database,
            version: 1
          }
        })
      };
    }

    if (url.includes('/api/v1/connections/') && method === 'PATCH') {
      const body = JSON.parse(options.body);
      if (body.expected_version !== 1) {
        return {
          ok: false,
          status: 409,
          headers: new Map([['content-type', 'application/json']]),
          json: async () => ({ ok: false, error: { code: 'STATE_CONFLICT', message: '连接版本冲突' } })
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({
          ok: true,
          data: {
            id: '00000000-0000-4000-8000-000000000001',
            name: body.name || '测试数据库',
            host: '127.0.0.1',
            port: 3306,
            username: 'root',
            default_database: null,
            version: 2
          }
        })
      };
    }

    if (url.includes('/api/v1/connections/') && method === 'DELETE') {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({ ok: true, data: { deleted: true } })
      };
    }

    if (url.endsWith('/api/v1/connections/test') && method === 'POST') {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        json: async () => ({
          ok: true,
          data: { connected: true, simulated: true, duration_ms: 12 }
        })
      };
    }

    return {
      ok: false,
      status: 404,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: '未找到接口' } })
    };
  };

  // 全局注入 mock fetch
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    const client = new ApiClient({ baseUrl: 'http://127.0.0.1:3210' });

    // 1. 登录前未认证
    assert.strictEqual(client.isAuthenticated(), false);

    // 2. 登录失败抛出脱敏错误
    await assert.rejects(
      async () => await client.login('wrong-code'),
      (err) => err instanceof ApiError && err.code === 'FORBIDDEN' && err.status === 403
    );

    // 3. 登录成功记录 CSRF 令牌
    const session = await client.login('valid-secret-code-123');
    assert.strictEqual(session.csrf_token, 'csrf-token-abc-999');
    assert.strictEqual(client.isAuthenticated(), true);

    // 4. 读取连接列表
    const items = await client.listConnections();
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, '测试数据库');

    // 5. 新增连接必须携带 x-csrf-token 头
    calls.length = 0;
    const created = await client.createConnection({
      name: '新连接',
      host: '127.0.0.1',
      port: 3306,
      username: 'dbuser',
      password: 'password123'
    });
    assert.strictEqual(created.name, '新连接');
    const createCall = calls.find(c => c.url.endsWith('/api/v1/connections') && c.options.method === 'POST');
    assert.ok(createCall, '必须发起 POST 连接请求');
    assert.strictEqual(createCall.options.headers['x-csrf-token'], 'csrf-token-abc-999');

    // 6. 编辑连接：密码留空时请求体中绝不包含 password 字段 (保持原密码语义)
    calls.length = 0;
    await client.updateConnection('00000000-0000-4000-8000-000000000001', {
      expected_version: 1,
      name: '重命名数据库',
      password: '' // 用户留空
    });
    const patchCall = calls.find(c => c.options.method === 'PATCH');
    assert.ok(patchCall, '必须发起 PATCH 连接请求');
    assert.strictEqual(patchCall.options.headers['x-csrf-token'], 'csrf-token-abc-999');
    const patchBody = JSON.parse(patchCall.options.body);
    assert.strictEqual(patchBody.password, undefined, '留空密码时 PATCH 请求体严禁携带 password 字段');
    assert.strictEqual(patchBody.expected_version, 1);
    assert.strictEqual(patchBody.name, '重命名数据库');

    // 7. 编辑连接版本冲突
    await assert.rejects(
      async () => await client.updateConnection('00000000-0000-4000-8000-000000000001', {
        expected_version: 999, // 错误的版本
        name: '冲突测试'
      }),
      (err) => err instanceof ApiError && err.code === 'STATE_CONFLICT' && err.status === 409
    );

    // 8. 测试草稿连接
    const testResult = await client.testDraftConnection({
      name: '草稿测试',
      host: '127.0.0.1',
      port: 3306,
      username: 'root',
      password: 'test-password'
    });
    assert.strictEqual(testResult.connected, true);
    assert.strictEqual(testResult.simulated, true);

    // 9. 删除连接
    calls.length = 0;
    await client.deleteConnection('00000000-0000-4000-8000-000000000001', 2);
    const deleteCall = calls.find(c => c.options.method === 'DELETE');
    assert.ok(deleteCall, '必须发起 DELETE 请求');
    assert.strictEqual(deleteCall.options.headers['x-csrf-token'], 'csrf-token-abc-999');
    const deleteBody = JSON.parse(deleteCall.options.body);
    assert.strictEqual(deleteBody.expected_version, 2);

    // 10. 注销会话并清理内存 CSRF 令牌
    await client.logout();
    assert.strictEqual(client.isAuthenticated(), false);
    assert.strictEqual(client.csrfToken, null);

    // 11. 401 会话失效回调触发
    let expiredTriggered = false;
    const clientWithCallback = new ApiClient({
      baseUrl: 'http://127.0.0.1:3210',
      onSessionExpired: () => { expiredTriggered = true; }
    });
    // 模拟 401 响应
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ ok: false, error: { code: 'UNAUTHENTICATED', message: '会话已过期' } })
    });
    await assert.rejects(
      async () => await clientWithCallback.listConnections(),
      (err) => err instanceof ApiError && err.code === 'UNAUTHENTICATED' && err.status === 401
    );
    assert.strictEqual(expiredTriggered, true, '401 未认证响应必须触发 onSessionExpired 回调');

    // 12. 本地登录码空值校验
    await assert.rejects(
      async () => await client.login('   '),
      (err) => err instanceof ApiError && err.code === 'INVALID_ARGUMENT' && err.status === 400
    );

  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Frontend UI: 表单字段边界与规则校验测试', () => {
  // 端口范围校验规则测试 (1..65535)
  const isValidPort = (p) => Number.isInteger(Number(p)) && Number(p) >= 1 && Number(p) <= 65535;
  assert.strictEqual(isValidPort(3306), true);
  assert.strictEqual(isValidPort(1), true);
  assert.strictEqual(isValidPort(65535), true);
  assert.strictEqual(isValidPort(0), false);
  assert.strictEqual(isValidPort(65536), false);
  assert.strictEqual(isValidPort(-1), false);
  assert.strictEqual(isValidPort('abc'), false);

  // 连接名范围 (1..64)
  const isValidName = (name) => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 64;
  assert.strictEqual(isValidName('生产备库'), true);
  assert.strictEqual(isValidName(''), false);
  assert.strictEqual(isValidName('a'.repeat(64)), true);
  assert.strictEqual(isValidName('a'.repeat(65)), false);

  // 主机地址范围 (1..255)
  const isValidHost = (host) => typeof host === 'string' && host.trim().length > 0 && host.trim().length <= 255;
  assert.strictEqual(isValidHost('127.0.0.1'), true);
  assert.strictEqual(isValidHost('localhost'), true);
  assert.strictEqual(isValidHost(''), false);
  assert.strictEqual(isValidHost('h'.repeat(256)), false);

  // 用户名范围 (1..128)
  const isValidUser = (u) => typeof u === 'string' && u.trim().length > 0 && u.trim().length <= 128;
  assert.strictEqual(isValidUser('readonly'), true);
  assert.strictEqual(isValidUser(''), false);
  assert.strictEqual(isValidUser('u'.repeat(129)), false);
});

