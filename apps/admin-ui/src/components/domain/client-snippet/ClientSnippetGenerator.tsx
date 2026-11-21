import type { ProfileOptionDTO } from '@mysql-mcp/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Select,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { useToastStore } from '@/stores/useToastStore';
import {
  buildClientSnippet,
  CLIENT_ADAPTER_PACKAGE,
  DEFAULT_MCP_GATEWAY_URL,
  PAT_TOKEN_PLACEHOLDER,
  resolveSnippetToken,
  type ClientHostKind,
} from './snippet-builder';

export interface ClientSnippetGeneratorProps {
  profiles: readonly ProfileOptionDTO[];
  selectedProfileName?: string;
  onSelectedProfileNameChange?: (profileName: string) => void;
  /**
   * Present ONLY inside PatCreateModal reveal step (ephemeral memory state).
   * When set, locks generator to State 1 (签发即时态) and hides the temporary input.
   */
  issuedToken?: string | null;
  gatewayUrl?: string;
  compact?: boolean;
  loadingProfiles?: boolean;
}

const HOST_TABS: readonly { id: ClientHostKind; label: string }[] = [
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'codex', label: 'Codex' },
  { id: 'curl', label: '通用 cURL' },
];

export function ClientSnippetGenerator({
  profiles,
  selectedProfileName,
  onSelectedProfileNameChange,
  issuedToken = null,
  gatewayUrl = DEFAULT_MCP_GATEWAY_URL,
  compact = false,
  loadingProfiles = false,
}: ClientSnippetGeneratorProps) {
  const pushToast = useToastStore((state) => state.push);
  const [host, setHost] = useState<ClientHostKind>('claude-desktop');
  const [internalProfile, setInternalProfile] = useState('');
  // SECURITY: Strictly ephemeral React state; never persisted to Storage/URL/QueryCache.
  const [temporaryToken, setTemporaryToken] = useState('');
  const [showTemporaryToken, setShowTemporaryToken] = useState(false);

  useEffect(() => {
    return () => {
      setTemporaryToken('');
    };
  }, []);

  const effectiveProfileName = useMemo(() => {
    const controlled = selectedProfileName?.trim();
    if (controlled && profiles.some((item) => item.name === controlled)) {
      return controlled;
    }
    if (internalProfile && profiles.some((item) => item.name === internalProfile)) {
      return internalProfile;
    }
    return profiles[0]?.name ?? '';
  }, [internalProfile, profiles, selectedProfileName]);

  const resolvedToken = useMemo(
    () => resolveSnippetToken({ issuedToken, temporaryToken }),
    [issuedToken, temporaryToken],
  );

  const built = useMemo(
    () =>
      buildClientSnippet({
        host,
        profileName: effectiveProfileName || null,
        gatewayUrl,
        token: resolvedToken.token,
      }),
    [effectiveProfileName, gatewayUrl, host, resolvedToken.token],
  );

  const handleProfileChange = (nextName: string) => {
    setInternalProfile(nextName);
    onSelectedProfileNameChange?.(nextName);
  };

  const handleCopySnippet = async () => {
    const ok = await copyToClipboard(built.content);
    pushToast(
      ok ? `已复制 ${built.label} 配置片段` : '无法访问剪贴板',
      ok
        ? resolvedToken.isPlaceholder
          ? `片段中的 ${PAT_TOKEN_PLACEHOLDER} 需替换为您的真实令牌。`
          : '已复制包含当前内存令牌的完整配置片段，请勿提交到代码仓库。'
        : '请手动选中代码框内容并使用快捷键复制。',
      ok ? 'safe' : 'warning',
    );
  };

  const modeBadge =
    resolvedToken.mode === 'issued'
      ? { variant: 'secret' as const, text: '签发即时态 · 仅内存' }
      : resolvedToken.mode === 'temporary'
        ? { variant: 'warning' as const, text: '临时装填态 · 仅内存不落盘' }
        : { variant: 'primary' as const, text: '日常模板态 · 安全占位' };

  const hasProfiles = profiles.length > 0;
  const isIssuedMode = resolvedToken.mode === 'issued';

  return (
    <div
      data-testid="client-snippet-generator"
      data-token-mode={resolvedToken.mode}
      className={cn('space-y-3', compact && 'space-y-2.5')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={modeBadge.variant} mono data-testid="snippet-mode-badge">
            {modeBadge.text}
          </Badge>
          {hasProfiles && (
            <span className="font-mono text-[11px] text-fg-subtle tabular-nums">
              已授权 {profiles.length} 个 Profile
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="xs"
          data-testid="copy-snippet-btn"
          onClick={() => void handleCopySnippet()}
        >
          <Icon name="copy" className="size-3.5" />
          <span>复制配置片段</span>
        </Button>
      </div>

      {/* Profile Selector */}
      {!loadingProfiles && (
        <div className={cn('grid gap-3', !compact && !isIssuedMode ? 'md:grid-cols-2' : 'grid-cols-1')}>
          <Field>
            <FieldLabel htmlFor={compact ? 'modal-snippet-profile' : 'config-snippet-profile'}>
              目标数据源 Profile
            </FieldLabel>
            {hasProfiles ? (
              <Select
                id={compact ? 'modal-snippet-profile' : 'config-snippet-profile'}
                data-testid="snippet-profile-select"
                value={effectiveProfileName}
                onChange={(event) => handleProfileChange(event.target.value)}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.name}>
                    {profile.displayName} ({profile.name})
                  </option>
                ))}
              </Select>
            ) : (
              <div
                data-testid="snippet-no-profile-notice"
                className="flex h-8 items-center rounded-md border border-border-line bg-bg-surface px-2.5 text-xs text-fg-muted"
              >
                暂无已授权的可用 Profile（使用占位符预览）
              </div>
            )}
          </Field>

          {/* State 3: Ephemeral in-memory temporary PAT input (never persisted) */}
          {!isIssuedMode && (
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="temp-pat-input">临时装填已有令牌（可选，仅内存）</FieldLabel>
                {temporaryToken.length > 0 && (
                  <button
                    type="button"
                    data-testid="clear-temp-pat-btn"
                    onClick={() => {
                      setTemporaryToken('');
                      setShowTemporaryToken(false);
                    }}
                    className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
                  >
                    清空临时令牌
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  id="temp-pat-input"
                  data-testid="temp-pat-input"
                  type={showTemporaryToken ? 'text' : 'password'}
                  className="font-mono text-xs"
                  placeholder={PAT_TOKEN_PLACEHOLDER}
                  autoComplete="off"
                  spellCheck={false}
                  value={temporaryToken}
                  onChange={(event) => setTemporaryToken(event.target.value)}
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={showTemporaryToken ? '隐藏临时令牌' : '显示临时令牌'}
                  title={showTemporaryToken ? '隐藏临时令牌' : '显示临时令牌'}
                  disabled={temporaryToken.length === 0}
                  onClick={() => setShowTemporaryToken((prev) => !prev)}
                >
                  <Icon name={showTemporaryToken ? 'eye-off' : 'eye'} className="size-3.5" />
                </Button>
              </div>
              <FieldHint>
                仅在组件内存中插值生成片段，刷新或离开页面立即清空，绝不写入本地存储或提交服务端。
              </FieldHint>
            </Field>
          )}
        </div>
      )}

      {/* 3-Tab Client Host Switcher */}
      <Tabs
        value={host}
        onValueChange={(value) => {
          if (value === 'claude-desktop' || value === 'codex' || value === 'curl') {
            setHost(value);
          }
        }}
      >
        <TabsList aria-label="MCP 客户端类型">
          {HOST_TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              data-testid={`snippet-tab-${tab.id}`}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {HOST_TABS.map((tab) => {
          const panelSnippet =
            tab.id === host
              ? built
              : buildClientSnippet({
                  host: tab.id,
                  profileName: effectiveProfileName || null,
                  gatewayUrl,
                  token: resolvedToken.token,
                });

          return (
            <TabsContent key={tab.id} value={tab.id}>
              <div className="overflow-hidden rounded-md border border-border-line bg-bg-app">
                <div className="flex items-center justify-between border-b border-border-line px-3 py-1.5 font-mono text-[10px] text-fg-subtle">
                  <span className="truncate">{panelSnippet.filename}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6"
                    aria-label={`复制 ${panelSnippet.label} 配置`}
                    onClick={() => void handleCopySnippet()}
                  >
                    <Icon name="copy" className="size-3.5" />
                  </Button>
                </div>
                <pre
                  tabIndex={0}
                  data-testid={`snippet-code-${tab.id}`}
                  className={cn(
                    'overflow-auto p-3 font-mono text-[11px] leading-relaxed text-fg-main',
                    compact ? 'max-h-40' : 'max-h-72',
                  )}
                >
                  {panelSnippet.content}
                </pre>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      {!compact && host === 'claude-desktop' && (
        <Alert variant="info" icon="code">
          <code className="font-mono">{CLIENT_ADAPTER_PACKAGE}</code>{' '}
          为企业客户端适配器占位包名，实际命令请以企业内网私有源发布的 CLI 包名为准。
        </Alert>
      )}
    </div>
  );
}
