import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { isApiClientError } from '@/api/client';
import { PATS_QUERY_KEY, useMyProfileOptions } from '@/api/pats';
import { ClientSnippetGenerator } from '@/components/domain/client-snippet';
import { PatCreateModal } from '@/components/domain/pat-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { ConsoleShell } from '@/layouts/ConsoleShell';

export default function ClientConfigView() {
  const queryClient = useQueryClient();
  const { data: profileOptions = [], isLoading, isFetching, error, refetch } = useMyProfileOptions();
  const [selectedProfileName, setSelectedProfileName] = useState('');
  const [createPatOpen, setCreatePatOpen] = useState(false);

  useEffect(() => {
    document.title = '客户端接入配置 | MySQL MCP Gateway Console';
  }, []);

  const errorMessage = error
    ? isApiClientError(error)
      ? `${error.message}${error.actionGuidance ? ` ${error.actionGuidance}` : ''}`
      : '无法加载已授权的数据源 Profile 列表，请稍后重试。'
    : null;

  return (
    <ConsoleShell sectionLabel="开发者自服务" pageLabel="客户端接入配置">
      <div className="mx-auto max-w-4xl space-y-4" data-testid="client-config-view">
        {/* Page Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
              DEVELOPER / CLIENT CONFIGURATION
            </div>
            <h1 className="mt-1 text-xl font-semibold text-fg-main">客户端接入配置</h1>
            <p className="mt-1 text-xs text-fg-muted">
              为 Claude Desktop、Codex 与通用 cURL 生成标准化 MCP 网关接入片段；仅展示您有权访问的轻量数据源标识。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/developer/pats">
                <Icon name="key" className="size-3.5" />
                <span>管理我的令牌</span>
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <Icon name="refresh" className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
              <span>刷新选项</span>
            </Button>
            <Button
              variant="default"
              size="sm"
              data-testid="config-open-create-pat-btn"
              onClick={() => setCreatePatOpen(true)}
            >
              <Icon name="plus" className="size-3.5" />
              <span>签发新令牌</span>
            </Button>
          </div>
        </div>

        {errorMessage && (
          <Alert variant="danger" data-testid="profile-options-error-alert">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{errorMessage}</span>
              <Button variant="outline" size="xs" onClick={() => void refetch()}>
                重试加载
              </Button>
            </div>
          </Alert>
        )}

        {/* Authorized Profiles Projection Card */}
        <Card>
          <CardHeader className="border-b border-border-line pb-3">
            <div>
              <CardTitle>
                <Icon name="database" className="size-4 text-primary" />
                <span>已授权数据源选项</span>
              </CardTitle>
              <CardDescription>
                来自轻量端点 <code className="font-mono">GET /api/v1/profiles/my-options</code>，严格剥离 Host、端口、SSH 与连接池等敏感运维拓扑。
              </CardDescription>
            </div>
            <Badge variant={profileOptions.length > 0 ? 'safe' : 'warning'} mono>
              {isLoading ? 'LOADING' : `${profileOptions.length} PROFILES`}
            </Badge>
          </CardHeader>
          <CardContent className="pt-3.5">
            {isLoading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-fg-muted">
                <Icon name="loader" className="size-3.5 animate-spin text-primary" />
                <span>正在加载已授权数据源选项…</span>
              </div>
            ) : profileOptions.length === 0 ? (
              <Alert variant="warning" data-testid="no-authorized-profiles-alert">
                当前账号尚未绑定任何可访问的数据源 Profile。请联系管理员在角色策略中为您分配数据源访问权限；下方仍可预览安全模板结构。
              </Alert>
            ) : (
              <div className="flex flex-wrap gap-2" data-testid="authorized-profile-chips">
                {profileOptions.map((option) => {
                  const isActive =
                    (selectedProfileName || profileOptions[0]?.name) === option.name;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      data-testid={`profile-chip-${option.name}`}
                      onClick={() => setSelectedProfileName(option.name)}
                      className={
                        isActive
                          ? 'inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary-soft px-2.5 py-1.5 text-left text-xs text-primary transition-colors cursor-pointer'
                          : 'inline-flex items-center gap-2 rounded-md border border-border-line bg-bg-app px-2.5 py-1.5 text-left text-xs text-fg-muted hover:border-border-strong hover:text-fg-main transition-colors cursor-pointer'
                      }
                    >
                      <Icon name="database" className="size-3.5 shrink-0" />
                      <span className="font-medium">{option.displayName}</span>
                      <span className="font-mono text-[10px] opacity-80">{option.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3-State Snippet Generator Card */}
        <Card>
          <CardHeader className="border-b border-border-line pb-3">
            <div>
              <CardTitle>
                <Icon name="terminal" className="size-4 text-primary" />
                <span>MCP 客户端配置生成器</span>
              </CardTitle>
              <CardDescription>
                默认输出安全占位符模板；可按需在组件内存中临时装填已有 PAT 方便复制，刷新页面自动清空。
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <ClientSnippetGenerator
              profiles={profileOptions}
              selectedProfileName={selectedProfileName}
              onSelectedProfileNameChange={setSelectedProfileName}
              loadingProfiles={isLoading}
            />
          </CardContent>
        </Card>

        {/* Zero-Leakage Guidance Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>
              <Icon name="shield" className="size-4 text-safe" />
              <span>凭据三态安全边界说明</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-xs text-fg-muted md:grid-cols-3">
            <div className="rounded-md border border-border-line bg-bg-app p-3">
              <div className="font-medium text-fg-main">1. 签发即时态</div>
              <p className="mt-1 leading-relaxed">
                在签发弹窗内直接提供含真实 PAT 的完整配置片段供单次复制；关闭弹窗后内存立即清零。
              </p>
            </div>
            <div className="rounded-md border border-border-line bg-bg-app p-3">
              <div className="font-medium text-fg-main">2. 日常模板态</div>
              <p className="mt-1 leading-relaxed">
                本页默认以 <code className="font-mono text-fg-main">&lt;YOUR_SAVED_PAT_TOKEN&gt;</code> 安全占位渲染，防止肩窥或截屏泄露。
              </p>
            </div>
            <div className="rounded-md border border-border-line bg-bg-app p-3">
              <div className="font-medium text-fg-main">3. 临时装填态</div>
              <p className="mt-1 leading-relaxed">
                临时粘贴的令牌仅驻留页面局部状态，严禁写入 localStorage、sessionStorage、URL 或任何远端日志。
              </p>
            </div>
          </CardContent>
        </Card>

        <PatCreateModal
          open={createPatOpen}
          onOpenChange={setCreatePatOpen}
          profiles={profileOptions}
          onPatCreated={() => {
            void queryClient.invalidateQueries({ queryKey: PATS_QUERY_KEY });
          }}
        />
      </div>
    </ConsoleShell>
  );
}
