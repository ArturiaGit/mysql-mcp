/**
 * MySQL MCP 本地安全管控平台 - 主应用控制器
 * 严格按照 docs/FRONTEND_UI_GUIDELINES.md 与 A11y 标准实现
 * 1. 纯原生 ESM 架构，无外生不可控依赖
 * 2. 严格遵循 DOM 注入安全原则，消除 XSS 风险
 * 3. 完整的无障碍焦点陷阱（Esc 退出、Tab 循环、关闭后原位焦点恢复）
 * 4. 严苛的安全凭据生命周期控制，密码即用即弃
 */

import { ApiClient, ApiError } from './api.js';

class AppController {
  constructor() {
    this.api = new ApiClient({
      onSessionExpired: () => this.handleSessionExpired()
    });

    this.currentModal = null;
    this.lastActiveElement = null;
    this.connections = [];

    this.initElements();
    this.bindEvents();
  }

  initElements() {
    // 视图
    this.loginView = document.getElementById('login-view');
    this.dashboardView = document.getElementById('dashboard-view');
    this.btnLogout = document.getElementById('btn-logout');

    // 登录
    this.loginForm = document.getElementById('login-form');
    this.localCodeInput = document.getElementById('local-code-input');
    this.loginFeedback = document.getElementById('login-feedback');
    this.btnLoginSubmit = document.getElementById('btn-login-submit');

    // 控制台
    this.globalFeedback = document.getElementById('global-feedback');
    this.loadingState = document.getElementById('loading-state');
    this.emptyState = document.getElementById('empty-state');
    this.connectionsTableBody = document.getElementById('connections-tbody');
    this.btnRefresh = document.getElementById('btn-refresh');
    this.btnNewConnection = document.getElementById('btn-new-connection');

    // 新增/编辑模态框
    this.connectionModal = document.getElementById('connection-modal');
    this.connectionModalTitle = document.getElementById('connection-modal-title');
    this.btnConnectionModalClose = document.getElementById('btn-connection-modal-close');
    this.connectionForm = document.getElementById('connection-form');
    this.modalFeedback = document.getElementById('modal-feedback');
    this.formConnId = document.getElementById('form-conn-id');
    this.formConnVersion = document.getElementById('form-conn-version');
    this.formName = document.getElementById('form-name');
    this.formHost = document.getElementById('form-host');
    this.formPort = document.getElementById('form-port');
    this.formUsername = document.getElementById('form-username');
    this.formPassword = document.getElementById('form-password');
    this.formPasswordHint = document.getElementById('form-password-hint');
    this.formDatabase = document.getElementById('form-database');
    this.btnModalTest = document.getElementById('btn-modal-test');
    this.btnModalCancel = document.getElementById('btn-modal-cancel');
    this.btnModalSave = document.getElementById('btn-modal-save');

    // 删除模态框
    this.deleteModal = document.getElementById('delete-modal');
    this.btnDeleteModalClose = document.getElementById('btn-delete-modal-close');
    this.deleteConnId = document.getElementById('delete-conn-id');
    this.deleteConnVersion = document.getElementById('delete-conn-version');
    this.deleteTargetPreview = document.getElementById('delete-target-preview');
    this.deleteFeedback = document.getElementById('delete-feedback');
    this.btnDeleteCancel = document.getElementById('btn-delete-cancel');
    this.btnDeleteConfirm = document.getElementById('btn-delete-confirm');

    // 测试结果模态框
    this.testResultModal = document.getElementById('test-result-modal');
    this.btnTestModalClose = document.getElementById('btn-test-modal-close');
    this.btnTestModalDone = document.getElementById('btn-test-modal-done');
    this.testResultContent = document.getElementById('test-result-content');
  }

  bindEvents() {
    // 登录表单
    this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    this.btnLogout.addEventListener('click', () => this.handleLogout());

    // 控制台按钮
    this.btnRefresh.addEventListener('click', () => this.loadConnections());
    this.btnNewConnection.addEventListener('click', () => this.openNewConnectionModal());

    // 连接模态框事件
    this.connectionForm.addEventListener('submit', (e) => this.handleSaveConnection(e));
    this.btnModalCancel.addEventListener('click', () => this.closeModal());
    this.btnConnectionModalClose.addEventListener('click', () => this.closeModal());
    this.btnModalTest.addEventListener('click', () => this.handleModalTestConnection());

    // 删除模态框事件
    this.btnDeleteCancel.addEventListener('click', () => this.closeModal());
    this.btnDeleteModalClose.addEventListener('click', () => this.closeModal());
    this.btnDeleteConfirm.addEventListener('click', () => this.handleConfirmDelete());

    // 测试模态框事件
    this.btnTestModalClose.addEventListener('click', () => this.closeModal());
    this.btnTestModalDone.addEventListener('click', () => this.closeModal());

    // 全局键盘可访问性导航 (Esc 退出，Tab 焦点陷阱)
    document.addEventListener('keydown', (e) => this.handleGlobalKeydown(e));
  }

  // --- 视图流转 ---

  showLoginView() {
    this.loginView.classList.remove('hidden');
    this.dashboardView.classList.add('hidden');
    this.btnLogout.classList.add('hidden');
    this.localCodeInput.value = '';
    this.hideAlert(this.loginFeedback);
    this.localCodeInput.focus();
  }

  showDashboardView() {
    this.loginView.classList.add('hidden');
    this.dashboardView.classList.remove('hidden');
    this.btnLogout.classList.remove('hidden');
    this.loadConnections();
  }

  handleSessionExpired() {
    this.showLoginView();
    this.showAlert(this.loginFeedback, '会话已过期，请重新输入控制台登录码');
  }

  // --- 登录与注销 ---

  async handleLogin(e) {
    e.preventDefault();
    const code = this.localCodeInput.value.trim();
    if (!code) {
      this.showAlert(this.loginFeedback, '请输入有效的本地登录码');
      this.localCodeInput.focus();
      return;
    }

    this.hideAlert(this.loginFeedback);
    this.btnLoginSubmit.disabled = true;
    this.btnLoginSubmit.textContent = '正在验证会话...';

    try {
      await this.api.login(code);
      this.showDashboardView();
    } catch (err) {
      this.showAlert(this.loginFeedback, err.message);
      this.localCodeInput.focus();
    } finally {
      this.btnLoginSubmit.disabled = false;
      this.btnLoginSubmit.textContent = '验证并进入控制台';
    }
  }

  async handleLogout() {
    try {
      await this.api.logout();
    } catch (err) {
      console.warn('Logout notification error:', err);
    } finally {
      this.showLoginView();
    }
  }

  // --- 连接列表加载与渲染 ---

  async loadConnections() {
    this.loadingState.classList.remove('hidden');
    this.emptyState.classList.add('hidden');
    this.hideAlert(this.globalFeedback);

    try {
      const items = await this.api.listConnections();
      this.connections = items;
      this.renderConnections(items);
    } catch (err) {
      this.showAlert(this.globalFeedback, `加载连接失败: ${err.message}`, 'error');
    } finally {
      this.loadingState.classList.add('hidden');
    }
  }

  renderConnections(items) {
    this.connectionsTableBody.innerHTML = '';

    if (!items || items.length === 0) {
      this.emptyState.classList.remove('hidden');
      return;
    }

    this.emptyState.classList.add('hidden');

    for (const item of items) {
      const tr = document.createElement('tr');

      // 1. 连接名称 & 稳定 ID
      const tdName = document.createElement('td');
      const divName = document.createElement('div');
      divName.className = 'cell-name';
      divName.textContent = item.name;
      const divId = document.createElement('div');
      divId.className = 'cell-subtext';
      divId.textContent = `ID: ${item.id}`;
      tdName.appendChild(divName);
      tdName.appendChild(divId);
      tr.appendChild(tdName);

      // 2. 主机与端口
      const tdEndpoint = document.createElement('td');
      tdEndpoint.className = 'cell-endpoint';
      tdEndpoint.textContent = `${item.host}:${item.port}`;
      tr.appendChild(tdEndpoint);

      // 3. 用户名
      const tdUser = document.createElement('td');
      tdUser.className = 'cell-endpoint';
      tdUser.textContent = item.username;
      tr.appendChild(tdUser);

      // 4. 默认数据库
      const tdDb = document.createElement('td');
      tdDb.textContent = item.default_database || '—';
      tr.appendChild(tdDb);

      // 5. 乐观锁版本
      const tdVer = document.createElement('td');
      const badgeVer = document.createElement('span');
      badgeVer.className = 'cell-badge';
      badgeVer.textContent = `v${item.version}`;
      tdVer.appendChild(badgeVer);
      tr.appendChild(tdVer);

      // 6. 操作按钮区
      const tdActions = document.createElement('td');
      const divActions = document.createElement('div');
      divActions.className = 'cell-actions';

      // 测试按钮
      const btnTest = document.createElement('button');
      btnTest.className = 'btn btn-secondary btn-sm';
      btnTest.type = 'button';
      btnTest.textContent = '测试';
      btnTest.setAttribute('aria-label', `测试连接 ${item.name}`);
      btnTest.addEventListener('click', () => this.handleRowTestConnection(item));

      // 编辑按钮
      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn-secondary btn-sm';
      btnEdit.type = 'button';
      btnEdit.textContent = '编辑';
      btnEdit.setAttribute('aria-label', `编辑连接 ${item.name}`);
      btnEdit.addEventListener('click', () => this.openEditConnectionModal(item));

      // 删除按钮
      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn btn-danger btn-sm';
      btnDelete.type = 'button';
      btnDelete.textContent = '删除';
      btnDelete.setAttribute('aria-label', `删除连接 ${item.name}`);
      btnDelete.addEventListener('click', () => this.openDeleteModal(item));

      divActions.appendChild(btnTest);
      divActions.appendChild(btnEdit);
      divActions.appendChild(btnDelete);
      tdActions.appendChild(divActions);
      tr.appendChild(tdActions);

      this.connectionsTableBody.appendChild(tr);
    }
  }

  // --- 模态框打开与焦点管理 ---

  openModal(modalElement, focusTarget = null) {
    if (this.currentModal) {
      this.closeModal(false);
    }

    this.lastActiveElement = document.activeElement;
    this.currentModal = modalElement;
    modalElement.classList.remove('hidden');

    const toFocus = focusTarget || modalElement.querySelector('input, button:not(.modal-close-btn)');
    if (toFocus) {
      setTimeout(() => toFocus.focus(), 50);
    }
  }

  closeModal(restoreFocus = true) {
    if (!this.currentModal) return;

    this.currentModal.classList.add('hidden');
    const closedModal = this.currentModal;
    this.currentModal = null;

    // 清空任何敏感密码输入内存
    if (closedModal === this.connectionModal) {
      this.formPassword.value = '';
    }

    if (restoreFocus && this.lastActiveElement && typeof this.lastActiveElement.focus === 'function') {
      this.lastActiveElement.focus();
    }
  }

  handleGlobalKeydown(e) {
    if (!this.currentModal) return;

    // Esc 键关闭模态框
    if (e.key === 'Escape') {
      e.preventDefault();
      this.closeModal();
      return;
    }

    // Tab 焦点陷阱
    if (e.key === 'Tab') {
      const focusable = Array.from(
        this.currentModal.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => el.offsetParent !== null);

      if (focusable.length === 0) return;

      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    }
  }

  // --- 新增与编辑模态框交互 ---

  openNewConnectionModal() {
    this.connectionModalTitle.textContent = '新增 MySQL 连接';
    this.formConnId.value = '';
    this.formConnVersion.value = '';
    this.formName.value = '';
    this.formHost.value = '127.0.0.1';
    this.formPort.value = '3306';
    this.formUsername.value = '';
    this.formPassword.value = '';
    this.formPassword.placeholder = '请输入数据库密码';
    this.formPassword.required = true;
    this.formPasswordHint.textContent = '输入数据库密码，将安全存储至 Windows Keyring，绝不回显。';
    this.formDatabase.value = '';
    this.hideAlert(this.modalFeedback);

    this.openModal(this.connectionModal, this.formName);
  }

  openEditConnectionModal(item) {
    this.connectionModalTitle.textContent = `编辑连接: ${item.name}`;
    this.formConnId.value = item.id;
    this.formConnVersion.value = item.version;
    this.formName.value = item.name;
    this.formHost.value = item.host;
    this.formPort.value = item.port;
    this.formUsername.value = item.username;
    this.formPassword.value = '';
    this.formPassword.placeholder = '留空保持原密码';
    this.formPassword.required = false;
    this.formPasswordHint.textContent = '留空保持原密码。若需修改请输入新密码。';
    this.formDatabase.value = item.default_database || '';
    this.hideAlert(this.modalFeedback);

    this.openModal(this.connectionModal, this.formName);
  }

  async handleSaveConnection(e) {
    e.preventDefault();
    const id = this.formConnId.value;
    const isEdit = Boolean(id);

    const name = this.formName.value.trim();
    const host = this.formHost.value.trim();
    const port = Number(this.formPort.value);
    const username = this.formUsername.value.trim();
    const password = this.formPassword.value;
    const default_database = this.formDatabase.value.trim() || null;

    // 字段校验
    if (!name || name.length > 64) {
      this.showAlert(this.modalFeedback, '连接名称不能为空且不能超过 64 个字符');
      this.formName.focus();
      return;
    }
    if (!host || host.length > 255) {
      this.showAlert(this.modalFeedback, '主机地址不能为空且不能超过 255 个字符');
      this.formHost.focus();
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      this.showAlert(this.modalFeedback, '端口号必须在 1 至 65535 范围内');
      this.formPort.focus();
      return;
    }
    if (!username || username.length > 128) {
      this.showAlert(this.modalFeedback, '用户名不能为空且不能超过 128 个字符');
      this.formUsername.focus();
      return;
    }
    if (!isEdit && (!password || password.length === 0)) {
      this.showAlert(this.modalFeedback, '新增连接必须输入密码');
      this.formPassword.focus();
      return;
    }

    this.hideAlert(this.modalFeedback);
    this.btnModalSave.disabled = true;
    this.btnModalSave.textContent = '正在保存...';

    try {
      if (isEdit) {
        const expected_version = Number(this.formConnVersion.value);
        await this.api.updateConnection(id, {
          expected_version,
          name,
          host,
          port,
          username,
          password: password || undefined,
          default_database
        });
        this.closeModal();
        this.showAlert(this.globalFeedback, `连接 [${name}] 更新成功`, 'success');
      } else {
        await this.api.createConnection({
          name,
          host,
          port,
          username,
          password,
          default_database
        });
        this.closeModal();
        this.showAlert(this.globalFeedback, `连接 [${name}] 创建成功`, 'success');
      }
      await this.loadConnections();
    } catch (err) {
      if (err.code === 'STATE_CONFLICT') {
        this.showAlert(this.modalFeedback, '连接版本冲突（该连接可能已被其他并发修改或当前正在使用中），请刷新列表后再试。');
      } else {
        this.showAlert(this.modalFeedback, err.message);
      }
    } finally {
      this.btnModalSave.disabled = false;
      this.btnModalSave.textContent = '保存连接';
      this.formPassword.value = '';
    }
  }

  // --- 连接测试交互 ---

  async handleModalTestConnection() {
    const id = this.formConnId.value;
    const isEdit = Boolean(id);

    const name = this.formName.value.trim();
    const host = this.formHost.value.trim();
    const port = Number(this.formPort.value);
    const username = this.formUsername.value.trim();
    const password = this.formPassword.value;
    const default_database = this.formDatabase.value.trim() || null;

    if (!host || !username) {
      this.showAlert(this.modalFeedback, '测试连接前请先填写主机地址与用户名');
      return;
    }

    this.hideAlert(this.modalFeedback);
    this.btnModalTest.disabled = true;
    this.btnModalTest.textContent = '正在测试...';

    try {
      let result;
      // 若处于编辑态且未输入新密码，则测试已保存连接
      if (isEdit && !password) {
        const expected_version = Number(this.formConnVersion.value);
        result = await this.api.testSavedConnection(id, expected_version);
      } else {
        // 否则测试输入草稿
        result = await this.api.testDraftConnection({
          name: name || '未命名草稿',
          host,
          port,
          username,
          password,
          default_database
        });
      }
      this.showTestResultModal(result);
    } catch (err) {
      this.showTestResultModal(null, err);
    } finally {
      this.btnModalTest.disabled = false;
      this.btnModalTest.textContent = '测试连接';
    }
  }

  async handleRowTestConnection(item) {
    this.showAlert(this.globalFeedback, `正在对 [${item.name}] 触发连通性测试...`, 'info');

    try {
      const result = await this.api.testSavedConnection(item.id, item.version);
      this.showTestResultModal(result, null, item.name);
    } catch (err) {
      this.showTestResultModal(null, err, item.name);
    }
  }

  showTestResultModal(result, error = null, connName = null) {
    this.testResultContent.innerHTML = '';
    const card = document.createElement('div');

    if (error) {
      card.className = 'test-result-card failure';
      const title = document.createElement('h3');
      title.textContent = `❌ 测试连接失败${connName ? ` [${connName}]` : ''}`;
      title.style.color = '#ef4444';
      title.style.marginBottom = '0.75rem';

      const desc = document.createElement('p');
      desc.textContent = error.message;
      desc.style.fontSize = '0.875rem';

      card.appendChild(title);
      card.appendChild(desc);
    } else {
      card.className = 'test-result-card success';
      const title = document.createElement('h3');
      title.textContent = `✅ 连通性测试成功${connName ? ` [${connName}]` : ''}`;
      title.style.color = '#10b981';
      title.style.marginBottom = '0.75rem';

      const row1 = document.createElement('div');
      row1.className = 'test-metric-row';
      row1.innerHTML = `<span>连通状态:</span><strong>${result?.connected ? '已连通' : '未连通'}</strong>`;

      const row2 = document.createElement('div');
      row2.className = 'test-metric-row';
      row2.innerHTML = `<span>测试模式:</span><span>${result?.simulated ? '沙箱模拟连通' : '实际 MySQL 网络响应'}</span>`;

      const row3 = document.createElement('div');
      row3.className = 'test-metric-row';
      row3.innerHTML = `<span>探测耗时:</span><span>${result?.duration_ms ?? 0} ms</span>`;

      card.appendChild(title);
      card.appendChild(row1);
      card.appendChild(row2);
      card.appendChild(row3);
    }

    this.testResultContent.appendChild(card);
    this.openModal(this.testResultModal, this.btnTestModalDone);
  }

  // --- 删除连接交互 ---

  openDeleteModal(item) {
    this.deleteConnId.value = item.id;
    this.deleteConnVersion.value = item.version;
    this.deleteTargetPreview.textContent = `目标连接: ${item.name} (${item.host}:${item.port}) - 版本: v${item.version}`;
    this.hideAlert(this.deleteFeedback);

    this.openModal(this.deleteModal, this.btnDeleteCancel);
  }

  async handleConfirmDelete() {
    const id = this.deleteConnId.value;
    const version = Number(this.deleteConnVersion.value);

    this.hideAlert(this.deleteFeedback);
    this.btnDeleteConfirm.disabled = true;
    this.btnDeleteConfirm.textContent = '正在删除...';

    try {
      await this.api.deleteConnection(id, version);
      this.closeModal();
      this.showAlert(this.globalFeedback, '连接配置及凭据已安全清除', 'success');
      await this.loadConnections();
    } catch (err) {
      if (err.code === 'STATE_CONFLICT') {
        this.showAlert(this.deleteFeedback, '连接版本冲突（连接可能已被修改或当前处于使用中），无法删除。');
      } else {
        this.showAlert(this.deleteFeedback, err.message);
      }
    } finally {
      this.btnDeleteConfirm.disabled = false;
      this.btnDeleteConfirm.textContent = '确认删除本地配置与凭据';
    }
  }

  // --- 警告提示辅助函数 ---

  showAlert(element, message, type = 'error') {
    if (!element) return;
    element.textContent = message;
    element.className = `alert-box alert-${type}`;
    element.classList.remove('hidden');
  }

  hideAlert(element) {
    if (!element) return;
    element.classList.add('hidden');
    element.textContent = '';
  }
}

// 页面加载完成后启动单例控制器
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.app = new AppController();
  });
}
