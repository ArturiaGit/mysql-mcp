import type { ReactNode } from 'react';
import { Component } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form-controls';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // Route-level graceful degradation boundary (FRONTEND_ARCHITECTURE_SPEC.md §9.2)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-lg p-6">
          <Alert variant="danger">
            <div className="space-y-2">
              <div className="font-semibold">当前视图渲染发生异常</div>
              <p className="text-fg-muted">全局导航与其余功能未受影响，可尝试局部重试恢复。</p>
              <Button
                variant="outline"
                size="xs"
                onClick={() => this.setState({ hasError: false })}
              >
                重试渲染
              </Button>
            </div>
          </Alert>
        </div>
      );
    }
    return this.props.children;
  }
}
