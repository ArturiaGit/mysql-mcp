import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Alert,
  Checkbox,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Kbd,
  Select,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { copyToClipboard } from '@/lib/clipboard';
import { useToastStore } from '@/stores/useToastStore';

function generateDemoToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `mcp_demo_${hex}`;
}

export interface PatRevealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PatRevealDialog({ open, onOpenChange }: PatRevealDialogProps) {
  const pushToast = useToastStore((state) => state.push);
  const [name, setName] = useState('本地开发测试');
  const [expiryDays, setExpiryDays] = useState('30');
  const [nameError, setNameError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [demoToken, setDemoToken] = useState('');
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [discardPromptVisible, setDiscardPromptVisible] = useState(false);
  const [clientTab, setClientTab] = useState('http');

  const nameInputRef = useRef<HTMLInputElement>(null);
  const copyBtnRef = useRef<HTMLButtonElement>(null);
  const keepBtnRef = useRef<HTMLButtonElement>(null);
  const generationIdRef = useRef(0);

  const resetAndClearSecret = useCallback(() => {
    generationIdRef.current += 1;
    setDemoToken('');
    setBackupConfirmed(false);
    setDiscardPromptVisible(false);
    setSubmitting(false);
    setNameError('');
    setClientTab('http');
  }, []);

  useEffect(() => {
    if (open) {
      resetAndClearSecret();
      queueMicrotask(() => nameInputRef.current?.focus());
    } else {
      resetAndClearSecret();
    }
  }, [open, resetAndClearSecret]);

  const canCloseSafely = !demoToken || backupConfirmed;

  const handleBeforeClose = useCallback((): boolean => {
    if (canCloseSafely) {
      resetAndClearSecret();
      return true;
    }
    setDiscardPromptVisible(true);
    queueMicrotask(() => keepBtnRef.current?.focus());
    return false;
  }, [canCloseSafely, resetAndClearSecret]);

  const handleRequestClose = () => {
    if (handleBeforeClose()) {
      onOpenChange(false);
    }
  };

  const handleForceDiscard = () => {
    resetAndClearSecret();
    onOpenChange(false);
  };

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('请输入演示令牌名称。');
      nameInputRef.current?.focus();
      return;
    }
    setNameError('');
    setSubmitting(true);
    const runId = ++generationIdRef.current;

    window.setTimeout(() => {
      if (runId !== generationIdRef.current) return;
      setDemoToken(generateDemoToken());
      setSubmitting(false);
      queueMicrotask(() => copyBtnRef.current?.focus());
    }, 350);
  };

  const httpSnippet = `GET https://gateway.example.invalid/mcp\nAuthorization: Bearer ${demoToken}\n\n# 演示格式，不会发送任何真实请求。`;
  const jsonSnippet = JSON.stringify(
    {
      mcpServers: {
        'mysql-gateway': {
          url: 'https://gateway.example.invalid/mcp',
          headers: {
            Authorization: `Bearer ${demoToken}`,
          },
        },
      },
    },
    null,
    2,
  );

  const handleCopy = async (content: string, message: string) => {
    const ok = await copyToClipboard(content);
    pushToast(
      ok ? message : '无法访问剪贴板',
      ok ? undefined : '请手动选中内容并使用快捷键复制。',
      ok ? 'safe' : 'warning',
    );
  };

  const isRevealStep = demoToken.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          resetAndClearSecret();
        }
        onOpenChange(next);
      }}
      onBeforeClose={handleBeforeClose}
      dismissOnBackdrop={false}
      ariaLabelledBy="pat-dialog-title"
      ariaDescribedBy="pat-dialog-description"
    >
      <div data-testid="pat-reveal-dialog">
        <DialogHeader>
          <div>
            <DialogTitle id="pat-dialog-title">
              {isRevealStep ? '演示令牌已生成' : '创建演示访问令牌'}
            </DialogTitle>
            <DialogDescription id="pat-dialog-description">
              {isRevealStep
                ? `${name.trim()} · 有效期 ${expiryDays} 天（仅本地演示）`
                : '完整体验三态防呆单次展示流程，不连接任何持久化凭据服务。'}
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="关闭令牌弹窗"
            onClick={handleRequestClose}
          >
            <Icon name="x" className="size-4" />
          </Button>
        </DialogHeader>

        {!isRevealStep ? (
          <form onSubmit={handleCreate} noValidate>
            <DialogBody>
              <div className="mb-3 grid size-9 place-items-center rounded-md border border-secret/30 bg-secret-soft text-secret">
                <Icon name="key" className="size-4" />
              </div>
              <FieldGroup>
                <Field invalid={Boolean(nameError)}>
                  <FieldLabel htmlFor="lab-pat-name" required>
                    令牌名称
                  </FieldLabel>
                  <Input
                    ref={nameInputRef}
                    id="lab-pat-name"
                    value={name}
                    maxLength={60}
                    autoComplete="off"
                    aria-invalid={Boolean(nameError)}
                    aria-describedby="lab-pat-name-error"
                    onChange={(event) => {
                      setName(event.target.value);
                      if (nameError) setNameError('');
                    }}
                  />
                  <FieldError id="lab-pat-name-error">{nameError}</FieldError>
                </Field>

                <Field>
                  <FieldLabel htmlFor="lab-pat-expiry">有效期（演示选项）</FieldLabel>
                  <Select
                    id="lab-pat-expiry"
                    value={expiryDays}
                    onChange={(event) => setExpiryDays(event.target.value)}
                  >
                    <option value="7">7 天</option>
                    <option value="30">30 天</option>
                    <option value="90">90 天</option>
                  </Select>
                </Field>

                <Alert variant="info">
                  本实验室仅生成带 <code className="font-mono">mcp_demo_</code>{' '}
                  前缀的随机演示字符串，不写入存储且不具备真实网关权限。
                </Alert>
              </FieldGroup>
            </DialogBody>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" variant="default" disabled={submitting}>
                <Icon
                  name={submitting ? 'loader' : 'key'}
                  className={submitting ? 'size-3.5 animate-spin' : 'size-3.5'}
                />
                <span>{submitting ? '生成中…' : '生成演示令牌'}</span>
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div>
            <DialogBody className="space-y-3.5">
              <Alert variant="warning">
                该演示令牌仅在本次创建时展示一次。关闭弹窗后明文将立即从内存中清空，无法再次查看。
              </Alert>

              <div
                data-testid="pat-secret-output"
                aria-label="生成的演示令牌"
                className="rounded-md border border-border-line bg-bg-app p-3 font-mono text-xs break-all text-fg-main select-all"
              >
                {demoToken}
              </div>

              <div>
                <Button
                  ref={copyBtnRef}
                  variant="default"
                  onClick={() => void handleCopy(demoToken, '已复制演示令牌')}
                >
                  <Icon name="copy" className="size-3.5" />
                  <span>复制演示令牌</span>
                </Button>
              </div>

              <Tabs value={clientTab} onValueChange={setClientTab}>
                <TabsList aria-label="客户端接入示例">
                  <TabsTrigger value="http">HTTP 请求</TabsTrigger>
                  <TabsTrigger value="json">通用 JSON 示例</TabsTrigger>
                </TabsList>

                <TabsContent value="http">
                  <div className="overflow-hidden rounded-md border border-border-line bg-bg-app">
                    <div className="flex items-center justify-between border-b border-border-line px-3 py-1.5 font-mono text-[10px] text-fg-subtle">
                      <span>request.http · 占位地址</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-6"
                        aria-label="复制 HTTP 接入示例"
                        onClick={() => void handleCopy(httpSnippet, '已复制 HTTP 接入示例')}
                      >
                        <Icon name="copy" className="size-3.5" />
                      </Button>
                    </div>
                    <pre
                      tabIndex={0}
                      className="max-h-40 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-fg-muted"
                    >
                      {httpSnippet}
                    </pre>
                  </div>
                </TabsContent>

                <TabsContent value="json">
                  <div className="overflow-hidden rounded-md border border-border-line bg-bg-app">
                    <div className="flex items-center justify-between border-b border-border-line px-3 py-1.5 font-mono text-[10px] text-fg-subtle">
                      <span>mcp-client.json · 示意结构</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-6"
                        aria-label="复制 JSON 接入示例"
                        onClick={() => void handleCopy(jsonSnippet, '已复制 JSON 接入示例')}
                      >
                        <Icon name="copy" className="size-3.5" />
                      </Button>
                    </div>
                    <pre
                      tabIndex={0}
                      className="max-h-40 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-fg-muted"
                    >
                      {jsonSnippet}
                    </pre>
                  </div>
                </TabsContent>
              </Tabs>

              <Checkbox
                id="lab-pat-backup-check"
                checked={backupConfirmed}
                onChange={(event) => {
                  setBackupConfirmed(event.target.checked);
                  if (event.target.checked) setDiscardPromptVisible(false);
                }}
                label="我已妥善保存此演示令牌，了解关闭后明文将立即清除且不会再次展示。"
              />

              {discardPromptVisible && (
                <div
                  data-testid="pat-discard-prompt"
                  className="rounded-md border border-warning/35 bg-warning-soft p-3 text-xs text-warning"
                >
                  <p id="pat-discard-reason">
                    尚未确认保存。放弃保存不影响已签发状态，关闭会立即清除本次演示明文。
                  </p>
                  <div className="mt-2.5 flex items-center justify-end gap-2">
                    <Button
                      variant="destructive"
                      size="xs"
                      aria-describedby="pat-discard-reason"
                      onClick={handleForceDiscard}
                    >
                      清除并关闭
                    </Button>
                    <Button
                      ref={keepBtnRef}
                      variant="outline"
                      size="xs"
                      aria-describedby="pat-discard-reason"
                      onClick={() => {
                        setDiscardPromptVisible(false);
                        copyBtnRef.current?.focus();
                      }}
                    >
                      继续保存
                    </Button>
                  </div>
                </div>
              )}
            </DialogBody>

            <DialogFooter>
              <Button
                variant="default"
                data-testid="pat-done-btn"
                disabled={!backupConfirmed}
                onClick={handleForceDiscard}
              >
                已保存，完成
              </Button>
            </DialogFooter>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export interface RevokeConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RevokeConfirmDialog({ open, onOpenChange }: RevokeConfirmDialogProps) {
  const pushToast = useToastStore((state) => state.push);
  const [confirmText, setConfirmText] = useState('');
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setConfirmText('');
      queueMicrotask(() => cancelBtnRef.current?.focus());
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      ariaLabelledBy="revoke-dialog-title"
      ariaDescribedBy="revoke-dialog-desc"
    >
      <DialogHeader>
        <div>
          <DialogTitle id="revoke-dialog-title">撤销演示令牌？</DialogTitle>
          <DialogDescription id="revoke-dialog-desc">
            破坏性二次确认交互预览，不影响任何真实凭据。
          </DialogDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭撤销确认弹窗"
          onClick={() => onOpenChange(false)}
        >
          <Icon name="x" className="size-4" />
        </Button>
      </DialogHeader>

      <DialogBody className="space-y-3">
        <Alert variant="warning">
          真实环境中，撤销将立即终止该令牌关联的 MCP 访问权限且不可恢复，必须重新签发。
        </Alert>
        <Field>
          <FieldLabel htmlFor="lab-revoke-confirm">
            输入 <code className="font-mono text-fg-main">REVOKE</code> 确认本次演示
          </FieldLabel>
          <Input
            id="lab-revoke-confirm"
            className="font-mono"
            placeholder="REVOKE"
            autoComplete="off"
            spellCheck={false}
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
          />
        </Field>
      </DialogBody>

      <DialogFooter>
        <Button ref={cancelBtnRef} variant="outline" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button
          variant="destructive"
          disabled={confirmText !== 'REVOKE'}
          onClick={() => {
            onOpenChange(false);
            pushToast('模拟撤销完成', '未修改或撤销任何真实访问令牌。', 'safe');
          }}
        >
          确认模拟撤销
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export interface SimpleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HelpShortcutsDialog({ open, onOpenChange }: SimpleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} ariaLabelledBy="help-dialog-title">
      <DialogHeader>
        <div>
          <DialogTitle id="help-dialog-title">实验室使用指南与快捷键</DialogTitle>
          <DialogDescription>
            开发态组件实验室：UI 交互本地演示，健康状态直连真实 admin-api:8081。
          </DialogDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭使用指南"
          onClick={() => onOpenChange(false)}
        >
          <Icon name="x" className="size-4" />
        </Button>
      </DialogHeader>

      <DialogBody className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg-muted">打开全局指令面板</span>
          <Kbd>Ctrl / ⌘ K</Kbd>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg-muted">关闭弹窗 / 抽屉并归还焦点</span>
          <Kbd>Esc</Kbd>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg-muted">键盘顺序移动焦点 / 激活操作</span>
          <span className="inline-flex items-center gap-1">
            <Kbd>Tab</Kbd>
            <Kbd>Enter</Kbd>
          </span>
        </div>
        <Alert variant="info" icon="zap">
          交互演练建议：在数据库地址中输入 127.0.0.1 触发模拟 SSRF 拦截；将主体配额滑至 70 QPM；或开启豁免后点击“模拟资源满载”。
        </Alert>
      </DialogBody>

      <DialogFooter>
        <Button variant="default" onClick={() => onOpenChange(false)}>
          知道了
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export function DesignPrinciplesDialog({ open, onOpenChange }: SimpleDialogProps) {
  const principles = [
    {
      index: '01',
      title: '零信任态势一等公民',
      body: 'AST 拦截、SSRF 防护与双重漏斗限流采用严密的四象限语义色，状态从不只依赖单一颜色。',
    },
    {
      index: '02',
      title: '锁定高信息密度 (8/10)',
      body: '固定 56px 顶栏、240px/64px 侧栏与 38px 紧凑表格行高，全站数值与耗时强制 tabular-nums。',
    },
    {
      index: '03',
      title: '防呆与防自残护栏',
      body: '破坏性操作需显式确认；受保护的超管按钮保持禁用并提供清晰原因 Tooltip；PAT 关闭即清空明文。',
    },
    {
      index: '04',
      title: '真实物理字段收敛',
      body: '审计详情抽屉仅展示 sys_audit_logs 真实落库字段，杜绝虚构 EXPLAIN、伪造 AST 树或无据按钮。',
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} ariaLabelledBy="principles-dialog-title">
      <DialogHeader>
        <div>
          <DialogTitle id="principles-dialog-title">设计原则</DialogTitle>
          <DialogDescription>
            对齐 UI_DESIGN_SPEC v1.0.0 与 FRONTEND_ARCHITECTURE_SPEC §9.3 OKLCH 体系。
          </DialogDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭设计原则"
          onClick={() => onOpenChange(false)}
        >
          <Icon name="x" className="size-4" />
        </Button>
      </DialogHeader>

      <DialogBody className="space-y-3.5">
        {principles.map((item) => (
          <div key={item.index} className="rounded-md border border-border-line bg-bg-app p-3">
            <h3 className="text-xs font-semibold text-fg-main">
              <span className="mr-1.5 font-mono text-primary">{item.index} /</span>
              {item.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{item.body}</p>
          </div>
        ))}
      </DialogBody>

      <DialogFooter>
        <Button variant="default" onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
