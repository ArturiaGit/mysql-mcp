import type { RegisterRequestDTO } from '@mysql-mcp/shared-types';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { registerAccount } from '@/api/auth';
import { isApiClientError } from '@/api/client';
import { RegisterRequestSchema } from '@/api/schemas/auth.schema';
import { PasswordStrengthPanel } from '@/components/auth/PasswordStrengthPanel';
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
  FieldHint,
  FieldLabel,
  Input,
  Textarea,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { AuthLayout } from '@/layouts/AuthLayout';

interface RegisterFormState {
  username: string;
  password: string;
  email: string;
  department: string;
  reason: string;
}

type RegisterFieldKey = keyof RegisterFormState;
type RegisterFieldErrors = Partial<Record<RegisterFieldKey, string>>;

function toRegisterPayload(form: RegisterFormState): RegisterRequestDTO {
  const trimmedEmail = form.email.trim();
  const trimmedDepartment = form.department.trim();
  const trimmedReason = form.reason.trim();
  return {
    username: form.username.trim(),
    password: form.password,
    email: trimmedEmail.length > 0 ? trimmedEmail : null,
    ...(trimmedDepartment.length > 0 ? { department: trimmedDepartment } : {}),
    ...(trimmedReason.length > 0 ? { reason: trimmedReason } : {}),
  };
}

export default function RegisterView() {
  const [form, setForm] = useState<RegisterFormState>({
    username: '',
    password: '',
    email: '',
    department: '',
    reason: '',
  });
  const [touched, setTouched] = useState<Partial<Record<RegisterFieldKey, boolean>>>({});
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<{ title: string; guidance: string } | null>(null);
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);

  useEffect(() => {
    document.title = '申请注册账号 | MySQL MCP Gateway Console';
  }, []);

  const validate = (nextForm: RegisterFormState): RegisterFieldErrors => {
    const parsed = RegisterRequestSchema.safeParse(toRegisterPayload(nextForm));
    if (parsed.success) return {};
    const nextErrors: RegisterFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (
        (key === 'username' ||
          key === 'password' ||
          key === 'email' ||
          key === 'department' ||
          key === 'reason') &&
        !nextErrors[key]
      ) {
        nextErrors[key] = issue.message;
      }
    }
    return nextErrors;
  };

  const updateField = (key: RegisterFieldKey, value: string) => {
    const nextForm = { ...form, [key]: value };
    setForm(nextForm);
    if (touched[key]) {
      setFieldErrors(validate(nextForm));
    }
  };

  const handleBlur = (key: RegisterFieldKey) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
    setFieldErrors(validate(form));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({
      username: true,
      password: true,
      email: true,
      department: true,
      reason: true,
    });
    const errors = validate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setSubmitting(true);
    setServerError(null);

    try {
      const payload = toRegisterPayload(form);
      const response = await registerAccount(payload);
      setSubmittedMessage(response.message);
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        if (error.code === 'ERR_AUTH_USERNAME_EXISTS') {
          setFieldErrors((prev) => ({ ...prev, username: error.message }));
        } else if (error.code === 'ERR_PASSWORD_POLICY_VIOLATED') {
          setFieldErrors((prev) => ({ ...prev, password: error.message }));
        } else if (error.validationErrors && error.validationErrors.length > 0) {
          const mapped: RegisterFieldErrors = {};
          for (const item of error.validationErrors) {
            if (
              item.field === 'username' ||
              item.field === 'password' ||
              item.field === 'email' ||
              item.field === 'department' ||
              item.field === 'reason'
            ) {
              mapped[item.field] = item.message;
            }
          }
          setFieldErrors((prev) => ({ ...prev, ...mapped }));
        }
        setServerError({
          title: error.message,
          guidance: error.actionGuidance,
        });
      } else {
        setServerError({
          title: '注册申请提交失败。',
          guidance: '请检查网络连接并稍后重试。',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedMessage) {
    return (
      <AuthLayout pageLabel="注册申请已提交">
        <Card className="w-full max-w-[460px]" data-testid="register-complete-card">
          <CardHeader className="border-b border-border-line pb-3.5">
            <div>
              <CardTitle>
                <Icon name="check-circle" className="size-4 text-safe" />
                <span>注册申请已提交审批</span>
              </CardTitle>
              <CardDescription>
                账号 <span className="font-mono text-fg-main">{form.username.trim()}</span> 当前处于 PENDING 待审批状态
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <Alert variant="safe">{submittedMessage}</Alert>
            <p className="text-xs leading-relaxed text-fg-muted">
              审批通过后，您可以直接使用本次设置的强密码登录控制台，无需首次登录强制重置密码。
              现在即可登录以查看审批排队进度。
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="default" asChild data-testid="register-goto-login-btn">
                <Link to="/login?registered=1">
                  <span>前往登录</span>
                  <Icon name="arrow-right" className="size-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  const isInvalid = (key: RegisterFieldKey) => Boolean(touched[key] && fieldErrors[key]);

  return (
    <AuthLayout pageLabel="自助申请注册">
      <Card className="w-full max-w-[500px]">
        <CardHeader className="border-b border-border-line pb-3.5">
          <div>
            <div className="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
              SELF-SERVICE REGISTRATION
            </div>
            <CardTitle className="mt-1 text-[16px]">
              <Icon name="user-plus" className="size-4 text-primary" />
              <span>申请开通 MySQL MCP 账号</span>
            </CardTitle>
            <CardDescription>
              注册时设置正式强密码，提交后进入管理员审批队列（审批通过后直接激活）
            </CardDescription>
          </div>
        </CardHeader>

        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <CardContent className="space-y-4 pt-4">
            {serverError && (
              <Alert variant="danger" role="alert" data-testid="register-error-banner">
                <div className="font-medium">{serverError.title}</div>
                <div className="mt-0.5 text-fg-muted">{serverError.guidance}</div>
              </Alert>
            )}

            <FieldGroup>
              <Field invalid={isInvalid('username')}>
                <FieldLabel htmlFor="register-username" required>
                  用户名
                </FieldLabel>
                <FieldHint id="register-username-hint">
                  3~64 位字母、数字、下划线 (_) 或连字符 (-)
                </FieldHint>
                <Input
                  id="register-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  enterKeyHint="next"
                  required
                  placeholder="例如：dev_alice"
                  value={form.username}
                  aria-invalid={isInvalid('username') ? 'true' : 'false'}
                  aria-describedby={
                    isInvalid('username')
                      ? 'register-username-hint register-username-error'
                      : 'register-username-hint'
                  }
                  onChange={(event) => updateField('username', event.target.value)}
                  onBlur={() => handleBlur('username')}
                />
                <FieldError id="register-username-error">
                  {isInvalid('username') ? fieldErrors.username : ''}
                </FieldError>
              </Field>

              <Field invalid={isInvalid('password')}>
                <FieldLabel htmlFor="register-password" required>
                  正式强密码
                </FieldLabel>
                <PasswordStrengthPanel id="register-password-rules" password={form.password} />
                <div className="relative flex items-center">
                  <Input
                    id="register-password"
                    name="new-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    enterKeyHint="next"
                    required
                    placeholder="请输入符合复杂度要求的强密码"
                    value={form.password}
                    className="pr-9"
                    aria-invalid={isInvalid('password') ? 'true' : 'false'}
                    aria-describedby={
                      isInvalid('password')
                        ? 'register-password-rules register-password-error'
                        : 'register-password-rules'
                    }
                    onChange={(event) => updateField('password', event.target.value)}
                    onBlur={() => handleBlur('password')}
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
                <FieldError id="register-password-error">
                  {isInvalid('password') ? fieldErrors.password : ''}
                </FieldError>
              </Field>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field invalid={isInvalid('email')}>
                  <FieldLabel htmlFor="register-email">工作邮箱（可选）</FieldLabel>
                  <Input
                    id="register-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    spellCheck={false}
                    enterKeyHint="next"
                    placeholder="name@company.com"
                    value={form.email}
                    aria-invalid={isInvalid('email') ? 'true' : 'false'}
                    aria-describedby={isInvalid('email') ? 'register-email-error' : undefined}
                    onChange={(event) => updateField('email', event.target.value)}
                    onBlur={() => handleBlur('email')}
                  />
                  <FieldError id="register-email-error">
                    {isInvalid('email') ? fieldErrors.email : ''}
                  </FieldError>
                </Field>

                <Field invalid={isInvalid('department')}>
                  <FieldLabel htmlFor="register-department">所属部门（可选）</FieldLabel>
                  <Input
                    id="register-department"
                    name="department"
                    type="text"
                    autoComplete="organization"
                    enterKeyHint="next"
                    placeholder="例如：AI 平台研发部"
                    value={form.department}
                    aria-invalid={isInvalid('department') ? 'true' : 'false'}
                    aria-describedby={
                      isInvalid('department') ? 'register-department-error' : undefined
                    }
                    onChange={(event) => updateField('department', event.target.value)}
                    onBlur={() => handleBlur('department')}
                  />
                  <FieldError id="register-department-error">
                    {isInvalid('department') ? fieldErrors.department : ''}
                  </FieldError>
                </Field>
              </div>

              <Field invalid={isInvalid('reason')}>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="register-reason">申请使用说明（可选）</FieldLabel>
                  <span className="font-mono text-[11px] text-fg-subtle tabular-nums">
                    {form.reason.length} / 512
                  </span>
                </div>
                <Textarea
                  id="register-reason"
                  name="reason"
                  maxLength={512}
                  placeholder="说明需要访问的数据源环境、业务背景或审批单号…"
                  value={form.reason}
                  aria-invalid={isInvalid('reason') ? 'true' : 'false'}
                  aria-describedby={isInvalid('reason') ? 'register-reason-error' : undefined}
                  onChange={(event) => updateField('reason', event.target.value)}
                  onBlur={() => handleBlur('reason')}
                />
                <FieldError id="register-reason-error">
                  {isInvalid('reason') ? fieldErrors.reason : ''}
                </FieldError>
              </Field>
            </FieldGroup>

            <Button
              type="submit"
              variant="default"
              size="md"
              className="w-full"
              data-testid="register-submit-btn"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Icon name="loader" className="size-4 animate-spin" />
                  <span>正在提交申请…</span>
                </>
              ) : (
                <>
                  <Icon name="user-plus" className="size-4" />
                  <span>提交注册申请</span>
                </>
              )}
            </Button>
          </CardContent>

          <CardFooter className="text-xs text-fg-muted">
            <span>已有账号？</span>
            <Link
              to="/login"
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              <Icon name="arrow-left" className="size-3.5" />
              <span>返回登录</span>
            </Link>
          </CardFooter>
        </form>
      </Card>
    </AuthLayout>
  );
}
