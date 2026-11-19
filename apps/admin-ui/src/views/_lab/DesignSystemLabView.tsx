import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldError,
  FieldGroup,
  FieldHint,
  FieldLabel,
  Input,
  Kbd,
  Select,
  Switch,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useHealthProbe } from '@/hooks/useHealthProbe';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { AppShell } from '@/layouts/AppShell';
import { InspectSheet, type AuditLogInspectRecord } from '@/layouts/InspectSheet';
import type { SidebarNavGroup } from '@/layouts/Sidebar';
import { useCommandStore, type CommandItem } from '@/stores/useCommandStore';
import { useShellStore } from '@/stores/useShellStore';
import { useToastStore } from '@/stores/useToastStore';
import { LAB_AUDIT_RECORDS, LAB_COLOR_SWATCHES, type LabAuditRow } from './lab-data';
import {
  DesignPrinciplesDialog,
  HelpShortcutsDialog,
  PatRevealDialog,
  RevokeConfirmDialog,
} from './LabDialogs';

type CategoryFilter = 'all' | 'interaction' | 'data' | 'foundation';
type AuditFilter = 'all' | 'allowed' | 'blocked' | 'slow';
type NotificationMode = 'all' | 'risk' | 'none';

const SSRF_BLOCK_PATTERN = /^(localhost(?:\.|$)|127\.|169\.254\.|\[?::1\]?$|0\.0\.0\.0$)/i;

function SectionHeading({
  number,
  title,
  note,
}: {
  number: string;
  title: string;
  note: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="rounded-sm border border-border-line bg-bg-card px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
          {number}
        </span>
        <h2 className="text-[15px] font-semibold text-fg-main">{title}</h2>
      </div>
      <span className="text-xs text-fg-subtle">{note}</span>
    </div>
  );
}

export default function DesignSystemLabView() {
  const theme = useShellStore((state) => state.theme);
  const toggleTheme = useShellStore((state) => state.toggleTheme);
  const registerCommands = useCommandStore((state) => state.registerCommands);
  const pushToast = useToastStore((state) => state.push);
  const { data: health, isFetching: healthFetching, refetch: refetchHealth } = useHealthProbe();

  // Navigation & category state
  const [activeNav, setActiveNav] = useState('overview');
  const [category, setCategory] = useState<CategoryFilter>('all');

  // Dialog & Sheet state (6 interactive overlays)
  const [patDialogOpen, setPatDialogOpen] = useState(false);
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const [principlesDialogOpen, setPrinciplesDialogOpen] = useState(false);
  const [inspectRecord, setInspectRecord] = useState<AuditLogInspectRecord | null>(null);

  // Section 01: Interactive controls & connection form
  const [asyncLoading, setAsyncLoading] = useState(false);
  const [asyncDone, setAsyncDone] = useState(false);
  const [refreshingTable, setRefreshingTable] = useState(false);
  const [notificationMode, setNotificationMode] = useState<NotificationMode>('all');
  const [emailEnabled, setEmailEnabled] = useState(true);

  const [profileName, setProfileName] = useState('production_readonly');
  const [environment, setEnvironment] = useState('生产环境');
  const [hostname, setHostname] = useState('analytics.db.internal');
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState('');
  const [profileError, setProfileError] = useState('');
  const [hostError, setHostError] = useState('');
  const [sshError, setSshError] = useState('');
  const [connState, setConnState] = useState<'idle' | 'pending' | 'ok' | 'blocked'>('idle');

  // Section 02: Audit table & Dual-bucket simulator
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('all');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditDesc, setAuditDesc] = useState(true);
  const [userLimit, setUserLimit] = useState(180);
  const [userExempt, setUserExempt] = useState(false);
  const [profileOverloaded, setProfileOverloaded] = useState(false);

  // Section 04: Computed OKLCH swatch values updated on theme toggle
  const [swatchValues, setSwatchValues] = useState<Record<string, string>>({});

  const quotaSliderRef = useRef<HTMLInputElement>(null);
  const sshHostRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = '组件实验室 (/_lab) | MySQL MCP Gateway Console';
  }, []);

  useEffect(() => {
    const style = window.getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const swatch of LAB_COLOR_SWATCHES) {
      next[swatch.cssVar] = style.getPropertyValue(swatch.cssVar).trim();
    }
    setSwatchValues(next);
  }, [theme]);

  const jumpToSection = useCallback((sectionId: string) => {
    setCategory('all');
    setActiveNav(sectionId);
    queueMicrotask(() => {
      const target = document.getElementById(sectionId);
      if (target) {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      }
    });
  }, []);

  useEffect(() => {
    const labCommands: CommandItem[] = [
      {
        id: 'lab-components',
        title: '基础交互与按钮',
        tag: 'COMPONENT',
        keywords: 'button badge toggle checkbox 按钮 状态',
        iconName: 'box',
        action: () => jumpToSection('components'),
      },
      {
        id: 'lab-form',
        title: '连接表单与输入校验',
        tag: 'FORM',
        keywords: 'form input ssh ssrf 连接 配置 表单',
        iconName: 'sliders',
        action: () => jumpToSection('form-panel'),
      },
      {
        id: 'lab-audit',
        title: '审计流水与详情抽屉',
        tag: 'DATA',
        keywords: 'sql audit table sheet 审计 表格 抽屉',
        iconName: 'table',
        action: () => jumpToSection('data'),
      },
      {
        id: 'lab-quota',
        title: '双重漏斗限流模拟',
        tag: 'SECURITY',
        keywords: 'quota qpm dual bucket 限流 配额',
        iconName: 'activity',
        action: () => {
          jumpToSection('data');
          queueMicrotask(() => quotaSliderRef.current?.focus({ preventScroll: true }));
        },
      },
      {
        id: 'lab-pat',
        title: '创建演示访问令牌',
        tag: 'ACTION',
        keywords: 'pat token credential 凭据 令牌',
        iconName: 'key',
        action: () => setPatDialogOpen(true),
      },
      {
        id: 'lab-tokens',
        title: '色彩与设计令牌',
        tag: 'TOKENS',
        keywords: 'oklch color typography token 色彩 字体',
        iconName: 'palette',
        action: () => jumpToSection('tokens'),
      },
      {
        id: 'lab-help',
        title: '实验室帮助与快捷键',
        tag: 'HELP',
        keywords: 'help shortcuts keyboard 帮助 快捷键',
        iconName: 'help',
        action: () => setHelpDialogOpen(true),
      },
    ];
    registerCommands(labCommands);
    return () => registerCommands([]);
  }, [jumpToSection, registerCommands]);

  const filteredAuditRows = useMemo<LabAuditRow[]>(() => {
    const q = auditSearch.trim().toLowerCase();
    return [...LAB_AUDIT_RECORDS]
      .filter((row) => {
        if (auditFilter !== 'all' && row.filterGroup !== auditFilter) return false;
        if (!q) return true;
        return [row.sql_text, row.username, row.profile_name, row.status, row.query_instance_id]
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) =>
        auditDesc
          ? b.created_at.localeCompare(a.created_at)
          : a.created_at.localeCompare(b.created_at),
      );
  }, [auditFilter, auditSearch, auditDesc]);

  const userCurrentQpm = 78;
  const profileCapacityQpm = 300;
  const profileCurrentQpm = profileOverloaded ? 300 : 182;
  const userBlocked = !userExempt && userCurrentQpm >= userLimit;
  const rateLimited = profileOverloaded || userBlocked;

  const handleCopy = async (value: string, title: string) => {
    const ok = await copyToClipboard(value);
    pushToast(
      ok ? title : '无法访问剪贴板',
      ok ? undefined : '请手动选中内容并使用快捷键复制。',
      ok ? 'safe' : 'warning',
    );
  };

  const handleAsyncDemo = () => {
    setAsyncLoading(true);
    setAsyncDone(false);
    window.setTimeout(() => {
      setAsyncLoading(false);
      setAsyncDone(true);
      pushToast('异步操作演示完成', '加载期间按钮已禁用，避免重复提交。', 'safe');
      window.setTimeout(() => setAsyncDone(false), 1200);
    }, 650);
  };

  const handleResetAudit = () => {
    setRefreshingTable(true);
    window.setTimeout(() => {
      setAuditFilter('all');
      setAuditSearch('');
      setAuditDesc(true);
      setRefreshingTable(false);
      pushToast('演示数据已恢复', '已重置筛选与排序条件。', 'safe');
    }, 350);
  };

  const handleExportCsv = () => {
    if (filteredAuditRows.length === 0) {
      pushToast('没有可导出的记录', '请调整筛选条件后重试。', 'warning');
      return;
    }
    const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const header = ['query_instance_id', 'sql_text', 'profile_name', 'username', 'status', 'latency_ms', 'created_at'];
    const csv =
      '\uFEFF' +
      [
        header,
        ...filteredAuditRows.map((row) => [
          row.query_instance_id,
          row.sql_text,
          row.profile_name,
          row.username,
          row.status,
          row.latency_ms,
          row.created_at,
        ]),
      ]
        .map((line) => line.map(cell).join(','))
        .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mcp-audit-lab-demo.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    pushToast(`已导出 ${filteredAuditRows.length} 条演示记录`, 'CSV 仅包含当前筛选结果。', 'safe');
  };

  const handleConnectionTest = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const p = profileName.trim();
    const h = hostname.trim();
    const s = sshHost.trim();
    const e1 = !p
      ? '请输入 Profile 名称。'
      : !/^[a-zA-Z0-9_-]+$/.test(p)
        ? '仅支持字母、数字、下划线与短横线。'
        : '';
    const e2 = !h
      ? '请输入数据库地址。'
      : /\s|:\/\//.test(h)
        ? '请输入主机名或 IP，不包含协议和空格。'
        : '';
    const e3 = sshEnabled && !s ? '启用 SSH 隧道时必须填写堡垒机地址。' : '';

    setProfileError(e1);
    setHostError(e2);
    setSshError(e3);
    if (e1 || e2 || e3) return;

    setConnState('pending');
    window.setTimeout(() => {
      const denied = SSRF_BLOCK_PATTERN.test(h) || (sshEnabled && SSRF_BLOCK_PATTERN.test(s));
      setConnState(denied ? 'blocked' : 'ok');
    }, 550);
  };

  const navGroups: SidebarNavGroup[] = [
    {
      label: 'DESIGN SYSTEM',
      items: [
        {
          id: 'overview',
          label: '组件概览',
          icon: 'grid',
          badge: '01',
          active: activeNav === 'overview',
          href: '#overview',
          onClick: () => jumpToSection('overview'),
        },
        {
          id: 'components',
          label: '基础与交互',
          icon: 'box',
          badge: '02',
          active: activeNav === 'components',
          href: '#components',
          onClick: () => jumpToSection('components'),
        },
        {
          id: 'form-panel',
          label: '表单与输入',
          icon: 'sliders',
          badge: '03',
          active: activeNav === 'form-panel',
          href: '#form-panel',
          onClick: () => jumpToSection('form-panel'),
        },
        {
          id: 'data',
          label: '数据与审计',
          icon: 'table',
          badge: '04',
          active: activeNav === 'data',
          href: '#data',
          onClick: () => jumpToSection('data'),
        },
        {
          id: 'security',
          label: '安全场景',
          icon: 'shield',
          badge: '05',
          active: activeNav === 'security',
          href: '#security',
          onClick: () => jumpToSection('security'),
        },
      ],
    },
    {
      label: 'FOUNDATIONS',
      items: [
        {
          id: 'tokens',
          label: '色彩与设计令牌',
          icon: 'palette',
          active: activeNav === 'tokens',
          href: '#tokens',
          onClick: () => jumpToSection('tokens'),
        },
        {
          id: 'principles',
          label: '设计原则',
          icon: 'book',
          onClick: () => setPrinciplesDialogOpen(true),
        },
      ],
    },
  ];

  const showInteraction = category === 'all' || category === 'interaction';
  const showData = category === 'all' || category === 'data';
  const showFoundation = category === 'all' || category === 'foundation';

  const notificationSummary =
    notificationMode === 'none'
      ? '当前不发送任何事件通知。'
      : `已选择${notificationMode === 'all' ? '全部事件' : '仅高危事件'}，${emailEnabled ? '通过邮件通知' : '邮件渠道已关闭'}。`;

  return (
    <AppShell
      sidebar={{
        workspaceCode: 'DS',
        workspaceTitle: 'Design Lab',
        workspaceCaption: 'DEV-ONLY · Density 8/10',
        navGroups,
        footerNote: {
          title: '实时探针 + 交互沙盒',
          description: '组件交互采用固定演示数据，顶部与底栏健康探针直连真实 admin-api:8081。',
          actionLabel: '探索键盘快捷键',
          onAction: () => setHelpDialogOpen(true),
        },
        onBrandClick: () => jumpToSection('overview'),
      }}
      topbar={{
        sectionLabel: '设计系统',
        pageLabel: '组件实验室 /_lab',
        badgeText: 'DEV ONLY',
        onOpenHelp: () => setHelpDialogOpen(true),
      }}
    >
      {/* Hero + Real admin-api:8081 Health Probe Card */}
      <section id="overview" className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col justify-between rounded-lg border border-border-line bg-bg-card p-5">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] text-primary uppercase">
              <span aria-hidden="true" className="size-1.5 rounded-[1px] bg-primary" />
              <span>INTERFACE / COMPONENT LAB</span>
            </div>
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-fg-main">
              克制的外观，明确的掌控。
            </h1>
            <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
              MySQL MCP Gateway 正式组件体系与全局骨架实验室。锁定高信息密度 8/10（56px 顶栏 ·
              240/64px 侧栏 · 38px 表格行高），采用 OKLCH 双模式与 Lucide 矢量图标。
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="default" size="md" onClick={() => setPatDialogOpen(true)}>
              <Icon name="plus" className="size-3.5" />
              <span>生成演示令牌</span>
            </Button>
            <Button variant="outline" size="md" onClick={() => jumpToSection('tokens')}>
              <span>查看设计令牌</span>
              <Icon name="arrow-right" className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Live admin-api:8081 health probe panel */}
        <Card data-testid="live-health-panel" className="flex flex-col justify-between">
          <CardHeader className="pb-2">
            <div>
              <CardTitle>
                <Icon name="heart-pulse" className="size-4 text-primary" />
                <span>真实后端健康探针 (:8081)</span>
              </CardTitle>
              <CardDescription>直连真实 admin-api 与 Docker MySQL 元数据库</CardDescription>
            </div>
            <Button
              variant="outline"
              size="xs"
              data-testid="reprobe-health-btn"
              disabled={healthFetching}
              onClick={() => void refetchHealth()}
            >
              <Icon
                name="refresh"
                className={cn('size-3', healthFetching && 'animate-spin')}
              />
              <span>重新探测</span>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 pb-3">
            {[
              { key: 'live', label: 'GET /health/live', result: health?.live },
              { key: 'ready', label: 'GET /health/ready', result: health?.ready },
            ].map(({ key, label, result }) => (
              <div
                key={key}
                data-testid={`health-row-${key}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border-line bg-bg-app px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs text-fg-main">{label}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-fg-subtle tabular-nums">
                    {result
                      ? `HTTP ${result.httpStatus ?? 'ERR'} · ${result.latencyMs}ms`
                      : '探测中…'}
                  </div>
                </div>
                <Badge
                  variant={result?.ok ? 'safe' : result ? 'danger' : 'neutral'}
                  pulse={result?.ok}
                  mono
                  data-testid={`health-status-${key}`}
                >
                  {result ? result.statusText.toUpperCase() : 'PENDING'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Category Filter Bar (Density locked to 8/10 — no comfort/compact toggle per AGENTS.md §3.3 #9) */}
      <div className="mb-5 flex items-center justify-between gap-4 border-b border-border-line">
        <div
          role="group"
          aria-label="组件分类筛选"
          className="flex items-center gap-5 overflow-x-auto"
        >
          {(
            [
              { id: 'all', label: '全部组件', count: '05' },
              { id: 'interaction', label: '交互与表单' },
              { id: 'data', label: '数据与安全' },
              { id: 'foundation', label: '视觉基础' },
            ] as const
          ).map((tab) => {
            const active = category === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(tab.id)}
                className={cn(
                  'relative py-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer',
                  active
                    ? 'text-fg-main after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary'
                    : 'text-fg-muted hover:text-fg-main',
                )}
              >
                <span>{tab.label}</span>
                {'count' in tab && (
                  <span className="ml-1.5 font-mono text-[10px] text-fg-subtle tabular-nums">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="hidden font-mono text-[10px] text-fg-subtle sm:inline">
          DENSITY 8/10 · 38px ROWS
        </span>
      </div>

      {/* KPI Metrics Strip (Demo Data) */}
      {showData && (
        <section
          aria-label="指标卡片（固定演示数据）"
          className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
        >
          <Card className="relative p-4">
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>MCP 调用量</span>
              <Icon name="activity" className="size-4 text-fg-subtle" />
            </div>
            <div className="mt-2 font-mono text-[26px] leading-tight font-medium tracking-tight text-fg-main tabular-nums">
              24,891
            </div>
            <svg
              className="pointer-events-none absolute top-11 right-3.5 h-7 w-[72px] text-primary opacity-85"
              viewBox="0 0 90 36"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              role="img"
              aria-label="演示调用趋势上升"
            >
              <path d="M1 30 9 26 17 29 25 16 33 20 41 12 49 17 57 9 65 14 73 7 81 10 89 2" />
            </svg>
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-fg-subtle">
              <span className="font-mono text-safe tabular-nums">+12.4% 较昨日</span>
              <span>今日 · 演示</span>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>活跃会话</span>
              <Icon name="users" className="size-4 text-fg-subtle" />
            </div>
            <div className="mt-2 flex items-end justify-between">
              <div className="font-mono text-[26px] leading-tight font-medium tracking-tight text-fg-main tabular-nums">
                128
                <span className="ml-1 font-sans text-xs font-normal text-fg-subtle">个</span>
              </div>
              <div className="flex h-7 items-end gap-[3px]" aria-hidden="true">
                {[10, 15, 20, 13, 24, 28, 18, 25, 22].map((height, idx) => (
                  <span
                    key={idx}
                    style={{ height: `${height}px` }}
                    className={cn(
                      'w-1 rounded-[2px] bg-primary',
                      idx % 3 === 2 ? 'opacity-100' : 'opacity-55',
                    )}
                  />
                ))}
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-fg-subtle">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-safe" />
                <span>6 个 Profile 已连接</span>
              </span>
              <span className="font-mono">HTTP / SSE</span>
            </div>
          </Card>

          <Card className="relative p-4">
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>高危请求拦截</span>
              <Icon name="shield-ban" className="size-4 text-fg-subtle" />
            </div>
            <div className="mt-2 font-mono text-[26px] leading-tight font-medium tracking-tight text-fg-main tabular-nums">
              23
            </div>
            <svg
              className="pointer-events-none absolute top-11 right-3.5 h-7 w-[72px] text-danger opacity-85"
              viewBox="0 0 90 36"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              role="img"
              aria-label="演示拦截趋势"
            >
              <path d="M1 31H13V25H25V29H37V14H45V23H57V8H65V25H77V17H89" />
            </svg>
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-fg-subtle">
              <span className="font-mono text-danger">AST + ACL + SSRF</span>
              <span>全部已阻断</span>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <span>网关服务可用率</span>
              <Icon name="shield" className="size-4 text-fg-subtle" />
            </div>
            <div className="mt-2 font-mono text-[26px] leading-tight font-medium tracking-tight text-fg-main tabular-nums">
              99.98<span className="text-base text-fg-muted">%</span>
            </div>
            <div
              className="mt-2 flex gap-[3px]"
              role="img"
              aria-label="过去 24 小时可用率示意，包含一次短暂降级"
            >
              {Array.from({ length: 24 }, (_, idx) => (
                <span
                  key={idx}
                  className={cn(
                    'h-1.5 flex-1 rounded-[1px]',
                    idx === 12 ? 'bg-warning' : 'bg-safe opacity-80',
                  )}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-fg-subtle">
              <span>过去 24 小时 · 演示</span>
              <span className="text-safe">运行正常</span>
            </div>
          </Card>
        </section>
      )}

      {/* Section 01: Basic Interaction & Form Inputs */}
      {showInteraction && (
        <section id="components" className="mb-7 scroll-mt-20">
          <SectionHeading
            number="01"
            title="基础交互"
            note="每一种状态，都有清晰的回应"
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>
                    <Icon name="box" className="size-4 text-fg-muted" />
                    <span>操作与反馈</span>
                  </CardTitle>
                  <CardDescription>按钮层级、四象限语义状态与轻量选择控件。</CardDescription>
                </div>
                <span className="font-mono text-[10px] tracking-wider text-fg-subtle">
                  ACTIONS
                </span>
              </CardHeader>
              <CardContent className="divide-y divide-border-line">
                <div className="pb-3.5">
                  <div className="mb-2.5 flex items-center justify-between text-[11px] text-fg-subtle">
                    <span>操作层级</span>
                    <code className="font-mono text-[10px]">Button / h-8 (32px)</code>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="default" onClick={() => setPatDialogOpen(true)}>
                      <Icon name="plus" className="size-3.5" />
                      <span>创建令牌</span>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setInspectRecord(LAB_AUDIT_RECORDS[1] ?? null)}
                    >
                      <Icon name="external-link" className="size-3.5" />
                      <span>查看详情</span>
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={refreshingTable}
                      onClick={handleResetAudit}
                    >
                      <Icon
                        name="refresh"
                        className={cn('size-3.5', refreshingTable && 'animate-spin')}
                      />
                      <span>{refreshingTable ? '刷新中' : '刷新'}</span>
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => setRevokeDialogOpen(true)}
                    >
                      <Icon name="shield-ban" className="size-3.5" />
                      <span>撤销</span>
                    </Button>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      disabled={asyncLoading}
                      onClick={handleAsyncDemo}
                    >
                      <Icon
                        name={asyncLoading ? 'loader' : asyncDone ? 'check' : 'zap'}
                        className={cn('size-3.5', asyncLoading && 'animate-spin')}
                      />
                      <span>
                        {asyncLoading
                          ? '处理中…'
                          : asyncDone
                            ? '处理完成'
                            : '体验异步反馈'}
                      </span>
                    </Button>
                    <Button variant="outline" disabled>
                      <Icon name="lock" className="size-3.5" />
                      <span>不可用操作</span>
                    </Button>
                    <span className="text-[11px] text-fg-subtle">
                      悬停 / 聚焦 / 加载 / 禁用
                    </span>
                  </div>
                </div>

                <div className="py-3.5">
                  <div className="mb-2.5 flex items-center justify-between text-[11px] text-fg-subtle">
                    <span>状态语义</span>
                    <code className="font-mono text-[10px]">Badge / Security Scale</code>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="safe">已激活</Badge>
                    <Badge variant="warning">待审批</Badge>
                    <Badge variant="danger">已拦截</Badge>
                    <Badge variant="neutral">已冻结</Badge>
                    <Badge variant="secret">凭据</Badge>
                  </div>
                </div>

                <div className="pt-3.5">
                  <div className="mb-2.5 flex items-center justify-between text-[11px] text-fg-subtle">
                    <span>轻量选择</span>
                    <code className="font-mono text-[10px]">Segmented / Checkbox</code>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div
                      role="group"
                      aria-label="通知策略"
                      className="inline-flex items-center gap-0.5 rounded-md border border-border-line bg-bg-app p-0.5"
                    >
                      {(
                        [
                          { value: 'all', label: '全部事件' },
                          { value: 'risk', label: '仅高危' },
                          { value: 'none', label: '不通知' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          aria-pressed={notificationMode === opt.value}
                          onClick={() => setNotificationMode(opt.value)}
                          className={cn(
                            'h-7 rounded-sm px-2.5 text-xs transition-colors duration-150 cursor-pointer',
                            notificationMode === opt.value
                              ? 'bg-bg-hover font-medium text-fg-main'
                              : 'text-fg-muted hover:text-fg-main',
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <Checkbox
                      id="lab-email-notify"
                      checked={emailEnabled}
                      onChange={(event) => setEmailEnabled(event.target.checked)}
                      label="邮件通知"
                    />
                  </div>
                  <p className="mt-2 text-xs text-fg-subtle">{notificationSummary}</p>
                </div>
              </CardContent>
            </Card>

            <Card id="form-panel" className="scroll-mt-20">
              <CardHeader>
                <div>
                  <CardTitle>
                    <Icon name="sliders" className="size-4 text-fg-muted" />
                    <span>连接配置</span>
                  </CardTitle>
                  <CardDescription>可编辑表单、条件 SSH 隧道字段与即时 SSRF 校验演示。</CardDescription>
                </div>
                <span className="font-mono text-[10px] tracking-wider text-fg-subtle">
                  FORM INPUTS
                </span>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleConnectionTest} noValidate>
                  <FieldGroup>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
                      <Field invalid={Boolean(profileError)}>
                        <FieldLabel htmlFor="lab-profile-name" required>
                          Profile 名称
                        </FieldLabel>
                        <Input
                          id="lab-profile-name"
                          value={profileName}
                          required
                          autoComplete="off"
                          aria-invalid={Boolean(profileError)}
                          aria-describedby="lab-profile-error"
                          onChange={(event) => {
                            setProfileName(event.target.value);
                            setProfileError('');
                            setConnState('idle');
                          }}
                        />
                        <FieldError id="lab-profile-error">{profileError}</FieldError>
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="lab-env">环境</FieldLabel>
                        <Select
                          id="lab-env"
                          value={environment}
                          onChange={(event) => setEnvironment(event.target.value)}
                        >
                          <option value="生产环境">生产环境</option>
                          <option value="预发环境">预发环境</option>
                          <option value="开发环境">开发环境</option>
                        </Select>
                      </Field>
                    </div>

                    <Field invalid={Boolean(hostError)}>
                      <FieldLabel htmlFor="lab-hostname" required>
                        数据库地址
                      </FieldLabel>
                      <div className="relative flex items-center">
                        <Icon
                          name="database"
                          className="pointer-events-none absolute left-2.5 size-3.5 text-fg-subtle"
                        />
                        <Input
                          id="lab-hostname"
                          className="pl-8 font-mono"
                          value={hostname}
                          required
                          autoComplete="off"
                          spellCheck={false}
                          aria-invalid={Boolean(hostError)}
                          aria-describedby="lab-host-hint lab-host-error"
                          onChange={(event) => {
                            setHostname(event.target.value);
                            setHostError('');
                            setConnState('idle');
                          }}
                        />
                      </div>
                      <FieldHint id="lab-host-hint">
                        仅前端模拟校验（尝试输入 127.0.0.1 观察模拟 SSRF 阻断提示）。
                      </FieldHint>
                      <FieldError id="lab-host-error">{hostError}</FieldError>
                    </Field>

                    <div className="flex items-center justify-between gap-3 border-y border-border-line py-2.5">
                      <div id="lab-ssh-switch-label">
                        <div className="text-xs font-medium text-fg-main">启用 SSH 安全隧道</div>
                        <div className="text-[11px] text-fg-subtle">
                          通过堡垒机建立加密连接
                        </div>
                      </div>
                      <Switch
                        labelId="lab-ssh-switch-label"
                        checked={sshEnabled}
                        onChange={(event) => {
                          const next = event.target.checked;
                          setSshEnabled(next);
                          setConnState('idle');
                          if (next) {
                            queueMicrotask(() => sshHostRef.current?.focus());
                          } else {
                            setSshError('');
                          }
                        }}
                      />
                    </div>

                    {sshEnabled && (
                      <div className="border-l-2 border-primary pl-3">
                        <Field invalid={Boolean(sshError)}>
                          <FieldLabel htmlFor="lab-ssh-host" required>
                            堡垒机地址
                          </FieldLabel>
                          <Input
                            ref={sshHostRef}
                            id="lab-ssh-host"
                            className="font-mono"
                            placeholder="bastion.example.internal"
                            autoComplete="off"
                            value={sshHost}
                            aria-invalid={Boolean(sshError)}
                            aria-describedby="lab-ssh-error"
                            onChange={(event) => {
                              setSshHost(event.target.value);
                              setSshError('');
                              setConnState('idle');
                            }}
                          />
                          <FieldError id="lab-ssh-error">{sshError}</FieldError>
                        </Field>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-muted">
                        <Icon name="shield" className="size-3.5 text-primary" />
                        <span>只读策略 · TLS 加密</span>
                      </span>
                      <Button
                        type="submit"
                        variant="default"
                        disabled={connState === 'pending'}
                      >
                        <Icon
                          name={connState === 'pending' ? 'loader' : 'zap'}
                          className={cn('size-3.5', connState === 'pending' && 'animate-spin')}
                        />
                        <span>
                          {connState === 'pending' ? '模拟检测中…' : '模拟连通性测试'}
                        </span>
                      </Button>
                    </div>

                    {connState !== 'idle' && (
                      <Alert
                        role="status"
                        aria-live="polite"
                        variant={
                          connState === 'blocked'
                            ? 'danger'
                            : connState === 'ok'
                              ? 'safe'
                              : 'info'
                        }
                        icon={
                          connState === 'pending'
                            ? 'loader'
                            : connState === 'blocked'
                              ? 'shield-ban'
                              : 'check-circle'
                        }
                      >
                        {connState === 'pending'
                          ? '正在演示 DNS 解析与只读通道校验…'
                          : connState === 'blocked'
                            ? '模拟 SSRF 拦截：目标命中保留地址规则，请检查 ALLOWED_OUTBOUND_IPS 出站白名单。'
                            : '模拟测试通过 · TLS 1.3 / 只读模式 · 示例延迟 24ms'}
                      </Alert>
                    )}
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* Section 02: Dense Audit Table + Dual-Bucket Rate Limiter */}
      {showData && (
        <section id="data" className="mb-7 scroll-mt-20">
          <SectionHeading
            number="02"
            title="数据与可观测性"
            note="38px 紧凑表格行高 · 双重漏斗 AND 级联"
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="flex flex-col">
              <CardHeader className="border-b border-border-line pb-3">
                <div>
                  <CardTitle>
                    <Icon name="table" className="size-4 text-fg-muted" />
                    <span>SQL 审计流水</span>
                  </CardTitle>
                  <CardDescription>
                    脱敏演示数据 · 点击任意 SQL 打开基于 sys_audit_logs 真实字段的 InspectSheet
                  </CardDescription>
                </div>
                <Button variant="outline" size="xs" onClick={handleExportCsv}>
                  <Icon name="download" className="size-3.5" />
                  <span>导出 CSV</span>
                </Button>
              </CardHeader>

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-line px-4 py-2.5">
                <div
                  role="group"
                  aria-label="审计结果筛选"
                  className="flex flex-wrap items-center gap-1"
                >
                  {(
                    [
                      { id: 'all', label: '全部', count: 6 },
                      { id: 'allowed', label: '已放行', count: 3 },
                      { id: 'blocked', label: '已拦截', count: 2 },
                      { id: 'slow', label: '慢查询', count: 1 },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      aria-pressed={auditFilter === tab.id}
                      onClick={() => setAuditFilter(tab.id)}
                      className={cn(
                        'inline-flex h-7 items-center gap-1 rounded-sm border px-2 text-[11px] transition-colors duration-150 cursor-pointer',
                        auditFilter === tab.id
                          ? 'border-border-line bg-bg-surface font-medium text-fg-main'
                          : 'border-transparent text-fg-muted hover:text-fg-main',
                      )}
                    >
                      <span>{tab.label}</span>
                      <span className="font-mono text-[10px] text-fg-subtle tabular-nums">
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>

                <label className="relative w-full sm:w-44">
                  <span className="sr-only">搜索 SQL、用户或 Profile</span>
                  <Icon
                    name="search"
                    className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle"
                  />
                  <input
                    type="search"
                    value={auditSearch}
                    onChange={(event) => setAuditSearch(event.target.value)}
                    placeholder="搜索 SQL / 用户…"
                    className="h-7 w-full rounded-md border border-border-strong bg-bg-app pr-2 pl-8 text-xs text-fg-main placeholder:text-fg-subtle"
                  />
                </label>
              </div>

              <TableContainer aria-label="SQL 审计流水表">
                <Table data-testid="lab-audit-table">
                  <caption className="sr-only">
                    SQL 审计流水固定演示记录，支持筛选、排序和原位抽屉排查
                  </caption>
                  <TableHeader>
                    <tr className="h-8">
                      <TableHead>SQL / Profile</TableHead>
                      <TableHead>操作者</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>耗时</TableHead>
                      <TableHead aria-sort={auditDesc ? 'descending' : 'ascending'}>
                        <button
                          type="button"
                          onClick={() => setAuditDesc((prev) => !prev)}
                          className="inline-flex items-center gap-1 uppercase hover:text-fg-main cursor-pointer"
                        >
                          <span>时间 (UTC)</span>
                          <Icon name="arrow-up-down" className="size-3" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <span className="sr-only">详情</span>
                      </TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {filteredAuditRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-xs text-fg-muted">
                          <Icon name="search" className="mx-auto mb-2 size-5 text-fg-subtle" />
                          <p>没有匹配的审计记录</p>
                          <p className="mt-1 text-[11px] text-fg-subtle">
                            试试其他关键词，或切换到“全部”。
                          </p>
                        </td>
                      </tr>
                    ) : (
                      filteredAuditRows.map((row) => {
                        const isBlocked = row.status.startsWith('BLOCKED');
                        const isSlow = row.status === 'SUCCESS' && row.latency_ms >= 1000;
                        const timeShort = row.created_at.slice(11, 19);

                        return (
                          <TableRow key={row.id} data-testid="audit-table-row">
                            <TableCell className="max-w-[300px]">
                              <button
                                type="button"
                                onClick={() => setInspectRecord(row)}
                                aria-label={`查看 ${row.query_instance_id} 详情`}
                                className="flex max-w-[280px] items-center gap-2 text-left text-fg-main hover:text-primary cursor-pointer"
                              >
                                <span className="truncate font-mono text-[11px]">
                                  {row.sql_text}
                                </span>
                                <span className="shrink-0 font-mono text-[10px] text-fg-subtle">
                                  {row.profile_name}
                                </span>
                              </button>
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-main">
                                <span
                                  aria-hidden="true"
                                  className="grid size-5 place-items-center rounded-full bg-bg-hover font-mono text-[9px] text-fg-muted"
                                >
                                  {row.initials}
                                </span>
                                <span className="font-mono">{row.username}</span>
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="inline-flex items-center gap-1.5">
                                <Badge
                                  variant={isBlocked ? 'danger' : 'safe'}
                                  mono
                                  className="px-1.5 py-0 text-[10px]"
                                >
                                  {row.status}
                                </Badge>
                                {isSlow && (
                                  <Badge
                                    variant="warning"
                                    dot={false}
                                    mono
                                    className="px-1.5 py-0 text-[10px]"
                                  >
                                    SLOW
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell
                              className={cn(
                                'font-mono text-[11px] tabular-nums',
                                isSlow ? 'text-warning' : 'text-fg-muted',
                              )}
                            >
                              {isBlocked ? '—' : `${row.latency_ms} ms`}
                            </TableCell>
                            <TableCell className="font-mono text-[11px] text-fg-subtle tabular-nums">
                              {timeShort}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="size-6"
                                aria-label={`打开 ${row.query_instance_id} 抽屉`}
                                onClick={() => setInspectRecord(row)}
                              >
                                <Icon name="chevron-right" className="size-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <CardFooter className="mt-auto text-[11px] text-fg-subtle">
                <span role="status" aria-live="polite" className="tabular-nums">
                  {`显示 ${filteredAuditRows.length} / ${LAB_AUDIT_RECORDS.length} 条演示记录`}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span>详情在 InspectSheet 展开</span>
                  <Kbd>↵</Kbd>
                </span>
              </CardFooter>
            </Card>

            {/* Dual-Bucket Rate Limiter Preview */}
            <Card className="flex flex-col">
              <CardHeader className="pb-2">
                <div>
                  <CardTitle>
                    <Icon name="activity" className="size-4 text-fg-muted" />
                    <span>双重漏斗限流</span>
                  </CardTitle>
                  <CardDescription>两个条件，同时满足。</CardDescription>
                </div>
                <Badge variant={rateLimited ? 'warning' : 'safe'} dot={false}>
                  {rateLimited ? '请求受限' : '运行正常'}
                </Badge>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-3">
                {/* Bucket 1: User Bucket */}
                <div className="rounded-md border border-border-line bg-bg-app p-3">
                  <div className="mb-2 flex items-center justify-between text-[11px]">
                    <span className="text-fg-muted">
                      主体配额 <span className="font-mono text-fg-subtle">USER</span>
                    </span>
                    <span className="font-mono text-fg-main tabular-nums">
                      {userExempt ? (
                        <span className="text-secret">EXEMPT / -1</span>
                      ) : (
                        <>
                          {userCurrentQpm}{' '}
                          <span className="text-fg-subtle">/ {userLimit} QPM</span>
                        </>
                      )}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="用户配额使用量"
                    aria-valuemin={0}
                    aria-valuemax={userLimit}
                    aria-valuenow={Math.min(userCurrentQpm, userLimit)}
                    aria-valuetext={
                      userExempt ? '个人配额已豁免' : `${userCurrentQpm} / ${userLimit} QPM`
                    }
                    className="h-1.5 overflow-hidden rounded-full bg-bg-hover"
                  >
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-150',
                        userBlocked ? 'bg-warning' : 'bg-primary',
                      )}
                      style={{
                        width: userExempt
                          ? '0%'
                          : `${Math.min(100, (userCurrentQpm / userLimit) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-fg-subtle tabular-nums">
                    <span>
                      {userExempt
                        ? '个人配额豁免'
                        : `${((userCurrentQpm / userLimit) * 100).toFixed(1)}% 已使用`}
                    </span>
                    <span className="font-mono">user_042</span>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-[11px] text-fg-subtle">
                    <label htmlFor="lab-quota-range">调整主体配额</label>
                    <output htmlFor="lab-quota-range" className="font-mono text-fg-main tabular-nums">
                      {userLimit} QPM
                    </output>
                  </div>
                  <input
                    ref={quotaSliderRef}
                    id="lab-quota-range"
                    type="range"
                    min={30}
                    max={360}
                    step={10}
                    value={userLimit}
                    onChange={(event) => setUserLimit(Number(event.target.value))}
                    className="mt-1 w-full cursor-pointer accent-primary"
                  />
                </div>

                {/* Monospace AND connector */}
                <div className="flex items-center justify-center gap-2 font-mono text-[10px] text-fg-subtle">
                  <span aria-hidden="true" className="h-px w-8 bg-border-line" />
                  <span className="rounded-sm border border-border-line bg-bg-surface px-2 py-0.5 text-fg-muted">
                    AND 逻辑串接
                  </span>
                  <span aria-hidden="true" className="h-px w-8 bg-border-line" />
                </div>

                {/* Bucket 2: Profile Resource Protection Bucket */}
                <div className="rounded-md border border-border-line bg-bg-app p-3">
                  <div className="mb-2 flex items-center justify-between text-[11px]">
                    <span className="text-fg-muted">
                      资源保护 <span className="font-mono text-fg-subtle">PROFILE</span>
                    </span>
                    <span className="font-mono text-fg-main tabular-nums">
                      {profileCurrentQpm}{' '}
                      <span className="text-fg-subtle">/ {profileCapacityQpm} QPM</span>
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Profile 资源使用量"
                    aria-valuemin={0}
                    aria-valuemax={profileCapacityQpm}
                    aria-valuenow={profileCurrentQpm}
                    className="h-1.5 overflow-hidden rounded-full bg-bg-hover"
                  >
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-150',
                        profileOverloaded ? 'bg-warning' : 'bg-secret',
                      )}
                      style={{ width: `${(profileCurrentQpm / profileCapacityQpm) * 100}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-fg-subtle tabular-nums">
                    <span>
                      {profileOverloaded
                        ? '100% 资源满载'
                        : `${((profileCurrentQpm / profileCapacityQpm) * 100).toFixed(1)}% 已使用`}
                    </span>
                    <span className="font-mono">prod_readonly</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <div id="lab-exempt-label">
                    <div className="text-xs font-medium text-fg-main">豁免个人限流 (-1)</div>
                    <div className="text-[11px] text-fg-subtle">
                      底层 Profile 资源保护上限仍然绝对生效
                    </div>
                  </div>
                  <Switch
                    labelId="lab-exempt-label"
                    checked={userExempt}
                    onChange={(event) => setUserExempt(event.target.checked)}
                  />
                </div>

                <div
                  aria-live="polite"
                  className={cn(
                    'rounded-md border p-2.5 text-[11px] leading-relaxed',
                    rateLimited
                      ? 'border-warning/35 bg-warning-soft text-warning'
                      : 'border-border-line bg-bg-app text-fg-muted',
                  )}
                >
                  {profileOverloaded ? (
                    <>
                      <strong className="font-semibold">资源保护桶已满，请求将被限制。</strong>
                      <br />
                      即使个人配额豁免 (-1)，也绝不能穿透底层 Profile 资源保护桶。
                    </>
                  ) : userBlocked ? (
                    <>
                      <strong className="font-semibold">主体配额不足，请求将被限制。</strong>
                      <br />
                      调高主体配额滑块，或切换个人限流豁免观察双桶联动。
                    </>
                  ) : userExempt ? (
                    <>
                      <strong className="font-semibold text-safe">个人配额已豁免。</strong>
                      <br />
                      当前仍受底层 Profile 资源保护上限约束。
                    </>
                  ) : (
                    <>
                      <strong className="font-semibold text-safe">请求允许通过。</strong>
                      <br />
                      主体配额与 Profile 资源保护均在安全阈值内。
                    </>
                  )}
                </div>
              </CardContent>

              <CardFooter>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setUserLimit(180);
                    setUserExempt(false);
                    setProfileOverloaded(false);
                    pushToast('限流演示已重置', undefined, 'safe');
                  }}
                >
                  <Icon name="refresh" className="size-3" />
                  <span>重置</span>
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setProfileOverloaded((prev) => !prev)}
                >
                  <Icon name="zap" className="size-3" />
                  <span>{profileOverloaded ? '恢复资源负载' : '模拟资源满载'}</span>
                </Button>
              </CardFooter>
            </Card>
          </div>
        </section>
      )}

      {/* Section 03: Security Patterns */}
      {showData && (
        <section id="security" className="mb-7 scroll-mt-20">
          <SectionHeading
            number="03"
            title="安全交互模式"
            note="把风险说清楚，把控制权留给用户"
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>
                    <Icon name="key" className="size-4 text-secret" />
                    <span>个人访问令牌 (PAT)</span>
                  </CardTitle>
                  <CardDescription>单次明文揭示、三态防呆确认，关闭即清除内存。</CardDescription>
                </div>
                <span className="font-mono text-[10px] tracking-wider text-fg-subtle">
                  CREDENTIALS
                </span>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border border-border-line bg-bg-app p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-xs font-medium text-fg-main">
                      <Icon name="key" className="size-3.5 text-secret" />
                      <span>本地开发 · 演示凭据</span>
                    </span>
                    <Badge variant="secret" dot={false} mono>
                      DEMO ONLY
                    </Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs tracking-wide text-fg-muted">
                      mcp_demo_••••••••••••
                    </span>
                    <Icon name="lock" className="size-3.5 text-fg-subtle" />
                  </div>
                </div>

                <div className="overflow-hidden rounded-md border border-border-line bg-bg-app">
                  <div className="flex items-center justify-between border-b border-border-line px-3 py-1.5 font-mono text-[10px] text-fg-subtle">
                    <span>HTTP AUTHORIZATION</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-6"
                      aria-label="复制 Authorization 示例"
                      onClick={() =>
                        void handleCopy(
                          'Authorization: Bearer <your-personal-access-token>',
                          '已复制 Authorization 示例',
                        )
                      }
                    >
                      <Icon name="copy" className="size-3.5" />
                    </Button>
                  </div>
                  <pre className="overflow-x-auto p-3 font-mono text-xs text-fg-muted">
                    <span className="text-primary">Authorization</span>: Bearer{' '}
                    <span className="text-safe">&lt;your-personal-access-token&gt;</span>
                  </pre>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-fg-subtle">
                    演示令牌不会存储或发送到任何远端服务。
                  </span>
                  <Button variant="outline" size="xs" onClick={() => setPatDialogOpen(true)}>
                    <span>体验生成流程</span>
                    <Icon name="arrow-right" className="size-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>
                    <Icon name="shield" className="size-4 text-fg-muted" />
                    <span>权限与安全护栏</span>
                  </CardTitle>
                  <CardDescription>黑名单绝对置顶，超管防自残硬保护。</CardDescription>
                </div>
                <span className="font-mono text-[10px] tracking-wider text-fg-subtle">
                  POLICY GUARDS
                </span>
              </CardHeader>
              <CardContent className="space-y-3">
                <Alert variant="danger" icon="shield-ban">
                  <strong className="font-semibold">黑名单优先于白名单 (Strict Deny Overrides)</strong>
                  <p className="mt-0.5 text-fg-muted">
                    任意物理表命中拒绝规则时，整条查询立即阻断，多角色合并亦不可放行。
                  </p>
                </Alert>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger-soft/40 px-3 py-2">
                    <span className="font-mono text-xs text-fg-main">finance.salary_*</span>
                    <Badge variant="danger">DENY · 拒绝访问</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border-line bg-bg-app px-3 py-2">
                    <span className="font-mono text-xs text-fg-main">analytics.report_*</span>
                    <Badge variant="safe">ALLOW · 只读访问</Badge>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-line pt-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">
                    <Icon name="lock" className="size-3.5" />
                    <span>最后一名活跃超级管理员受到保护</span>
                  </span>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        className="inline-flex rounded-md"
                        aria-label="禁用管理员不可用：必须保留至少一名活跃超级管理员"
                      >
                        <Button variant="outline" size="xs" disabled>
                          <Icon name="lock" className="size-3" />
                          <span>禁用管理员</span>
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      系统必须保留至少 1 名 ACTIVE 状态的超级管理员；前端提供阻断提示，真实权限由后端并发锁序校验。
                    </TooltipContent>
                  </Tooltip>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* Section 04: Visual Foundations (OKLCH Tokens & Dual-Engine Typography) */}
      {showFoundation && (
        <section id="tokens" className="mb-7 scroll-mt-20">
          <SectionHeading
            number="04"
            title="视觉基础"
            note="OKLCH 双模式令牌 · WCAG 2.1 AA 对比度"
          />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>
                    <Icon name="palette" className="size-4 text-fg-muted" />
                    <span>OKLCH 语义色彩令牌</span>
                  </CardTitle>
                  <CardDescription>
                    点击色块复制当前主题的 OKLCH 令牌值（当前：{theme === 'dark' ? 'Dark 默认' : 'Light 高对比度'}）。
                  </CardDescription>
                </div>
                <span className="font-mono text-[10px] tracking-wider text-fg-subtle">
                  COLOR TOKENS
                </span>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
                  {LAB_COLOR_SWATCHES.map((swatch) => {
                    const value = swatchValues[swatch.cssVar] ?? `var(${swatch.cssVar})`;
                    return (
                      <button
                        key={swatch.cssVar}
                        type="button"
                        onClick={() =>
                          void handleCopy(value, `已复制 ${swatch.label} 令牌 ${value}`)
                        }
                        aria-label={`复制${swatch.label}色值 ${value}`}
                        className="group min-w-0 text-left cursor-pointer"
                      >
                        <span
                          className="flex h-10 w-full items-center justify-center rounded-md border border-fg-main/15"
                          style={{ backgroundColor: `var(${swatch.cssVar})` }}
                        >
                          <Icon
                            name="copy"
                            className="size-3.5 text-bg-app opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                          />
                        </span>
                        <span className="mt-1.5 block text-[11px] font-medium text-fg-main">
                          {swatch.label}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-fg-subtle">
                          {swatch.tokenName}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex flex-wrap gap-5 border-t border-border-line pt-3 text-[11px] text-fg-subtle">
                  <div>
                    <strong className="block font-mono text-xs text-fg-main">4 / 8 / 16</strong>
                    <span>空间节奏 · px</span>
                  </div>
                  <div>
                    <strong className="block font-mono text-xs text-fg-main">56 / 38</strong>
                    <span>顶栏 / 表行 · px</span>
                  </div>
                  <div>
                    <strong className="block font-mono text-xs text-fg-main">6 / 8</strong>
                    <span>控件 / 卡片圆角</span>
                  </div>
                  <div>
                    <strong className="block font-mono text-xs text-fg-main">180ms</strong>
                    <span>克制过渡动效</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>
                    <Icon name="code" className="size-4 text-fg-muted" />
                    <span>双引擎排版</span>
                  </CardTitle>
                  <CardDescription>UI 正文与技术代码解耦，数值全局 tabular-nums。</CardDescription>
                </div>
                <span className="font-mono text-[10px] tracking-wider text-fg-subtle">
                  TYPOGRAPHY
                </span>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-4 border-b border-border-line pb-3">
                  <span className="text-[32px] leading-tight font-semibold tracking-tight text-fg-main">
                    Aa 字
                  </span>
                  <div className="text-xs text-fg-subtle">
                    <strong className="block font-medium text-fg-main">清晰的界面语言</strong>
                    <span>Inter / 系统中文无衬线字体</span>
                  </div>
                </div>
                <div className="pt-3 font-mono text-xs leading-relaxed text-fg-main tabular-nums">
                  <div>SELECT clarity FROM design LIMIT 100;</div>
                  <div className="mt-1 text-[11px] text-fg-subtle">
                    JetBrains Mono · 0O / 1lI · 等宽数字 0123456789
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-line pt-4 pb-2 text-[11px] text-fg-subtle">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="shield" className="size-3.5 text-primary" />
          <span>MySQL MCP Gateway / Design System Lab (M0)</span>
        </span>
        <span className="hidden font-mono text-[10px] tracking-wider md:inline">
          ZERO TRUST BY DESIGN · DENSITY 8/10
        </span>
        <Button variant="ghost" size="xs" onClick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="size-3.5" />
          <span>{theme === 'dark' ? '切换浅色主题' : '切换暗色主题'}</span>
        </Button>
      </footer>

      {/* 6 Interactive Dialogs / Overlays (CommandPalette is mounted in AppShell) */}
      <PatRevealDialog open={patDialogOpen} onOpenChange={setPatDialogOpen} />
      <RevokeConfirmDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen} />
      <HelpShortcutsDialog open={helpDialogOpen} onOpenChange={setHelpDialogOpen} />
      <DesignPrinciplesDialog open={principlesDialogOpen} onOpenChange={setPrinciplesDialogOpen} />
      <InspectSheet
        open={inspectRecord !== null}
        onOpenChange={(next) => {
          if (!next) setInspectRecord(null);
        }}
        record={inspectRecord}
        demoNotice="本实验室抽屉严格收敛为 sys_audit_logs 真实物理字段只读排查视图。"
      />
    </AppShell>
  );
}
