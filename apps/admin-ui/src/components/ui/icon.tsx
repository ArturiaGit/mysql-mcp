import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Ban,
  BookOpen,
  Box,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  HeartPulse,
  HelpCircle,
  KeyRound,
  LayoutGrid,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Menu,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Table2,
  Terminal,
  UserCheck,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export const ICONS = {
  activity: Activity,
  'alert-triangle': AlertTriangle,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up-down': ArrowUpDown,
  ban: Ban,
  book: BookOpen,
  box: Box,
  building: Building2,
  check: Check,
  'check-circle': CheckCircle2,
  'chevron-right': ChevronRight,
  clock: Clock,
  code: Code2,
  copy: Copy,
  database: Database,
  download: Download,
  'external-link': ExternalLink,
  eye: Eye,
  'eye-off': EyeOff,
  'file-text': FileText,
  'heart-pulse': HeartPulse,
  help: HelpCircle,
  key: KeyRound,
  grid: LayoutGrid,
  loader: Loader2,
  lock: Lock,
  logout: LogOut,
  mail: Mail,
  menu: Menu,
  moon: Moon,
  palette: Palette,
  'panel-close': PanelLeftClose,
  'panel-open': PanelLeftOpen,
  plus: Plus,
  refresh: RefreshCw,
  'rotate-ccw': RotateCcw,
  search: Search,
  server: Server,
  'shield-alert': ShieldAlert,
  'shield-ban': ShieldBan,
  shield: ShieldCheck,
  sliders: SlidersHorizontal,
  sun: Sun,
  table: Table2,
  terminal: Terminal,
  'user-check': UserCheck,
  'user-plus': UserPlus,
  users: Users,
  x: X,
  zap: Zap,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export interface IconProps extends Omit<LucideProps, 'ref'> {
  name: IconName;
  label?: string;
}

export function Icon({ name, label, className, strokeWidth = 1.75, ...props }: IconProps) {
  const Component = ICONS[name];
  return (
    <Component
      strokeWidth={strokeWidth}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      className={cn('size-4 shrink-0', className)}
      {...props}
    />
  );
}
