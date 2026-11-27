import { create } from 'zustand';
import type { IconName } from '@/components/ui/icon';

export interface CommandItem {
  id: string;
  title: string;
  tag: string;
  keywords: string;
  iconName: IconName;
  action: () => void;
}

interface CommandState {
  open: boolean;
  commands: CommandItem[];
  setOpen: (open: boolean) => void;
  openPalette: () => void;
  closePalette: () => void;
  registerCommands: (commands: CommandItem[]) => void;
}

export const useCommandStore = create<CommandState>((set) => ({
  open: false,
  commands: [],
  setOpen: (open) => set({ open }),
  openPalette: () => set({ open: true }),
  closePalette: () => set({ open: false }),
  registerCommands: (commands) => set({ commands }),
}));
