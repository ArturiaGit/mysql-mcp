import type { ConflictErrorDetailsDTO, ErrorCode, UserStatus } from '@mysql-mcp/shared-types';

type ErrorDetails = Partial<ConflictErrorDetailsDTO> & {
  current_status?: UserStatus;
  requiredRoles?: readonly string[];
  remaining_attempts?: number;
  retry_after_sec?: number;
  validation_errors?: { field: string; message: string; rule: string }[];
};

const guidance: Partial<Record<ErrorCode, readonly [string, string]>> = {
  ERR_AUTH_FAILED: ['账号或密码错误。', '请核对后重试。'],
  ERR_AUTH_UNAUTHORIZED: ['登录会话无效。', '请重新登录。'],
  ERR_OLD_PASSWORD_INVALID: ['当前密码不正确。', '请核对当前密码后重试。'],
  ERR_AUTH_ACCOUNT_LOCKED: ['账号已临时锁定。', '请等待冷却后重试。'],
  ERR_CSRF_INVALID: ['安全令牌无效或已过期。', '请刷新安全令牌后重试。'],
  ERR_MUST_CHANGE_PASSWORD: ['密码需要更新。', '请修改密码后继续。'],
  ERR_PASSWORD_POLICY_VIOLATED: ['密码不符合复杂度要求。', '使用 8 至 64 个字符，包含大小写字母、数字和符号。'],
  ERR_AUTH_ACCOUNT_PENDING: ['账号尚未通过审批。', '请等待管理员审批。'],
  ERR_AUTH_ACCOUNT_REJECTED: ['申请已被驳回。', '请补充信息后重新提交。'],
  ERR_AUTH_ACCOUNT_DISABLED: ['账号已停用。', '请联系管理员。'],
  ERR_AUTH_USERNAME_EXISTS: ['用户名已存在。', '请更换用户名。'],
  ERR_PAT_NAME_EXISTS: ['该令牌名称已被占用，请更换其他名称。', '同一账号下有效令牌名称不可重复；吊销旧令牌后方可复用同名。'],
  ERR_SAME_AS_OLD_PASSWORD: ['新旧密码相同。', '请设置不同的新密码。'],
  ERR_NOT_FOUND: ['资源不存在。', '请检查请求路径。'],
  ERR_RBAC_FORBIDDEN: ['无权执行此操作。', '请联系管理员确认资源权限。'],
  ERR_APPROVAL_STATE_CONFLICT: ['该审批工单状态已发生变更或已被处理。', '请刷新待审列表后查看最新状态。'],
  ERR_INVALID_STATUS_TRANSITION: ['非法账号状态流转。', '请检查当前账号状态。待审或已驳回账号必须通过审批流程变更状态。'],
  ERR_CONCURRENCY_CONFLICT: ['当前配置已被其他管理员更新。', '请保留修改草稿，加载最新版本并比对后重新提交。'],
  ERR_SELF_ACTION_PROHIBITED: ['禁止停用、删除自身账号或移除自身的超级管理员角色。', '如需交接管理权限，请联系其他超级管理员。'],
  ERR_LAST_SUPER_ADMIN: ['操作已被阻止：系统必须保留至少 1 名活跃超级管理员。', '请先激活或指派其他超级管理员账号，再对当前账号执行变更。'],
  ERR_VALIDATION_FAILED: ['请求入参格式校验失败。', '请检查输入参数的格式、长度及取值。'],
  ERR_RATE_LIMIT_USER: ['请求过于频繁，已触发限流保护。', '请等待冷却倒计时结束后重试。'],
};

export class ApiError extends Error {
  constructor(readonly statusCode: number, readonly code: ErrorCode, readonly details?: ErrorDetails) {
    super(code);
  }
}

export function errorBody(error: ApiError) {
  const [message, action_guidance] = guidance[error.code] ?? ['请求未能完成。', '请检查输入或联系管理员。'];
  const { remaining_attempts, retry_after_sec, validation_errors } = error.details ?? {};
  const { current_version, submitted_version, current_status, requiredRoles } = error.details ?? {};
  return {
    code: error.code, message, action_guidance, timestamp: new Date().toISOString(),
    ...(remaining_attempts === undefined ? {} : { remaining_attempts }),
    ...(retry_after_sec === undefined ? {} : { retry_after_sec }),
    ...(error.code === 'ERR_CONCURRENCY_CONFLICT' && current_version !== undefined && submitted_version !== undefined
      ? { details: { current_version, submitted_version } } : {}),
    ...(error.code === 'ERR_INVALID_STATUS_TRANSITION' && current_status !== undefined ? { details: { current_status } } : {}),
    ...(error.code === 'ERR_RBAC_FORBIDDEN' && requiredRoles ? { details: { requiredRoles } } : {}),
    ...(error.code === 'ERR_VALIDATION_FAILED' ? { details: { validation_errors: validation_errors ?? [] } } : {}),
  };
}
