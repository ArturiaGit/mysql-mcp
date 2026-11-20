import { useEffect } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/form-controls';
import { Icon } from '@/components/ui/icon';
import { ConsoleShell } from '@/layouts/ConsoleShell';

export interface ModulePlaceholderViewProps {
  sectionLabel: string;
  pageLabel: string;
  milestone: string;
  description: string;
}

export default function ModulePlaceholderView({
  sectionLabel,
  pageLabel,
  milestone,
  description,
}: ModulePlaceholderViewProps) {
  useEffect(() => {
    document.title = `${pageLabel} | MySQL MCP Gateway Console`;
  }, [pageLabel]);

  return (
    <ConsoleShell sectionLabel={sectionLabel} pageLabel={pageLabel}>
      <Card className="max-w-[640px]" data-testid="module-placeholder-card">
        <CardHeader>
          <div>
            <CardTitle>
              <Icon name="shield" className="size-4 text-primary" />
              <span>{pageLabel}</span>
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Badge variant="primary" mono>
            {milestone}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4 text-xs text-fg-muted">
          <p>
            当前路由已接入 M1 四级安全守卫（AuthGuard → StatusGuard → MustChangePwdGuard →
            RoleGuard），完整业务交互将在 {milestone} 里程碑交付。
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard">
              <Icon name="arrow-left" className="size-3.5" />
              <span>返回工作台大盘</span>
            </Link>
          </Button>
        </CardContent>
      </Card>
    </ConsoleShell>
  );
}
