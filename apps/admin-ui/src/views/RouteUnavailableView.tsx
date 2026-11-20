import { useEffect } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { AuthLayout } from '@/layouts/AuthLayout';

export default function RouteUnavailableView() {
  useEffect(() => {
    document.title = '路由不可用 | MySQL MCP Gateway Console';
  }, []);

  return (
    <AuthLayout pageLabel="路由不可用">
      <Card className="w-full max-w-[480px]">
        <CardHeader>
          <div>
            <CardTitle>
              <Icon name="alert-triangle" className="size-4 text-warning" />
              <span>当前路径未在生产构建中挂载</span>
            </CardTitle>
            <CardDescription>仅开发态启用内部组件实验室路由</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="warning" data-testid="route-unavailable-banner">
            当前路径未在生产构建中挂载（例如开发态组件实验室 /_lab 仅在 DEV 模式启用）。
          </Alert>
          <div className="flex justify-end">
            <Button variant="default" size="sm" asChild>
              <Link to="/login">
                <span>前往登录页</span>
                <Icon name="arrow-right" className="size-3.5" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
