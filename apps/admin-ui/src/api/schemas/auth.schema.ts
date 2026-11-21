import * as z from 'zod/v4-mini';

export const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;
export const ENTITY_ID_REGEX = /^\d+$/;
export const PASSWORD_MIN_DAYS = 30;
export const PASSWORD_MAX_DAYS = 180;

/**
 * PROVISIONAL (RD-08 #5):
 * Product/security sign-off on `daysRemaining` rounding boundary & disabled copy
 * is still pending (`docs/DATABASE_DESIGN_SPEC.md` §15.1).
 * Keep these thresholds configurable instead of hardcoding magic literals in views.
 */
export const PROVISIONAL_RD_08_PASSWORD_DAYS_POLICY = Object.freeze({
  disabledValue: -1,
  minDays: PASSWORD_MIN_DAYS,
  maxDays: PASSWORD_MAX_DAYS,
  roundingMode: 'ceil' as const,
  provisionalTag: 'RD-08 #5',
});

export interface PasswordStrengthResult {
  lengthValid: boolean;
  recommendedLength: boolean;
  hasLower: boolean;
  hasUpper: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
  isValid: boolean;
  score: number;
  label: '未输入' | '弱' | '中（合规）' | '强（推荐）';
}

export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const lengthValid = password.length >= 8 && password.length <= 64;
  const recommendedLength = password.length >= 12 && password.length <= 64;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const isValid = lengthValid && hasLower && hasUpper && hasDigit && hasSpecial;

  let score = 0;
  if (lengthValid) score += 1;
  if (hasLower) score += 1;
  if (hasUpper) score += 1;
  if (hasDigit) score += 1;
  if (hasSpecial) score += 1;
  if (recommendedLength && isValid) score += 1;

  let label: PasswordStrengthResult['label'] = '未输入';
  if (password.length > 0) {
    if (!isValid) {
      label = '弱';
    } else if (recommendedLength) {
      label = '强（推荐）';
    } else {
      label = '中（合规）';
    }
  }

  return {
    lengthValid,
    recommendedLength,
    hasLower,
    hasUpper,
    hasDigit,
    hasSpecial,
    isValid,
    score,
    label,
  };
}

export const EntityIdSchema = z.string().check(z.regex(ENTITY_ID_REGEX, 'ID 必须为十进制整型字符串'));

export const SystemRoleSchema = z.enum([
  'SUPER_ADMIN',
  'SECURITY_ADMIN',
  'DBA',
  'ANALYST',
  'DEVELOPER',
]);

export const UserStatusSchema = z.enum(['PENDING', 'ACTIVE', 'REJECTED', 'DISABLED']);
export const RestrictedUserStatusSchema = z.enum(['PENDING', 'REJECTED', 'DISABLED']);

export const StrongPasswordSchema = z.string().check(
  z.minLength(8, '密码长度至少 8 位'),
  z.maxLength(64, '密码长度不能超过 64 位'),
  z.refine((value) => /[a-z]/.test(value), '必须包含小写字母'),
  z.refine((value) => /[A-Z]/.test(value), '必须包含大写字母'),
  z.refine((value) => /\d/.test(value), '必须包含数字'),
  z.refine((value) => /[^A-Za-z0-9]/.test(value), '必须包含特殊符号'),
);

export const UsernameSchema = z.string().check(
  z.regex(USERNAME_REGEX, '用户名须为 3~64 位字母、数字、下划线或连字符'),
);

export const CsrfTokenSchema = z.object({
  csrfToken: z.string().check(z.minLength(1)),
});

export const RegisterRequestSchema = z.object({
  username: UsernameSchema,
  password: StrongPasswordSchema,
  email: z.optional(z.nullable(z.email('请输入有效的邮箱地址').check(z.maxLength(128, '邮箱最长 128 字符')))),
  department: z.optional(z.string().check(z.maxLength(128, '部门名称最长 128 字符'))),
  reason: z.optional(z.string().check(z.maxLength(512, '申请理由最长 512 字符'))),
});

export const LoginRequestSchema = z.object({
  username: UsernameSchema,
  password: z.string().check(z.minLength(1, '请输入登录密码'), z.maxLength(1024)),
});

export const ChangePasswordRequestSchema = z.object({
  oldPassword: z.string().check(z.minLength(1, '请输入当前密码'), z.maxLength(1024)),
  newPassword: StrongPasswordSchema,
  revokeAllPats: z.optional(z.boolean()),
});

export const UpdatePasswordPolicyRequestSchema = z.object({
  passwordExpiresDays: z.nullable(
    z.int('轮换天数须为整数').check(
      z.gte(PASSWORD_MIN_DAYS, `密码有效期最短 ${PASSWORD_MIN_DAYS} 天`),
      z.lte(PASSWORD_MAX_DAYS, `密码有效期最长 ${PASSWORD_MAX_DAYS} 天`),
    ),
  ),
});

export const ResubmitApprovalRequestSchema = z.object({
  email: z.optional(z.nullable(z.email('请输入有效的邮箱地址').check(z.maxLength(128, '邮箱最长 128 字符')))),
  department: z.optional(z.string().check(z.maxLength(128, '部门名称最长 128 字符'))),
  reason: z.string().check(
    z.refine((value) => value.trim().length >= 1, '请填写补充后的申请理由'),
    z.maxLength(512, '申请理由最长 512 字符'),
  ),
});

export const UserProfileSchema = z.object({
  id: EntityIdSchema,
  username: z.string(),
  email: z.nullable(z.string()),
  department: z.nullable(z.string()),
  status: UserStatusSchema,
  must_change_password: z.boolean(),
  password_updated_at: z.string(),
  password_expires_days: z.nullable(z.number()),
  password_expires_at: z.nullable(z.string()),
  is_password_expired: z.boolean(),
  version: z.number(),
  roles: z.array(SystemRoleSchema),
  reject_reason: z.nullable(z.string()),
  created_at: z.string(),
});

export const ActiveUserProfileSchema = z.object({
  id: EntityIdSchema,
  username: z.string(),
  email: z.nullable(z.string()),
  department: z.nullable(z.string()),
  status: z.literal('ACTIVE'),
  must_change_password: z.boolean(),
  password_updated_at: z.string(),
  password_expires_days: z.nullable(z.number()),
  password_expires_at: z.nullable(z.string()),
  is_password_expired: z.boolean(),
  version: z.number(),
  roles: z.array(SystemRoleSchema),
  reject_reason: z.nullable(z.string()),
  created_at: z.string(),
});

export const RestrictedUserProfileSchema = z.object({
  id: EntityIdSchema,
  username: z.string(),
  email: z.nullable(z.string()),
  department: z.nullable(z.string()),
  status: RestrictedUserStatusSchema,
  reject_reason: z.nullable(z.string()),
  created_at: z.string(),
});

export const CurrentUserResponseSchema = z.union([
  ActiveUserProfileSchema,
  RestrictedUserProfileSchema,
]);

export const LoginResponseSchema = z.object({
  user: UserProfileSchema,
});

export const RegisterResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

export const PasswordPolicySchema = z.object({
  passwordExpiresDays: z.nullable(z.number()),
  passwordExpiresAt: z.nullable(z.string()),
  isExpirationEnabled: z.boolean(),
  daysRemaining: z.number(),
  isExpired: z.boolean(),
  minDays: z.number(),
  maxDays: z.number(),
});

export const UpdatePasswordPolicyResponseSchema = z.object({
  success: z.literal(true),
  passwordExpiresDays: z.nullable(z.number()),
  passwordExpiresAt: z.nullable(z.string()),
  isExpirationEnabled: z.boolean(),
});

export const ActionSuccessSchema = z.object({
  success: z.literal(true),
});

export const AuthErrorDetailsSchema = z.object({
  remaining_attempts: z.optional(z.number()),
  retry_after_sec: z.optional(z.number()),
});

export const ValidationErrorItemSchema = z.object({
  field: z.string(),
  message: z.string(),
  rule: z.string(),
});

export const StandardErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  action_guidance: z.optional(z.string()),
  timestamp: z.optional(z.string()),
  remaining_attempts: z.optional(z.number()),
  retry_after_sec: z.optional(z.number()),
  details: z.optional(
    z.object({
      validation_errors: z.optional(z.array(ValidationErrorItemSchema)),
    }),
  ),
});

export type CsrfTokenParsed = z.infer<typeof CsrfTokenSchema>;
export type RegisterRequestParsed = z.infer<typeof RegisterRequestSchema>;
export type LoginRequestParsed = z.infer<typeof LoginRequestSchema>;
export type ChangePasswordRequestParsed = z.infer<typeof ChangePasswordRequestSchema>;
export type UpdatePasswordPolicyRequestParsed = z.infer<typeof UpdatePasswordPolicyRequestSchema>;
export type ResubmitApprovalRequestParsed = z.infer<typeof ResubmitApprovalRequestSchema>;
export type UserProfileParsed = z.infer<typeof UserProfileSchema>;
export type RestrictedUserProfileParsed = z.infer<typeof RestrictedUserProfileSchema>;
export type CurrentUserResponseParsed = z.infer<typeof CurrentUserResponseSchema>;
export type LoginResponseParsed = z.infer<typeof LoginResponseSchema>;
export type RegisterResponseParsed = z.infer<typeof RegisterResponseSchema>;
export type PasswordPolicyParsed = z.infer<typeof PasswordPolicySchema>;
export type UpdatePasswordPolicyResponseParsed = z.infer<typeof UpdatePasswordPolicyResponseSchema>;
export type ActionSuccessParsed = z.infer<typeof ActionSuccessSchema>;
export type AuthErrorDetailsParsed = z.infer<typeof AuthErrorDetailsSchema>;
export type ValidationErrorItem = z.infer<typeof ValidationErrorItemSchema>;
