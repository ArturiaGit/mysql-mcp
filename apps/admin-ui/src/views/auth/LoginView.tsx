import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { loginWithPassword, toCurrentUserResponse } from '@/api/auth';
import { isApiClientError, sanitizeReturnUrl } from '@/api/client';
import { resetSessionCacheForLogin } from '@/api/session-cache';
import { LoginRequestSchema } from '@/api/schemas/auth.schema';
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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { postLoginRedirectPath } from '@/guards/guard-decision';
import { AuthLayout } from '@/layouts/AuthLayout';

interface LoginFieldErrors {
  username?: string;
  password?: string;
}

function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export default function LoginView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<{ username: boolean; password: boolean }>({
    username: false,
    password: false,
  });
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const [authBanner, setAuthBanner] = useState<{
    tone: 'danger' | 'warning';
    title: string;
    guidance: string;
    remainingAttempts?: number;
  } | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);

  const warningParam = searchParams.get('warning');
  const registeredParam = searchParams.get('registered');
  const rawReturnUrl = searchParams.get('returnUrl');
  const safeReturnUrl = rawReturnUrl ? sanitizeReturnUrl(rawReturnUrl, '/dashboard') : null;

  useEffect(() => {
    document.title = '登录 | MySQL MCP Gateway Console';
  }, []);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setLockoutSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockoutSeconds]);

  const validateFields = (nextUsername: string, nextPassword: string): LoginFieldErrors => {
    const parsed = LoginRequestSchema.safeParse({
      username: nextUsername.trim(),
      password: nextPassword,
    });
    if (parsed.success) return {};
    const errors: LoginFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === 'username' && !errors.username) {
        errors.username = issue.message;
      } else if (key === 'password' && !errors.password) {
        errors.password = issue.message;
      }
    }
    return errors;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ username: true, password: true });
    const errors = validateFields(username, password);
    setFieldErrors(errors);
    if (errors.username || errors.password) {
      return;
    }

    setSubmitting(true);
    setAuthBanner(null);

    try {
      const response = await loginWithPassword({
        username: username.trim(),
        password,
      });
      const currentUser = toCurrentUserResponse(response.user);
      resetSessionCacheForLogin(queryClient, currentUser);
      const nextRoute = postLoginRedirectPath(currentUser, rawReturnUrl);
      navigate(nextRoute, { replace: true });
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        if (error.code === 'ERR_AUTH_ACCOUNT_LOCKED') {
          setLockoutSeconds(Math.max(1, error.retryAfterSec ?? 900));
          setAuthBanner({
            tone: 'danger',
            title: error.message,
            guidance: error.actionGuidance,
          });
        } else if (error.code === 'ERR_RATE_LIMIT_USER') {
          setLockoutSeconds(Math.max(1, error.retryAfterSec ?? 1));
          setAuthBanner({
            tone: 'warning',
            title: error.message,
            guidance: error.actionGuidance,
          });
        } else if (error.code === 'ERR_AUTH_FAILED') {
          setAuthBanner({
            tone: 'danger',
            title: error.message,
            guidance: error.actionGuidance,
            remainingAttempts: error.remainingAttempts,
          });
        } else {
          setAuthBanner({
            tone: error.status >= 500 || error.isNetworkError ? 'warning' : 'danger',
            title: error.message,
            guidance: error.actionGuidance,
          });
        }
      } else {
        setAuthBanner({
          tone: 'warning',
          title: '登录请求发生意外错误。',
          guidance: '请检查网络连接并重试。',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const usernameInvalid = touched.username && Boolean(fieldErrors.username);
  const passwordInvalid = touched.password && Boolean(fieldErrors.password);

  return (
    <AuthLayout pageLabel="身份认证登录">
      <div className="w-full max-w-[440px] space-y-3">
        {warningParam === 'session_unconfirmed' && (
          <Alert variant="warning" data-testid="logout-unconfirmed-banner">
            本地退出已完成，但服务端注销未确认，请检查网络或关闭浏览器以确保安全。
          </Alert>
        )}

        {registeredParam === '1' && (
          <Alert variant="safe" data-testid="register-success-banner">
            注册申请已成功提交。您可以使用刚刚设置的账号密码登录以查看审批进度。
          </Alert>
        )}

        {safeReturnUrl && safeReturnUrl !== '/dashboard' && (
          <Alert variant="info">
            <span>认证通过后将返回目标路径：</span>
            <code className="ml-1 font-mono text-[11px]">{safeReturnUrl}</code>
          </Alert>
        )}

        <Card>
          <CardHeader className="border-b border-border-line pb-3.5">
            <div>
              <div className="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
                CONTROL PLANE SIGN IN
              </div>
              <CardTitle className="mt-1 text-[16px]">
                <Icon name="lock" className="size-4 text-primary" />
                <span>登录 MySQL MCP 管控平台</span>
              </CardTitle>
              <CardDescription>
                采用 HttpOnly 会话 Cookie 与严格 CSRF 令牌保护
              </CardDescription>
            </div>
          </CardHeader>

          <form onSubmit={(event) => void handleSubmit(event)} noValidate>
            <CardContent className="space-y-4 pt-4">
              {authBanner && (
                <Alert
                  variant={authBanner.tone}
                  data-testid="login-error-banner"
                  role="alert"
                >
                  <div className="space-y-1.5">
                    <div className="font-medium">{authBanner.title}</div>
                    <div className="text-fg-muted">{authBanner.guidance}</div>
                    {authBanner.remainingAttempts !== undefined && (
                      <div className="pt-0.5">
                        <Badge
                          variant="danger"
                          mono
                          data-testid="login-remaining-attempts"
                        >
                          剩余尝试次数：{authBanner.remainingAttempts} 次
                        </Badge>
                      </div>
                    )}
                    {lockoutSeconds > 0 && (
                      <div className="pt-0.5">
                        <Badge
                          variant="warning"
                          mono
                          data-testid="login-lockout-countdown"
                        >
                          冷却倒计时：{formatCountdown(lockoutSeconds)} ({lockoutSeconds}s)
                        </Badge>
                      </div>
                    )}
                  </div>
                </Alert>
              )}

              <FieldGroup>
                <Field invalid={usernameInvalid}>
                  <FieldLabel htmlFor="login-username" required>
                    用户名
                  </FieldLabel>
                  <Input
                    id="login-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    enterKeyHint="next"
                    required
                    placeholder="请输入登录用户名"
                    value={username}
                    aria-invalid={usernameInvalid ? 'true' : 'false'}
                    aria-describedby={usernameInvalid ? 'login-username-error' : undefined}
                    onChange={(event) => {
                      const next = event.target.value;
                      setUsername(next);
                      if (touched.username) {
                        setFieldErrors(validateFields(next, password));
                      }
                    }}
                    onBlur={() => {
                      setTouched((prev) => ({ ...prev, username: true }));
                      setFieldErrors(validateFields(username, password));
                    }}
                  />
                  <FieldError id="login-username-error">
                    {usernameInvalid ? fieldErrors.username : ''}
                  </FieldError>
                </Field>

                <Field invalid={passwordInvalid}>
                  <FieldLabel htmlFor="login-password" required>
                    登录密码
                  </FieldLabel>
                  <div className="relative flex items-center">
                    <Input
                      id="login-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      enterKeyHint="done"
                      required
                      placeholder="请输入登录密码"
                      value={password}
                      className="pr-9"
                      aria-invalid={passwordInvalid ? 'true' : 'false'}
                      aria-describedby={passwordInvalid ? 'login-password-error' : undefined}
                      onChange={(event) => {
                        const next = event.target.value;
                        setPassword(next);
                        if (touched.password) {
                          setFieldErrors(validateFields(username, next));
                        }
                      }}
                      onBlur={() => {
                        setTouched((prev) => ({ ...prev, password: true }));
                        setFieldErrors(validateFields(username, password));
                      }}
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      title={showPassword ? '隐藏密码' : '显示密码'}
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-1.5 inline-flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover hover:text-fg-main cursor-pointer"
                    >
                      <Icon name={showPassword ? 'eye-off' : 'eye'} className="size-3.5" />
                    </button>
                  </div>
                  <FieldError id="login-password-error">
                    {passwordInvalid ? fieldErrors.password : ''}
                  </FieldError>
                </Field>
              </FieldGroup>

              <Button
                type="submit"
                variant="default"
                size="md"
                className="w-full"
                data-testid="login-submit-btn"
                disabled={submitting || lockoutSeconds > 0}
              >
                {submitting ? (
                  <>
                    <Icon name="loader" className="size-4 animate-spin" />
                    <span>正在验证身份…</span>
                  </>
                ) : lockoutSeconds > 0 ? (
                  <>
                    <Icon name="clock" className="size-4" />
                    <span className="tabular-nums">
                      账号已临时锁定 ({lockoutSeconds}s)
                    </span>
                  </>
                ) : (
                  <>
                    <Icon name="shield" className="size-4" />
                    <span>登录控制台</span>
                  </>
                )}
              </Button>
            </CardContent>

            <CardFooter className="text-xs text-fg-muted">
              <span>首次接入的研发或运维人员？</span>
              <Link
                to="/register"
                data-testid="goto-register-link"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <span>申请注册账号</span>
                <Icon name="arrow-right" className="size-3.5" />
              </Link>
            </CardFooter>
          </form>
        </Card>
      </div>
    </AuthLayout>
  );
}
