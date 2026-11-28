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

export default function PendingApprovalView() {
  const user = useAuthenticatedUser();
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    document.title = '等待管理员审批 | MySQL MCP Gateway Console';
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ queryKey: AUTH_ME_QUERY_KEY });
      pushToast('状态已刷新', '已同步服务端最新审批状态。', 'info');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <AuthLayout pageLabel="待审批排队" user={user}>
      <Card className="w-full max-w-[520px]" data-testid="pending-approval-card">
        <CardHeader className="border-b border-border-line pb-3.5">
          <div>
            <div className="font-mono text-[10px] tracking-[0.16em] text-warning uppercase">
              ACCOUNT LIFECYCLE · L2 STATUS GUARD
            </div>
            <CardTitle className="mt-1 text-[16px]">
              <Icon name="clock" className="size-4 text-warning" />
              <span>账号注册申请正在审批排队中</span>
            </CardTitle>
            <CardDescription>
              您的身份会话有效，但须待管理员审批激活后方可进入业务控制台
            </CardDescription>
          </div>
          <Badge variant="warning" pulse title="PENDING" data-testid="pending-status-badge">
            待审批
          </Badge>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          <Alert variant="warning">
            您的注册申请已进入管理员审批队列。超级管理员或安全管理员审核通过并分配角色后，账号将直接转为{' '}
            <code className="font-mono">ACTIVE</code> 状态，届时可直接使用注册密码访问控制台。
          </Alert>

          <dl className="grid grid-cols-1 gap-2.5 rounded-md border border-border-line bg-bg-surface/60 p-3.5 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-[11px] text-fg-subtle">用户名</dt>
              <dd className="mt-0.5 font-mono font-medium text-fg-main">{user.username}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-fg-subtle">账号 ID</dt>
              <dd className="mt-0.5 font-mono text-fg-main tabular-nums">{user.id}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-fg-subtle">工作邮箱</dt>
              <dd className="mt-0.5 font-mono text-fg-muted">{user.email ?? '未填写'}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-fg-subtle">所属部门</dt>
              <dd className="mt-0.5 text-fg-muted">{user.department ?? '未填写'}</dd>
            </div>
            <div className="sm:col-span-2 border-t border-border-line pt-2">
              <dt className="text-[11px] text-fg-subtle">申请时间 (UTC)</dt>
              <dd className="mt-0.5 font-mono text-[11px] text-fg-muted tabular-nums">
                {formatUtc(user.created_at)}
              </dd>
            </div>
          </dl>
        </CardContent>

        <CardFooter>
          <span className="text-[11px] text-fg-subtle">
            如需加急审批，请联系所属安全管理员或 DBA
          </span>
          <Button
            variant="default"
            size="sm"
            data-testid="pending-refresh-btn"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
          >
            <Icon name="refresh" className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
            <span>刷新审批状态</span>
          </Button>
        </CardFooter>
      </Card>
    </AuthLayout>
  );
}
