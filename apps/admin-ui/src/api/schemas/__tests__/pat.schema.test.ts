import { describe, expect, it } from 'vitest';
import {
  CreatePatRequestSchema,
  CreatePatResponseSchema,
  PAT_EXPIRES_DEFAULT_DAYS,
  PatListResponseSchema,
  ProfileOptionsResponseSchema,
  validateCreatePatForm,
} from '../pat.schema';

const SAMPLE_RAW_TOKEN = `mcp_pat_${'a1b2c3d4'.repeat(8)}`;

describe('pat.schema validation', () => {
  it('validates CreatePatRequestSchema bounds (name 1~64, expiresDays int 1~365)', () => {
    expect(CreatePatRequestSchema.safeParse({ name: 'Cursor-Agent-Dev', expiresDays: 90 }).success).toBe(true);
    expect(CreatePatRequestSchema.safeParse({ name: 'Min-Day', expiresDays: 1 }).success).toBe(true);
    expect(CreatePatRequestSchema.safeParse({ name: 'Max-Day', expiresDays: 365 }).success).toBe(true);
    expect(CreatePatRequestSchema.safeParse({ name: 'Default-Days' }).success).toBe(true);

    expect(CreatePatRequestSchema.safeParse({ name: '   ', expiresDays: 30 }).success).toBe(false);
    expect(CreatePatRequestSchema.safeParse({ name: 'a'.repeat(65), expiresDays: 30 }).success).toBe(false);
    expect(CreatePatRequestSchema.safeParse({ name: 'Zero-Day', expiresDays: 0 }).success).toBe(false);
    expect(CreatePatRequestSchema.safeParse({ name: 'Over-Max', expiresDays: 366 }).success).toBe(false);
    expect(CreatePatRequestSchema.safeParse({ name: 'Float-Day', expiresDays: 30.5 }).success).toBe(false);
  });

  it('maps and validates CreatePatFormDraft explicitly', () => {
    const defaultResult = validateCreatePatForm({ name: '  Local-CLI  ', expiresDaysInput: '' });
    expect(defaultResult.nameError).toBe('');
    expect(defaultResult.expiresError).toBe('');
    expect(defaultResult.payload).toEqual({
      name: 'Local-CLI',
      expiresDays: PAT_EXPIRES_DEFAULT_DAYS,
    });

    const invalidBoth = validateCreatePatForm({ name: '   ', expiresDaysInput: '400' });
    expect(invalidBoth.payload).toBeUndefined();
    expect(invalidBoth.nameError).toContain('令牌名称');
    expect(invalidBoth.expiresError).toContain('1~365');

    const nonInteger = validateCreatePatForm({ name: 'Test', expiresDaysInput: '12.5' });
    expect(nonInteger.payload).toBeUndefined();
    expect(nonInteger.expiresError).toContain('整数');

    const tooLong = validateCreatePatForm({ name: 'x'.repeat(65), expiresDaysInput: '30' });
    expect(tooLong.payload).toBeUndefined();
    expect(tooLong.nameError).toContain('64');
  });

  it('validates CreatePatResponseSchema and enforces 64-bit string EntityId & rawToken format', () => {
    const ok = CreatePatResponseSchema.safeParse({
      pat: {
        id: '9007199254740993123',
        name: 'Cursor-Agent-Dev',
        token_prefix: SAMPLE_RAW_TOKEN.slice(0, 16),
        expires_at: '2027-02-06T06:00:00.000Z',
        last_used_at: null,
        created_at: '2026-11-08T06:00:00.000Z',
      },
      rawToken: SAMPLE_RAW_TOKEN,
    });
    expect(ok.success).toBe(true);

    const badToken = CreatePatResponseSchema.safeParse({
      pat: {
        id: '201',
        name: 'Bad',
        token_prefix: 'mcp_demo_1234',
        expires_at: null,
        last_used_at: null,
        created_at: '2026-11-08T06:00:00.000Z',
      },
      rawToken: 'mcp_demo_short',
    });
    expect(badToken.success).toBe(false);
  });

  it('validates PatListResponseSchema and ProfileOptionsResponseSchema', () => {
    const pats = PatListResponseSchema.safeParse([
      {
        id: '201',
        name: 'Cursor-Agent-Dev',
        token_prefix: 'mcp_pat_8f3a9e2d',
        expires_at: '2027-02-08T06:00:00.000Z',
        last_used_at: '2026-11-08T08:12:00.000Z',
        created_at: '2026-11-08T06:00:00.000Z',
      },
    ]);
    expect(pats.success).toBe(true);

    const options = ProfileOptionsResponseSchema.safeParse([
      {
        id: '101',
        name: 'mysql_prod_primary',
        displayName: '核心业务主库 (只读镜像)',
      },
    ]);
    expect(options.success).toBe(true);

    const invalidOptionId = ProfileOptionsResponseSchema.safeParse([
      {
        id: 'not-a-bigint',
        name: 'mysql_prod_primary',
        displayName: '核心业务主库',
      },
    ]);
    expect(invalidOptionId.success).toBe(false);
  });
});
