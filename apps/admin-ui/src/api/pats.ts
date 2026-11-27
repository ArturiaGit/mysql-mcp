import type {
  ActionSuccessDTO,
  CreatePatRequestDTO,
  CreatePatResponseDTO,
  EntityId,
  PatListItemDTO,
  ProfileOptionDTO,
} from '@mysql-mcp/shared-types';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './client';
import { ActionSuccessSchema } from './schemas/auth.schema';
import {
  CreatePatResponseSchema,
  PatListResponseSchema,
  ProfileOptionsResponseSchema,
} from './schemas/pat.schema';

export const DEVELOPER_QUERY_SCOPE = ['developer'] as const;

export function patsQueryKey(userId: EntityId | null | undefined) {
  return ['developer', userId ?? 'anonymous', 'pats'] as const;
}

export function myProfileOptionsQueryKey(userId: EntityId | null | undefined) {
  return ['developer', userId ?? 'anonymous', 'profile-options'] as const;
}

export async function fetchMyPats(signal?: AbortSignal): Promise<PatListItemDTO[]> {
  return apiRequest<PatListItemDTO[]>('/api/v1/pats', {
    method: 'GET',
    schema: PatListResponseSchema,
    signal,
  });
}

/**
 * Imperative PAT creation call.
 * SECURITY: Never cache the returned `rawToken` inside TanStack Query or Zustand.
 * Keep it strictly in the ephemeral local state of PatCreateModal until closed.
 */
export async function createPat(payload: CreatePatRequestDTO): Promise<CreatePatResponseDTO> {
  return apiRequest<CreatePatResponseDTO>('/api/v1/pats', {
    method: 'POST',
    body: {
      name: payload.name.trim(),
      ...(payload.expiresDays !== undefined ? { expiresDays: payload.expiresDays } : {}),
    },
    schema: CreatePatResponseSchema,
  });
}

export async function revokePat(patId: EntityId): Promise<ActionSuccessDTO> {
  return apiRequest<ActionSuccessDTO>(`/api/v1/pats/${encodeURIComponent(patId)}/revoke`, {
    method: 'POST',
    schema: ActionSuccessSchema,
  });
}

export async function fetchMyProfileOptions(signal?: AbortSignal): Promise<ProfileOptionDTO[]> {
  return apiRequest<ProfileOptionDTO[]>('/api/v1/profiles/my-options', {
    method: 'GET',
    schema: ProfileOptionsResponseSchema,
    signal,
  });
}

export function useMyPats(userId: EntityId | null | undefined) {
  const hasValidUser = typeof userId === 'string' && userId.length > 0;
  return useQuery({
    queryKey: patsQueryKey(userId),
    queryFn: ({ signal }) => fetchMyPats(signal),
    enabled: hasValidUser,
    retry: false,
    staleTime: 15_000,
  });
}

export function useMyProfileOptions(userId: EntityId | null | undefined) {
  const hasValidUser = typeof userId === 'string' && userId.length > 0;
  return useQuery({
    queryKey: myProfileOptionsQueryKey(userId),
    queryFn: ({ signal }) => fetchMyProfileOptions(signal),
    enabled: hasValidUser,
    retry: false,
    staleTime: 30_000,
  });
}
