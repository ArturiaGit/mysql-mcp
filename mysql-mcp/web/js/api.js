/**
 * MySQL MCP 本地安全管控平台 - API 通信客户端
 * 严格按照 docs/API_AND_PROTOCOLS.md 契约实现
 * 1. 内存中维护 CSRF Token，绝不持久化至 Web Storage
 * 2. 自动附加 x-csrf-token 头至所有非幂等请求 (POST/PATCH/DELETE)
 * 3. 统一结构化错误响应解析与脱敏呈现
 */

export class ApiError extends Error {
  constructor(code, message, status = 500, details = null) {
    super(`[${code}] ${message}`);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ApiClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3210');
    this.csrfToken = null;
    this.onSessionExpired = options.onSessionExpired || null;
  }

  /**
   * 判断当前客户端是否已持有 CSRF Token
   */
  isAuthenticated() {
    return typeof this.csrfToken === 'string' && this.csrfToken.length > 0;
  }

  /**
   * 清除本地会话状态
   */
  clearSession() {
    this.csrfToken = null;
  }

  /**
   * 底层 HTTP 请求封装
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const method = options.method || 'GET';
    const isMutation = ['POST', 'PATCH', 'DELETE', 'PUT'].includes(method.toUpperCase());
    
    const headers = {
      'Accept': 'application/json',
      ...(options.headers || {})
    };

    if (options.body && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
    }

    // 状态变更请求强制附加内存中的 CSRF Token
    if (isMutation && this.csrfToken) {
      headers['x-csrf-token'] = this.csrfToken;
    }

    const fetchOptions = {
      method,
      headers,
      credentials: 'same-origin', // 必须携带 HttpOnly 会话 Cookie
      body: options.body && typeof options.body === 'object' ? JSON.stringify(options.body) : options.body
    };

    let response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (networkError) {
      throw new ApiError('SERVICE_UNAVAILABLE', `无法连接本地回环服务: ${networkError.message}`, 503);
    }

    let payload = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch (err) {
        throw new ApiError('INTERNAL_ERROR', '服务端响应了非法的 JSON 格式', response.status);
      }
    }

    // 处理 401 未认证 / 会话失效
    if (response.status === 401) {
      this.clearSession();
      if (typeof this.onSessionExpired === 'function') {
        this.onSessionExpired();
      }
      const msg = payload?.error?.message || '会话已过期或未认证，请重新输入本地登录码。';
      throw new ApiError('UNAUTHENTICATED', msg, 401);
    }

    if (!response.ok || (payload && payload.ok === false)) {
      const code = payload?.error?.code || (response.status === 403 ? 'FORBIDDEN' : response.status === 404 ? 'NOT_FOUND' : response.status === 409 ? 'STATE_CONFLICT' : 'INTERNAL_ERROR');
      const message = payload?.error?.message || `请求失败 (HTTP ${response.status})`;
      throw new ApiError(code, message, response.status, payload?.error);
    }

    return payload?.data !== undefined ? payload.data : payload;
  }

  /**
   * 1. 本地代码会话兑换
   * POST /api/v1/session
   */
  async login(localCode) {
    if (!localCode || typeof localCode !== 'string' || localCode.trim().length === 0) {
      throw new ApiError('INVALID_ARGUMENT', '请输入有效的本地登录码', 400);
    }

    const data = await this.request('/api/v1/session', {
      method: 'POST',
      body: { local_code: localCode.trim() }
    });

    if (data?.csrf_token) {
      this.csrfToken = data.csrf_token;
    } else {
      throw new ApiError('INTERNAL_ERROR', '服务端登录响应缺少 csrf_token', 500);
    }

    return data;
  }

  /**
   * 2. 注销会话
   * DELETE /api/v1/session
   */
  async logout() {
    try {
      await this.request('/api/v1/session', {
        method: 'DELETE'
      });
    } finally {
      this.clearSession();
    }
  }

  /**
   * 3. 获取连接列表
   * GET /api/v1/connections
   */
  async listConnections() {
    const data = await this.request('/api/v1/connections', {
      method: 'GET'
    });
    return data?.items || [];
  }

  /**
   * 4. 创建新连接
   * POST /api/v1/connections
   */
  async createConnection(connectionData) {
    const payload = {
      name: connectionData.name?.trim(),
      host: connectionData.host?.trim(),
      port: Number(connectionData.port),
      username: connectionData.username?.trim(),
      password: connectionData.password,
      default_database: connectionData.default_database?.trim() || null
    };

    return await this.request('/api/v1/connections', {
      method: 'POST',
      body: payload
    });
  }

  /**
   * 5. 更新已保存连接
   * PATCH /api/v1/connections/:id
   * 密码留空则不传 password 字段，保持原密码
   */
  async updateConnection(connectionId, updateData) {
    const payload = {
      expected_version: Number(updateData.expected_version)
    };

    if (updateData.name !== undefined) payload.name = updateData.name.trim();
    if (updateData.host !== undefined) payload.host = updateData.host.trim();
    if (updateData.port !== undefined) payload.port = Number(updateData.port);
    if (updateData.username !== undefined) payload.username = updateData.username.trim();
    if (updateData.default_database !== undefined) {
      payload.default_database = updateData.default_database?.trim() || null;
    }

    // 只有在用户输入了非空新密码时才传递 password 字段
    if (typeof updateData.password === 'string' && updateData.password.length > 0) {
      payload.password = updateData.password;
    }

    return await this.request(`/api/v1/connections/${encodeURIComponent(connectionId)}`, {
      method: 'PATCH',
      body: payload
    });
  }

  /**
   * 6. 删除连接
   * DELETE /api/v1/connections/:id
   */
  async deleteConnection(connectionId, expectedVersion) {
    return await this.request(`/api/v1/connections/${encodeURIComponent(connectionId)}`, {
      method: 'DELETE',
      body: {
        expected_version: Number(expectedVersion)
      }
    });
  }

  /**
   * 7. 测试未保存的草稿连接
   * POST /api/v1/connections/test
   */
  async testDraftConnection(draftData) {
    const payload = {
      name: draftData.name?.trim(),
      host: draftData.host?.trim(),
      port: Number(draftData.port),
      username: draftData.username?.trim(),
      password: draftData.password || '',
      default_database: draftData.default_database?.trim() || null
    };

    return await this.request('/api/v1/connections/test', {
      method: 'POST',
      body: payload
    });
  }

  /**
   * 8. 测试已保存的连接
   * POST /api/v1/connections/:id/test
   */
  async testSavedConnection(connectionId, expectedVersion) {
    return await this.request(`/api/v1/connections/${encodeURIComponent(connectionId)}/test`, {
      method: 'POST',
      body: {
        expected_version: Number(expectedVersion)
      }
    });
  }
}
