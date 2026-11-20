import type { ResubmitApprovalRequestDTO } from '@mysql-mcp/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { AUTH_ME_QUERY_KEY, resubmitApproval } from '@/api/auth';
import { isApiClientError } from '@/api/client';
import { ResubmitApprovalRequestSchema } from '@/api/schemas/auth.schema';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Textarea,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { useAuthenticatedUser } from '@/guards/auth-guards';
import { AuthLayout } from '@/layouts/AuthLayout';
import { useToastStore } from '@/stores/useToastStore';

interface ResubmitFormState {
  email: string;
  department: string;
  reason: string;
}

type ResubmitFieldKey = keyof ResubmitFormState;
type ResubmitFieldErrors = Partial<Record<ResubmitFieldKey, string>>;

function toResubmitPayload(form: ResubmitFormState): ResubmitApprovalRequestDTO {
  const trimmedEmail = form.email.trim();
  const trimmedDepartment = form.department.trim();
  return {
    email: trimmedEmail.length > 0 ? trimmedEmail : null,
    ...(trimmedDepartment.length > 0 ? { department: trimmedDepartment } : {}),
    reason: form.reason.trim(),
  };
}

export default function ResubmitApprovalView() {
  const user = useAuthenticatedUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);

  const [form, setForm] = useState<ResubmitFormState>({
    email: user.email ?? '',
    department: user.department ?? '',
    reason: '',
  });
  const [touched, setTouched] = useState<Partial<Record<ResubmitFieldKey, boolean>>>({});
  const [fieldErrors, setFieldErrors] = useState<ResubmitFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<{ title: string; guidance: string } | null>(null);

  useEffect(() => {
    document.title = '申请被驳回 · 补充重提 | MySQL MCP Gateway Console';
  }, []);

  const validate = (nextForm: ResubmitFormState): ResubmitFieldErrors => {
    const parsed = ResubmitApprovalRequestSchema.safeParse(toResubmitPayload(nextForm));
    if (parsed.success) return {};
    const errors: ResubmitFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if ((key === 'email' || key === 'department' || key === 'reason') && !errors[key]) {
        errors[key] = issue.message;
      }
    }
    return errors;
  };

  const updateField = (key: ResubmitFieldKey, value: string) => {
    const next = { ...form, [key]: value };
    setForm(next);
    if (touched[key]) {
      setFieldErrors(validate(next));
    }
  };

  const handleBlur = (key: ResubmitFieldKey) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
    setFieldErrors(validate(form));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ email: true, department: true, reason: true });
    const errors = validate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setSubmitting(true);
    setServerError(null);

    try {
      await resubmitApproval(toResubmitPayload(form));
      pushToast('已重新提交审批申请', '账号状态已回迁至 PENDING，正在转入排队等待页。', 'safe');
      await queryClient.refetchQueries({ queryKey: AUTH_ME_QUERY_KEY });
      navigate('/approvals/wait', { replace: true });
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        setServerError({
          title: error.message,
          guidance: error.actionGuidance,
        });
      } else {
        setServerError({
          title: '重新提交申请失败。',
          guidance: '请检查网络连接并稍后重试。',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isInvalid = (key: ResubmitFieldKey) => Boolean(touched[key] && fieldErrors[key]);

  return (
    <AuthLayout pageLabel="驳回详情与重新提交" user={user}>
      <Card className="w-full max-w-[540px]" data-testid="resubmit-approval-card">
        <CardHeader className="border-b border-border-line pb-3.5">
          <div>
            <div className="font-mono text-[10px] tracking-[0.16em] text-danger uppercase">
              APPROVAL REJECTED · RESUBMISSION
            </div>
            <CardTitle className="mt-1 text-[16px]">
              <Icon name="rotate-ccw" className="size-4 text-danger" />
              <span>注册申请已被管理员驳回</span>
            </CardTitle>
            <CardDescription>
              账号 <span className="font-mono text-fg-main">{user.username}</span> (ID{' '}
              <span className="font-mono tabular-nums">{user.id}</span>) 可补充资料后重新发起审批
            </CardDescription>
          </div>
          <Badge variant="danger" mono data-testid="rejected-status-badge">
            REJECTED
          </Badge>
        </CardHeader>

        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <CardContent className="space-y-4 pt-4">
            <Alert variant="danger" data-testid="reject-reason-box">
              <div className="space-y-1">
                <div className="font-semibold">管理员驳回原因</div>
                <div className="text-fg-main">
                  {user.reject_reason ?? '管理员未填写具体驳回理由，请补充完整业务背景与权限需求后重新提交。'}
                </div>
              </div>
            </Alert>

            {serverError && (
              <Alert variant="warning" role="alert" data-testid="resubmit-error-banner">
                <div className="font-medium">{serverError.title}</div>
                <div className="mt-0.5 text-fg-muted">{serverError.guidance}</div>
              </Alert>
            )}

            <FieldGroup>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field invalid={isInvalid('email')}>
                  <FieldLabel htmlFor="resubmit-email">工作邮箱（可选）</FieldLabel>
                  <Input
                    id="resubmit-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    spellCheck={false}
                    placeholder="name@company.com"
                    value={form.email}
                    aria-invalid={isInvalid('email') ? 'true' : 'false'}
                    aria-describedby={isInvalid('email') ? 'resubmit-email-error' : undefined}
                    onChange={(event) => updateField('email', event.target.value)}
                    onBlur={() => handleBlur('email')}
                  />
                  <FieldError id="resubmit-email-error">
                    {isInvalid('email') ? fieldErrors.email : ''}
                  </FieldError>
                </Field>

                <Field invalid={isInvalid('department')}>
                  <FieldLabel htmlFor="resubmit-department">所属部门（可选）</FieldLabel>
                  <Input
                    id="resubmit-department"
                    name="department"
                    type="text"
                    autoComplete="organization"
                    placeholder="例如：风控数据组"
                    value={form.department}
                    aria-invalid={isInvalid('department') ? 'true' : 'false'}
                    aria-describedby={
                      isInvalid('department') ? 'resubmit-department-error' : undefined
                    }
                    onChange={(event) => updateField('department', event.target.value)}
                    onBlur={() => handleBlur('department')}
                  />
                  <FieldError id="resubmit-department-error">
                    {isInvalid('department') ? fieldErrors.department : ''}
                  </FieldError>
                </Field>
              </div>

              <Field invalid={isInvalid('reason')}>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="resubmit-reason" required>
                    补充申请说明
                  </FieldLabel>
                  <span className="font-mono text-[11px] text-fg-subtle tabular-nums">
                    {form.reason.length} / 512
                  </span>
                </div>
                <Textarea
                  id="resubmit-reason"
                  name="reason"
                  maxLength={512}
                  required
                  placeholder="请针对上方驳回原因补充业务审批单号、目标库表范围或使用场景说明…"
                  value={form.reason}
                  aria-invalid={isInvalid('reason') ? 'true' : 'false'}
                  aria-describedby={isInvalid('reason') ? 'resubmit-reason-error' : undefined}
                  onChange={(event) => updateField('reason', event.target.value)}
                  onBlur={() => handleBlur('reason')}
                />
                <FieldError id="resubmit-reason-error">
                  {isInvalid('reason') ? fieldErrors.reason : ''}
                </FieldError>
              </Field>
            </FieldGroup>

            <Button
              type="submit"
              variant="default"
              size="md"
              className="w-full"
              data-testid="resubmit-submit-btn"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Icon name="loader" className="size-4 animate-spin" />
                  <span>正在重新提交审批…</span>
                </>
              ) : (
                <>
                  <Icon name="rotate-ccw" className="size-4" />
                  <span>补充资料并重新提交审批</span>
                </>
              )}
            </Button>
          </CardContent>
        </form>
      </Card>
    </AuthLayout>
  );
}
