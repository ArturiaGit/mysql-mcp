## 第六章：状态管理模型与唯一事实来源 (SSOT)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        前端状态分类驱动与流转模型                                      │
├─────────────────┬──────────────────────┬───────────────────────────────────────────────┤
│ 状态层级        │ 管理驱动技术         │ 职责划分与典型场景                           │
├─────────────────┼──────────────────────┼───────────────────────────────────────────────┤
│ 1. 服务端数据缓存│ TanStack Query v5    │ 用户、Profile、审计日志、策略数据 (带 SWR 缓存) │
├─────────────────┼──────────────────────┼───────────────────────────────────────────────┤
│ 2. 唯一视口状态 │ URL SearchParams     │ 抽屉展开(?eventId=...)、审计筛选、分页页码    │
│    (SSOT 事实源)│ (基于 React Router)  │ 保证任何排查视角均可跨人员分享、刷新无损恢复  │
├─────────────────┼──────────────────────┼───────────────────────────────────────────────┤
│ 3. 客户端瞬态 UI│ Zustand 5.x          │ 侧边栏展开/折叠、暗色/浅色主题、全局快捷键浮层│
├─────────────────┼──────────────────────┼───────────────────────────────────────────────┤
│ 4. 态势感知通道 │ 短轮询 (v1.0 10s基线)│ 定时拉取大盘指标；v1.1 RFC 待批后升级为 SSE   │
└─────────────────┴──────────────────────┴───────────────────────────────────────────────┘
```

### 6.1 服务端状态缓存机理 (TanStack Query v5)
- **全局查询配置 (QueryClient Defaults)**：
  - `staleTime: 30 * 1000` (30 秒内数据视为新鲜，页面来回切换不触发重复网络请求)；
  - `gcTime: 5 * 60 * 1000` (未被引用的失效缓存保留 5 分钟后垃圾回收)；
  - `refetchOnWindowFocus: true` (DBA 从其他应用切回控制台时，自动静默同步最新安全数据)；
  - `retry: 1` (失败快速呈现，避免界面死等)。
- **操作安全原则**：
  - 高危安全操作（注册审批、角色变更、用户封禁、PAT 吊销）**绝不采用前端乐观更新**；
  - 界面统一展示 Pending Loading 状态，严格等待服务端 HTTP 200 确认后，再执行 `queryClient.invalidateQueries` 重新拉取权威状态。

### 6.2 唯一事实来源：URL SearchParams 状态机驱动
**彻底废除在 Zustand 中维护抽屉开闭与选中事件的冗余设计**。以 URL 为唯一事实来源：
```tsx
// apps/admin-ui/src/hooks/useInspectDrawer.ts
import { useSearchParams } from 'react-router-dom';

export function useInspectDrawer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeEventId = searchParams.get('eventId');

  const openDrawer = (eventId: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('eventId', eventId);
      return next;
    });
  };

  const closeDrawer = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('eventId');
      return next;
    });
  };

  return {
    isOpen: Boolean(activeEventId),
    activeEventId,
    openDrawer,
    closeDrawer,
  };
}
```

### 6.3 客户端瞬态 UI 状态 (Zustand)
Zustand 严格收缩边界，仅维护无法序列化到 URL 的界面轻量配置：
```ts
// apps/admin-ui/src/stores/useShellStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ShellState {
  sidebarCollapsed: boolean;
  theme: 'dark' | 'light';
  toggleSidebar: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: 'dark',
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'mcp_shell_settings',
    }
  )
);
```