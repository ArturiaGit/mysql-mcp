import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light';

const THEME_STORAGE_KEY = 'mcp-console-theme';

function readInitialTheme(): ThemeMode {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.dataset.theme;
    if (attr === 'light' || attr === 'dark') {
      return attr;
    }
  }
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // ignore storage failures
  }
  return 'dark';
}

function applyThemeToDocument(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute('content', theme);
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore storage failures
  }
}

function readInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= 1024 && window.innerWidth < 1440;
}

interface ShellState {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  hasUserToggledSidebar: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean, byUser?: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setMobileNavOpen: (open: boolean) => void;
  syncViewport: (width: number) => void;
}

export const useShellStore = create<ShellState>((set, get) => ({
  theme: readInitialTheme(),
  sidebarCollapsed: readInitialCollapsed(),
  mobileNavOpen: false,
  hasUserToggledSidebar: false,

  setTheme(theme) {
    applyThemeToDocument(theme);
    set({ theme });
  },

  toggleTheme() {
    const next: ThemeMode = get().theme === 'dark' ? 'light' : 'dark';
    applyThemeToDocument(next);
    set({ theme: next });
  },

  setSidebarCollapsed(collapsed, byUser = true) {
    set({
      sidebarCollapsed: collapsed,
      hasUserToggledSidebar: byUser ? true : get().hasUserToggledSidebar,
    });
  },

  toggleSidebarCollapsed() {
    set((state) => ({
      sidebarCollapsed: !state.sidebarCollapsed,
      hasUserToggledSidebar: true,
    }));
  },

  setMobileNavOpen(open) {
    set({ mobileNavOpen: open });
  },

  syncViewport(width) {
    if (width >= 1024 && get().mobileNavOpen) {
      set({ mobileNavOpen: false });
    }
    if (!get().hasUserToggledSidebar) {
      if (width >= 1440 && get().sidebarCollapsed) {
        set({ sidebarCollapsed: false });
      } else if (width >= 1024 && width < 1440 && !get().sidebarCollapsed) {
        set({ sidebarCollapsed: true });
      }
    }
  },
}));
