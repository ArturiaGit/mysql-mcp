import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  AUTH_ME_QUERY_KEY,
  changePassword,
  PASSWORD_POLICY_QUERY_KEY,
  updatePasswordPolicy,
  usePasswordPolicy,
} from '@/api/auth';
import { isApiClientError } from '@/api/client';
import {
  ChangePasswordRequestSchema,
  PASSWORD_MAX_DAYS,
  PASSWORD_MIN_DAYS,
  PROVISIONAL_RD_08_PASSWORD_DAYS_POLICY,
  UpdatePasswordPolicyRequestSchema,
} from '@/api/schemas/auth.schema';
import { PasswordStrengthPanel } from '@/components/auth/PasswordStrengthPanel';
import { Badge } from '@/components/ui/badge';
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldError,
  FieldGroup,
  FieldHint,
  FieldLabel,
  Input,
  Switch,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { useActiveUser } from '@/guards/auth-guards';
import { AuthLayout } from '@/layouts/AuthLayout';
import { ConsoleShell } from '@/layouts/ConsoleShell';
import { useToastStore } from '@/stores/useToastStore';

interface PasswordFieldErrors {
  oldPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

const PRESET_DAYS = [30, 60, 90, 180] as const;

function formatUtcTimestamp(iso: string | null): string {
  if (!iso) return '永不过期（已关闭定期轮换）';
  return iso.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

export default function ChangePasswordView() {
  const user = useActiveUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);

  const isForcedLock = user.must_change_password || user.is_password_expired;
  const {
    data: policy,
    isPending: policyLoading,
    isError: policyError,
    refetch: refetchPolicy,
  } = usePasswordPolicy(true);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [revokeAllPats, setRevokeAllPats] = useState(true);
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [touched, setTouched] = useState<{
    oldPassword: boolean;
    newPassword: boolean;
    confirmPassword: boolean;
  }>({
    oldPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [fieldErrors, setFieldErrors] = useState<PasswordFieldErrors>({});
  const [pwdBanner, setPwdBanner] = useState<{ title: string; guidance: string } | null>(null);
  const [submittingPwd, setSubmittingPwd] = useState(false);

  // Password rotation policy state
  const [rotationEnabled, setRotationEnabled] = useState(true);
  const [daysInput, setDaysInput] = useState('90');
  const [policyValidationError, setPolicyValidationError] = useState<string | null>(null);
  const [policyServerError, setPolicyServerError] = useState<{
    title: string;
    guidance: string;
  } | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);

  useEffect(() => {
    document.title = isForcedLock
      ? '强制修改密码 | MySQL MCP Gateway Console'
      : '密码与轮换策略 | MySQL MCP Gateway Console';
  }, [isForcedLock]);

  useEffect(() => {
    if (!policy) return;
    setRotationEnabled(policy.isExpirationEnabled);
    if (policy.passwordExpiresDays !== null) {
      setDaysInput(String(policy.passwordExpiresDays));
    }
  }, [policy]);

  const validatePasswordForm = (
    nextOld: string,
    nextNew: string,
    nextConfirm: string,
  ): PasswordFieldErrors => {
    const errors: PasswordFieldErrors = {};
    const parsed = ChangePasswordRequestSchema.safeParse({
      oldPassword: nextOld,
      newPassword: nextNew,
      revokeAllPats,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'oldPassword' && !errors.oldPassword) {
          errors.oldPassword = issue.message;
        } else if (key === 'newPassword' && !errors.newPassword) {
          errors.newPassword = issue.message;
        }
      }
    }
    if (!errors.newPassword && nextOld && nextNew && nextOld === nextNew) {
      errors.newPassword = '新密码不能与当前旧密码相同';
    }
    if (nextConfirm !== nextNew) {
      errors.confirmPassword = '两次输入的新密码不一致';
    }
    return errors;
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ oldPassword: true, newPassword: true, confirmPassword: true });
    const errors = validatePasswordForm(oldPassword, newPassword, confirmPassword);
    setFieldErrors(errors);
    if (errors.oldPassword || errors.newPassword || errors.confirmPassword) {
      return;
    }

    setSubmittingPwd(true);
    setPwdBanner(null);

    try {
      await changePassword({
        oldPassword,
        newPassword,
        revokeAllPats,
      });
      // Refresh user session state and policy after session/CSRF rotation
      await Promise.all([
        queryClient.refetchQueries({ queryKey: AUTH_ME_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: PASSWORD_POLICY_QUERY_KEY }),
      ]);
      pushToast('密码修改成功', '会话凭据与 CSRF 令牌已同步轮换。', 'safe');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      navigate('/dashboard', { replace: true });
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        if (error.code === 'ERR_OLD_PASSWORD_INVALID') {
          // 400 business error: preserve session & form inputs; never kick to /login
          setFieldErrors((prev) => ({ ...prev, oldPassword: error.message }));
        } else if (
          error.code === 'ERR_SAME_AS_OLD_PASSWORD' ||
          error.code === 'ERR_PASSWORD_POLICY_VIOLATED'
        ) {
          setFieldErrors((prev) => ({ ...prev, newPassword: error.message }));
        }
        setPwdBanner({
          title: error.message,
          guidance: error.actionGuidance,
        });
      } else {
        setPwdBanner({
          title: '密码修改失败。',
          guidance: '请检查网络连接并重试，当前会话与表单内容已保留。',
        });
      }
    } finally {
      setSubmittingPwd(false);
    }
  };

  const submitPolicyValue = async (passwordExpiresDays: number | null) => {
    setSavingPolicy(true);
    setPolicyServerError(null);
    try {
      await updatePasswordPolicy({ passwordExpiresDays });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PASSWORD_POLICY_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: AUTH_ME_QUERY_KEY }),
      ]);
      setDisableDialogOpen(false);
      setRiskAcknowledged(false);
      pushToast(
        passwordExpiresDays === null ? '已关闭密码定期轮换' : '密码轮换策略已更新',
        passwordExpiresDays === null
          ? '已记录高危配置变更审计；建议定期手动更换密码。'
          : `密码有效期已更新为 ${passwordExpiresDays} 天。`,
        passwordExpiresDays === null ? 'warning' : 'safe',
      );
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        setPolicyServerError({
          title: error.message,
          guidance: error.actionGuidance,
        });
      } else {
        setPolicyServerError({
          title: '策略保存失败。',
          guidance: '请稍后重试。',
        });
      }
    } finally {
      setSavingPolicy(false);
    }
  };

  const handlePolicySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isForcedLock) return;
    setPolicyValidationError(null);
    setPolicyServerError(null);

    if (!rotationEnabled) {
      // High-risk safeguard: disabling periodic rotation MUST go through explicit confirmation dialog
      setRiskAcknowledged(false);
      setDisableDialogOpen(true);
      return;
    }

    const numericDays = Number(daysInput.trim());
    const parsed = UpdatePasswordPolicyRequestSchema.safeParse({
      passwordExpiresDays: Number.isFinite(numericDays) ? numericDays : NaN,
    });
    if (!parsed.success) {
      setPolicyValidationError(
        parsed.error.issues[0]?.message ??
          `请输入 ${PASSWORD_MIN_DAYS}~${PASSWORD_MAX_DAYS} 之间的整数天数`,
      );
      return;
    }

    await submitPolicyValue(parsed.data.passwordExpiresDays);
  };

  const minDays = policy?.minDays ?? PROVISIONAL_RD_08_PASSWORD_DAYS_POLICY.minDays;
  const maxDays = policy?.maxDays ?? PROVISIONAL_RD_08_PASSWORD_DAYS_POLICY.maxDays;
  const isDisabledDays =
    policy !== undefined &&
    (!policy.isExpirationEnabled ||
      policy.daysRemaining === PROVISIONAL_RD_08_PASSWORD_DAYS_POLICY.disabledValue);

  const oldInvalid = touched.oldPassword && Boolean(fieldErrors.oldPassword);
  const newInvalid = touched.newPassword && Boolean(fieldErrors.newPassword);
  const confirmInvalid = touched.confirmPassword && Boolean(fieldErrors.confirmPassword);

  const content = (
    <div className="w-full max-w-[760px] space-y-4">
      {isForcedLock && (
        <Alert variant="warning" data-testid="forced-password-lock-banner">
          <div className="space-y-1">
            <div className="font-semibold">
              {user.must_change_password
                ? '安全守卫已锁定控制台访问：首次登录或管理员重置后须立即修改密码'
                : '安全守卫已锁定控制台访问：当前账号密码已超过有效期'}
            </div>
            <p className="text-fg-muted">
              在完成密码更新前，侧边栏导航、全局指令面板 (Ctrl+K) 与所有业务路由均保持阻断状态。
              改密成功后将自动轮换会话与 CSRF 令牌并解锁进入工作台大盘。
            </p>
          </div>
        </Alert>
      )}

      {!isForcedLock && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
              ACCOUNT SECURITY · PASSWORD LIFECYCLE
            </div>
            <h1 className="mt-1 text-xl font-semibold text-fg-main">密码安全与定期轮换策略</h1>
            <p className="mt-0.5 text-xs text-fg-muted">
              更新登录密码将同步递增会话版本并可选吊销历史 PAT；可在此调整个人密码轮换周期。
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard">
              <Icon name="arrow-left" className="size-3.5" />
              <span>返回工作台</span>
            </Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Change Password Card */}
        <Card className="lg:col-span-7">
          <CardHeader className="border-b border-border-line pb-3.5">
            <div>
              <CardTitle>
                <Icon name="key" className="size-4 text-primary" />
                <span>修改登录密码</span>
              </CardTitle>
              <CardDescription>
                账号：<span className="font-mono text-fg-main">{user.username}</span> (ID{' '}
                <span className="font-mono tabular-nums">{user.id}</span>)
              </CardDescription>
            </div>
            <Badge variant={isForcedLock ? 'warning' : 'safe'} mono>
              {isForcedLock ? 'LOCKED · L3' : 'ACTIVE'}
            </Badge>
          </CardHeader>

          <form onSubmit={(event) => void handlePasswordSubmit(event)} noValidate>
            <CardContent className="space-y-4 pt-4">
              {pwdBanner && (
                <Alert variant="danger" role="alert" data-testid="change-password-error-banner">
                  <div className="font-medium">{pwdBanner.title}</div>
                  <div className="mt-0.5 text-fg-muted">{pwdBanner.guidance}</div>
                </Alert>
              )}

              <FieldGroup>
                <Field invalid={oldInvalid}>
                  <FieldLabel htmlFor="old-password" required>
                    当前旧密码
                  </FieldLabel>
                  <div className="relative flex items-center">
                    <Input
                      id="old-password"
                      name="current-password"
                      type={showOld ? 'text' : 'password'}
                      autoComplete="current-password"
                      enterKeyHint="next"
                      required
                      placeholder="请输入当前正在使用的密码"
                      value={oldPassword}
                      className="pr-9"
                      aria-invalid={oldInvalid ? 'true' : 'false'}
                      aria-describedby={oldInvalid ? 'old-password-error' : undefined}
                      onChange={(event) => {
                        const next = event.target.value;
                        setOldPassword(next);
                        if (touched.oldPassword) {
                          setFieldErrors(validatePasswordForm(next, newPassword, confirmPassword));
                        }
                      }}
                      onBlur={() => {
                        setTouched((prev) => ({ ...prev, oldPassword: true }));
                        setFieldErrors(
                          validatePasswordForm(oldPassword, newPassword, confirmPassword),
                        );
                      }}
                    />
                    <button
                      type="button"
                      aria-label={showOld ? '隐藏当前密码' : '显示当前密码'}
                      onClick={() => setShowOld((prev) => !prev)}
                      className="absolute right-1.5 inline-flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg-main cursor-pointer"
                    >
                      <Icon name={showOld ? 'eye-off' : 'eye'} className="size-3.5" />
                    </button>
                  </div>
                  <FieldError id="old-password-error" data-testid="old-password-error">
                    {oldInvalid ? fieldErrors.oldPassword : ''}
                  </FieldError>
                </Field>

                <Field invalid={newInvalid}>
                  <FieldLabel htmlFor="new-password" required>
                    设置新密码
                  </FieldLabel>
                  <PasswordStrengthPanel id="change-password-rules" password={newPassword} />
                  <div className="relative flex items-center">
                    <Input
                      id="new-password"
                      name="new-password"
                      type={showNew ? 'text' : 'password'}
                      autoComplete="new-password"
                      enterKeyHint="next"
                      required
                      placeholder="请输入符合复杂度策略的新密码"
                      value={newPassword}
                      className="pr-9"
                      aria-invalid={newInvalid ? 'true' : 'false'}
                      aria-describedby={
                        newInvalid
                          ? 'change-password-rules new-password-error'
                          : 'change-password-rules'
                      }
                      onChange={(event) => {
                        const next = event.target.value;
                        setNewPassword(next);
                        if (touched.newPassword || touched.confirmPassword) {
                          setFieldErrors(validatePasswordForm(oldPassword, next, confirmPassword));
                        }
                      }}
                      onBlur={() => {
                        setTouched((prev) => ({ ...prev, newPassword: true }));
                        setFieldErrors(
                          validatePasswordForm(oldPassword, newPassword, confirmPassword),
                        );
                      }}
                    />
                    <button
                      type="button"
                      aria-label={showNew ? '隐藏新密码' : '显示新密码'}
                      onClick={() => setShowNew((prev) => !prev)}
                      className="absolute right-1.5 inline-flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg-main cursor-pointer"
                    >
                      <Icon name={showNew ? 'eye-off' : 'eye'} className="size-3.5" />
                    </button>
                  </div>
                  <FieldError id="new-password-error">
                    {newInvalid ? fieldErrors.newPassword : ''}
                  </FieldError>
                </Field>

                <Field invalid={confirmInvalid}>
                  <FieldLabel htmlFor="confirm-password" required>
                    确认新密码
                  </FieldLabel>
                  <Input
                    id="confirm-password"
                    name="confirm-new-password"
                    type={showNew ? 'text' : 'password'}
                    autoComplete="new-password"
                    enterKeyHint="done"
                    required
                    placeholder="请再次输入新密码"
                    value={confirmPassword}
                    aria-invalid={confirmInvalid ? 'true' : 'false'}
                    aria-describedby={confirmInvalid ? 'confirm-password-error' : undefined}
                    onChange={(event) => {
                      const next = event.target.value;
                      setConfirmPassword(next);
                      if (touched.confirmPassword) {
                        setFieldErrors(validatePasswordForm(oldPassword, newPassword, next));
                      }
                    }}
                    onBlur={() => {
                      setTouched((prev) => ({ ...prev, confirmPassword: true }));
                      setFieldErrors(
                        validatePasswordForm(oldPassword, newPassword, confirmPassword),
                      );
                    }}
                  />
                  <FieldError id="confirm-password-error">
                    {confirmInvalid ? fieldErrors.confirmPassword : ''}
                  </FieldError>
                </Field>

                <Checkbox
                  id="revoke-all-pats-check"
                  label="修改密码后同时吊销所有已签发的个人访问令牌 (PAT)"
                  checked={revokeAllPats}
                  onChange={(event) => setRevokeAllPats(event.target.checked)}
                />
              </FieldGroup>

              <Button
                type="submit"
                variant="default"
                size="md"
                className="w-full"
                data-testid="change-password-submit-btn"
                disabled={submittingPwd}
              >
                {submittingPwd ? (
                  <>
                    <Icon name="loader" className="size-4 animate-spin" />
                    <span>正在更新密码…</span>
                  </>
                ) : (
                  <>
                    <Icon name="shield" className="size-4" />
                    <span>{isForcedLock ? '确认修改密码并解锁控制台' : '确认修改密码'}</span>
                  </>
                )}
              </Button>
            </CardContent>
          </form>
        </Card>

        {/* Password Rotation Policy Card */}
        <Card className="lg:col-span-5">
          <CardHeader className="border-b border-border-line pb-3.5">
            <div>
              <CardTitle>
                <Icon name="clock" className="size-4 text-primary" />
                <span>个人密码轮换策略</span>
              </CardTitle>
              <CardDescription>GET / PUT /api/v1/auth/password-policy</CardDescription>
            </div>
            {policy && (
              <Badge
                variant={
                  !policy.isExpirationEnabled
                    ? 'warning'
                    : policy.isExpired
                      ? 'danger'
                      : 'safe'
                }
                mono
              >
                {!policy.isExpirationEnabled
                  ? 'DISABLED'
                  : policy.isExpired
                    ? 'EXPIRED'
                    : `${policy.daysRemaining}D LEFT`}
              </Badge>
            )}
          </CardHeader>

          <CardContent className="space-y-4 pt-4">
            {policyLoading ? (
              <div className="flex items-center gap-2 py-4 text-xs text-fg-muted">
                <Icon name="loader" className="size-3.5 animate-spin text-primary" />
                <span>正在加载密码轮换策略…</span>
              </div>
            ) : policyError || !policy ? (
              <Alert variant="warning">
                <div className="space-y-2">
                  <div>无法读取当前密码轮换策略。</div>
                  <Button variant="outline" size="xs" onClick={() => void refetchPolicy()}>
                    <Icon name="refresh" className="size-3" />
                    <span>重试加载</span>
                  </Button>
                </div>
              </Alert>
            ) : (
              <>
                <dl
                  className="grid grid-cols-2 gap-2 rounded-md border border-border-line bg-bg-surface/60 p-3 text-xs"
                  data-testid="password-policy-summary"
                >
                  <div>
                    <dt className="text-[11px] text-fg-subtle">当前轮换周期</dt>
                    <dd className="mt-0.5 font-mono font-medium text-fg-main tabular-nums">
                      {policy.isExpirationEnabled && policy.passwordExpiresDays !== null
                        ? `${policy.passwordExpiresDays} 天`
                        : '永不过期'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-fg-subtle">剩余有效天数</dt>
                    <dd
                      className="mt-0.5 font-mono font-medium text-fg-main tabular-nums"
                      data-testid="password-days-remaining"
                    >
                      {isDisabledDays
                        ? `已关闭 (${policy.daysRemaining})`
                        : `${policy.daysRemaining} 天`}
                    </dd>
                  </div>
                  <div className="col-span-2 border-t border-border-line pt-2">
                    <dt className="text-[11px] text-fg-subtle">下次到期时间 (UTC)</dt>
                    <dd className="mt-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
                      {formatUtcTimestamp(policy.passwordExpiresAt)}
                    </dd>
                  </div>
                </dl>

                <p className="text-[11px] leading-relaxed text-fg-subtle">
                  天数口径说明（暂定 {PROVISIONAL_RD_08_PASSWORD_DAYS_POLICY.provisionalTag}
                  ）：开启轮换时按自然日向上取整且最小为 0，关闭轮换时固定返回 -1。
                </p>

                {isForcedLock ? (
                  <Alert variant="info" data-testid="policy-readonly-lock-note">
                    强制改密锁定期间仅支持查看当前密码策略；完成上方改密并解锁后，可在此调整轮换周期或关闭定期轮换。
                  </Alert>
                ) : (
                  <form onSubmit={(event) => void handlePolicySubmit(event)} className="space-y-3">
                    {policyServerError && (
                      <Alert variant="danger" role="alert">
                        <div className="font-medium">{policyServerError.title}</div>
                        <div className="mt-0.5 text-fg-muted">{policyServerError.guidance}</div>
                      </Alert>
                    )}

                    <div className="flex items-center justify-between gap-3 rounded-md border border-border-line bg-bg-app px-3 py-2.5">
                      <div>
                        <div id="rotation-switch-label" className="text-xs font-medium text-fg-main">
                          启用密码定期轮换
                        </div>
                        <div className="text-[11px] text-fg-subtle">
                          建议保持 90 天定期更换，关闭将触发高危风险确认
                        </div>
                      </div>
                      <Switch
                        labelId="rotation-switch-label"
                        data-testid="password-rotation-switch"
                        checked={rotationEnabled}
                        onChange={(event) => {
                          setRotationEnabled(event.target.checked);
                          setPolicyValidationError(null);
                        }}
                      />
                    </div>

                    {rotationEnabled ? (
                      <Field invalid={Boolean(policyValidationError)}>
                        <FieldLabel htmlFor="password-expires-days" required>
                          轮换周期（{minDays}~{maxDays} 天）
                        </FieldLabel>
                        <Input
                          id="password-expires-days"
                          type="number"
                          inputMode="numeric"
                          min={minDays}
                          max={maxDays}
                          step={1}
                          value={daysInput}
                          className="font-mono tabular-nums"
                          aria-invalid={policyValidationError ? 'true' : 'false'}
                          aria-describedby={
                            policyValidationError ? 'password-expires-days-error' : undefined
                          }
                          onChange={(event) => {
                            setDaysInput(event.target.value);
                            setPolicyValidationError(null);
                          }}
                        />
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {PRESET_DAYS.map((preset) => (
                            <Button
                              key={preset}
                              variant={daysInput === String(preset) ? 'default' : 'outline'}
                              size="xs"
                              onClick={() => {
                                setDaysInput(String(preset));
                                setPolicyValidationError(null);
                              }}
                              className="font-mono tabular-nums"
                            >
                              {preset} 天
                            </Button>
                          ))}
                        </div>
                        <FieldError id="password-expires-days-error">
                          {policyValidationError ?? ''}
                        </FieldError>
                      </Field>
                    ) : (
                      <Alert variant="warning">
                        当前拟关闭密码定期轮换（提交 <code>null</code>）。保存时需二次勾选安全风险确认后方可生效。
                      </Alert>
                    )}

                    <Button
                      type="submit"
                      variant={rotationEnabled ? 'secondary' : 'destructive'}
                      size="sm"
                      className="w-full"
                      data-testid="save-password-policy-btn"
                      disabled={savingPolicy}
                    >
                      {savingPolicy ? (
                        <>
                          <Icon name="loader" className="size-3.5 animate-spin" />
                          <span>正在保存策略…</span>
                        </>
                      ) : rotationEnabled ? (
                        <>
                          <Icon name="shield" className="size-3.5" />
                          <span>保存轮换周期</span>
                        </>
                      ) : (
                        <>
                          <Icon name="alert-triangle" className="size-3.5" />
                          <span>关闭定期轮换…</span>
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* High-Risk Confirmation Dialog for Disabling Periodic Rotation (passwordExpiresDays: null) */}
      <Dialog
        open={disableDialogOpen}
        onOpenChange={(nextOpen) => {
          setDisableDialogOpen(nextOpen);
          if (!nextOpen) setRiskAcknowledged(false);
        }}
        ariaLabelledBy="disable-rotation-title"
        ariaDescribedBy="disable-rotation-desc"
      >
        <div data-testid="disable-rotation-confirm-dialog">
          <DialogHeader>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border border-danger/35 bg-danger-soft text-danger">
                <Icon name="alert-triangle" className="size-4" />
              </span>
              <div>
                <DialogTitle id="disable-rotation-title">安全风险警示：关闭密码定期轮换</DialogTitle>
                <DialogDescription id="disable-rotation-desc">
                  此操作将被后端记录为高危配置变更审计流水
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <Alert variant="danger">
              关闭密码定期轮换将使得账号密码永不过期，可能显著增加凭据被泄露、撞库或长期未察觉被盗用的安全风险。建议保持
              90 天定期更换周期。确认要关闭定期轮换吗？
            </Alert>

            <FieldHint>
              勾选下方确认框后，前端将向 <code>PUT /api/v1/auth/password-policy</code> 提交{' '}
              <code>{`{ "passwordExpiresDays": null }`}</code>。
            </FieldHint>

            <Checkbox
              id="confirm-disable-rotation-risk"
              label="我已知晓安全风险，确认关闭密码定期轮换"
              checked={riskAcknowledged}
              onChange={(event) => setRiskAcknowledged(event.target.checked)}
            />
          </DialogBody>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={savingPolicy}
              onClick={() => {
                setDisableDialogOpen(false);
                setRiskAcknowledged(false);
              }}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              data-testid="confirm-disable-rotation-btn"
              disabled={!riskAcknowledged || savingPolicy}
              onClick={() => void submitPolicyValue(null)}
            >
              {savingPolicy ? (
                <>
                  <Icon name="loader" className="size-3.5 animate-spin" />
                  <span>提交中…</span>
                </>
              ) : (
                <span>确认关闭定期轮换</span>
              )}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </div>
  );

  if (isForcedLock) {
    return (
      <AuthLayout pageLabel="强制修改密码 (L3 锁定)" user={user}>
        {content}
      </AuthLayout>
    );
  }

  return (
    <ConsoleShell sectionLabel="账号与安全" pageLabel="密码与轮换策略">
      {content}
    </ConsoleShell>
  );
}
