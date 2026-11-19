import { create } from 'zustand';

export type ToastTone = 'safe' | 'warning' | 'danger' | 'info';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: ToastItem[];
  push: (title: string, description?: string, tone?: ToastTone) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

let toastSequence = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push(title, description, tone = 'safe') {
    const id = `toast-${++toastSequence}`;
    set((state) => ({
      toasts: [...state.toasts.slice(-2), { id, title, description, tone }],
    }));
    window.setTimeout(() => {
      if (get().toasts.some((item) => item.id === id)) {
        get().dismiss(id);
      }
    }, 4500);
  },
  dismiss(id) {
    set((state) => ({
      toasts: state.toasts.filter((item) => item.id !== id),
    }));
  },
  clear() {
    set({ toasts: [] });
  },
}));
