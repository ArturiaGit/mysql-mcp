import * as z from 'zod/v4-mini';
import { EntityIdSchema } from './auth.schema';

export const PAT_NAME_MIN_LENGTH = 1;
export const PAT_NAME_MAX_LENGTH = 64;
export const PAT_EXPIRES_MIN_DAYS = 1;
export const PAT_EXPIRES_MAX_DAYS = 365;
export const PAT_EXPIRES_DEFAULT_DAYS = 90;
export const PAT_EXPIRES_PRESET_DAYS = [7, 30, 90, 180, 365] as const;
export const PAT_RAW_TOKEN_REGEX = /^mcp_pat_[0-9a-f]{64}$/;
export const PAT_PREFIX_REGEX = /^mcp_pat_[0-9a-f]{4,}$/;

export const CreatePatRequestSchema = z.object({
  name: z.string().check(
    z.refine((value) => value.trim().length >= PAT_NAME_MIN_LENGTH, '请输入令牌名称'),
    z.refine(
      (value) => value.trim().length <= PAT_NAME_MAX_LENGTH,
      `令牌名称不能超过 ${PAT_NAME_MAX_LENGTH} 字符`,
    ),
  ),
  expiresDays: z.optional(
    z.int('有效天数须为整数').check(
      z.gte(PAT_EXPIRES_MIN_DAYS, `有效期至少为 ${PAT_EXPIRES_MIN_DAYS} 天`),
      z.lte(PAT_EXPIRES_MAX_DAYS, `有效期最长为 ${PAT_EXPIRES_MAX_DAYS} 天`),
    ),
  ),
});

export const PatListItemSchema = z.object({
  id: EntityIdSchema,
  name: z.string(),
  token_prefix: z.string().check(z.minLength(1)),
  expires_at: z.nullable(z.string()),
  last_used_at: z.nullable(z.string()),
  created_at: z.string(),
});

export const PatListResponseSchema = z.array(PatListItemSchema);

export const CreatePatResponseSchema = z.object({
  pat: PatListItemSchema,
  rawToken: z.string().check(z.regex(PAT_RAW_TOKEN_REGEX, '服务端返回的 PAT 明文格式无效')),
});

export const ProfileOptionSchema = z.object({
  id: EntityIdSchema,
  name: z.string().check(z.minLength(1)),
  displayName: z.string().check(z.minLength(1)),
});

export const ProfileOptionsResponseSchema = z.array(ProfileOptionSchema);

export type CreatePatRequestParsed = z.infer<typeof CreatePatRequestSchema>;
export type PatListItemParsed = z.infer<typeof PatListItemSchema>;
export type CreatePatResponseParsed = z.infer<typeof CreatePatResponseSchema>;
export type ProfileOptionParsed = z.infer<typeof ProfileOptionSchema>;

export interface CreatePatFormDraft {
  name: string;
  expiresDaysInput: string;
}

export interface CreatePatValidationResult {
  payload?: CreatePatRequestParsed;
  nameError: string;
  expiresError: string;
}

/**
 * Explicit form-to-DTO validator & mapper for POST /api/v1/pats.
 */
export function validateCreatePatForm(draft: CreatePatFormDraft): CreatePatValidationResult {
  const trimmedName = draft.name.trim();
  const trimmedDays = draft.expiresDaysInput.trim();

  let nameError = '';
  let expiresError = '';

  if (trimmedName.length < PAT_NAME_MIN_LENGTH) {
    nameError = '请输入令牌名称（1~64 字符）。';
  } else if (trimmedName.length > PAT_NAME_MAX_LENGTH) {
    nameError = `令牌名称不能超过 ${PAT_NAME_MAX_LENGTH} 字符。`;
  }

  let parsedDays: number | undefined;
  if (trimmedDays.length === 0) {
    parsedDays = PAT_EXPIRES_DEFAULT_DAYS;
  } else if (!/^\d+$/.test(trimmedDays)) {
    expiresError = `有效期须为 ${PAT_EXPIRES_MIN_DAYS}~${PAT_EXPIRES_MAX_DAYS} 之间的整数。`;
  } else {
    const candidate = Number.parseInt(trimmedDays, 10);
    if (
      !Number.isSafeInteger(candidate) ||
      candidate < PAT_EXPIRES_MIN_DAYS ||
      candidate > PAT_EXPIRES_MAX_DAYS
    ) {
      expiresError = `有效期须在 ${PAT_EXPIRES_MIN_DAYS}~${PAT_EXPIRES_MAX_DAYS} 天之间。`;
    } else {
      parsedDays = candidate;
    }
  }

  if (nameError || expiresError) {
    return { nameError, expiresError };
  }

  const checked = CreatePatRequestSchema.safeParse({
    name: trimmedName,
    expiresDays: parsedDays,
  });
  if (!checked.success) {
    const first = checked.error.issues[0];
    return {
      nameError: first?.path[0] === 'name' ? first.message : '',
      expiresError: first?.path[0] === 'expiresDays' ? first.message : '',
    };
  }

  return {
    payload: checked.data,
    nameError: '',
    expiresError: '',
  };
}
