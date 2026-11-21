import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AUTH_ME_QUERY_KEY } from '@/api/auth';
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
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { useAuthenticatedUser } from '@/guards/auth-guards';
import { AuthLayout } from '@/layouts/AuthLayout';
import { useToastStore } from '@/stores/useToastStore';

function formatUtc(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

export default function AccountDisabledView() {
  const user = useAuthenticatedUser();
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    document.title = '账号已停用 | MySQL MCP Gateway Console';
  }, []);

  const handleRecheck = async () => {
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ queryKey: AUTH_ME_QUERY_KEY });
      pushToast('状态已同步', '当前账号仍处于停用状态。', 'info');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <AuthLayout pageLabel="账号已停用" user={user}>
      <Card className="w-full max-w-[520px]" data-testid="account-disabled-card">
        <CardHeader className="border-b border-border-line pb-3.5">
          <div>
            <div className="font-mono text-[10px] tracking-[0.16em] text-danger uppercase">
              ACCESS SUSPENDED · L2 STATUS GUARD
            </div>
            <CardTitle className="mt-1 text-[16px]">
              <Icon name="ban" className="size-4 text-danger" />
              <span>当前账号已被系统管理员停用</span>
            </CardTitle>
            <CardDescription>
              所有控制台业务路由与 MCP 数据面访问权限均已冻结
            </CardDescription>
          </div>
          <Badge variant="danger" mono data-testid="disabled-status-badge">
            DISABLED
          </Badge>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          <Alert variant="danger">
            您的账号访问权限已被安全冻结（<code className="font-mono">ERR_AUTH_ACCOUNT_DISABLED</code>
            ）。如需申诉或申请恢复启用，请联系所属超级管理员或企业安全运维团队核实。
          </Alert>

          <dl className="grid grid-cols-1 gap-2.5 rounded-md border border-border-line bg-bg-surface/60 p-3.5 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-[11px] text-fg-subtle">账号用户名</dt>
              <dd className="mt-0.5 font-mono font-medium text-fg-main">{user.username}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-fg-subtle">账号 ID</dt>
              <dd className="mt-0.5 font-mono text-fg-main tabular-nums">{user.id}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-fg-subtle">联系邮箱</dt>
              <dd className="mt-0.5 font-mono text-fg-muted">{user.email ?? '未填写'}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-fg-subtle">所属部门</dt>
              <dd className="mt-0.5 text-fg-muted">{user.department ?? '未填写'}</dd>
            </div>
            <div className="sm:col-span-2 border-t border-border-line pt-2">
              <dt className="text-[11px] text-fg-subtle">账号创建时间 (UTC)</dt>
              <dd className="mt-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
                {formatUtc(user.created_at)}
              </dd>
            </div>
          </dl>
        </CardContent>

        <CardFooter>
          <span className="text-[11px] text-fg-subtle">
            管理员解冻后可点击右侧重新检查状态
          </span>
          <Button
            variant="outline"
            size="sm"
            data-testid="disabled-recheck-btn"
            disabled={refreshing}
            onClick={() => void handleRecheck()}
          >
            <Icon name="refresh" className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
            <span>重新检查状态</span>
          </Button>
        </CardFooter>
      </Card>
    </AuthLayout>
  );
}
