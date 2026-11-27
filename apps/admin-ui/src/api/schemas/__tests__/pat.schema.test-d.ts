import type {
  CreatePatRequestDTO,
  CreatePatResponseDTO,
  PatListItemDTO,
  ProfileOptionDTO,
} from '@mysql-mcp/shared-types';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  CreatePatRequestParsed,
  CreatePatResponseParsed,
  PatListItemParsed,
  ProfileOptionParsed,
} from '../pat.schema';

describe('pat.schema bidirectional static type equivalence with @mysql-mcp/shared-types', () => {
  it('matches all M2 PAT & ProfileOption DTOs bidirectionally', () => {
    expectTypeOf<CreatePatRequestParsed>().toEqualTypeOf<CreatePatRequestDTO>();
    expectTypeOf<CreatePatRequestDTO>().toEqualTypeOf<CreatePatRequestParsed>();

    expectTypeOf<PatListItemParsed>().toEqualTypeOf<PatListItemDTO>();
    expectTypeOf<PatListItemDTO>().toEqualTypeOf<PatListItemParsed>();

    expectTypeOf<CreatePatResponseParsed>().toEqualTypeOf<CreatePatResponseDTO>();
    expectTypeOf<CreatePatResponseDTO>().toEqualTypeOf<CreatePatResponseParsed>();

    expectTypeOf<ProfileOptionParsed>().toEqualTypeOf<ProfileOptionDTO>();
    expectTypeOf<ProfileOptionDTO>().toEqualTypeOf<ProfileOptionParsed>();
  });
});
