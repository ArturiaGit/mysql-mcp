import { z } from 'zod';
import { ApiError } from './errors.js';

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new ApiError(400, 'ERR_VALIDATION_FAILED', { validation_errors: parsed.error.issues.map(({ path, code }) => ({
    field: path.map(String).join('.'), message: '字段格式无效。', rule: code,
  })) });
}

export const entityId = z.string().regex(/^[1-9][0-9]{0,19}$/)
  .refine((id) => id.length < 20 || id <= '18446744073709551615');
export const entityParams = z.strictObject({ id: entityId });
