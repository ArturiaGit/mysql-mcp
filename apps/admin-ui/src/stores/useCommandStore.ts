import { create } from 'zustand';

export interface CommandItem {
  id: string;
  title: string;
  tag: string;
  keywords: string;
  iconName:
    | 'box'
    | 'sliders'
    | 'table'
    | 'activity'
    | 'key'
    | 'palette'
    | 'sun'
    | 'help'
    | 'shield'
    | 'heart-pulse';
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
