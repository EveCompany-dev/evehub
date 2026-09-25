/**
 * The icon vocabulary of the whole app — one library (Lucide, ISC license),
 * one stroke weight (see tokens.css), and one name per idea, so the same thing
 * always looks the same. Pages import from "@eve/ui"; nothing else in the repo
 * draws its own SVG glyphs, except brand marks (Eve, Instagram, Facebook).
 *
 * Picked for being readable at 14-18px the way Notion's are: outline style,
 * a recognisable silhouette per concept, no decoration.
 *
 *   Navigation   House Bell MessageCircle SquareKanban Table2 Plug Zap CalendarDays
 *                CircleDollarSign Users IdCard Settings History
 *   Actions      Plus Minus Pencil Trash2 X Check Search Maximize2 EllipsisVertical Paperclip Smile Copy
 *                GripVertical RefreshCw Undo2 CornerDownLeft
 *   Direction    ChevronDown ChevronRight ChevronLeft ArrowUp ArrowDown
 *   Status       CircleCheck CircleX Circle Lock LockOpen Clock KeyRound
 *   Content      FileText Folder Link2 AtSign Lightbulb ListChecks Bug Play Pause RotateCcw Megaphone
 *   Column types Type Hash SquareCheck CircleChevronDown List Contact
 *   Widgets      Calculator Timer StickyNote Bot Sunrise ListTodo Database
 *   Settings     SlidersHorizontal Palette Cable
 */
export {
  ArrowDown,
  ArrowUp,
  AtSign,
  Bell,
  Bot,
  Bug,
  Cable,
  Calculator,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Circle,
  CircleChevronDown,
  CircleDollarSign,
  CircleX,
  Clock,
  Contact,
  Copy,
  CornerDownLeft,
  Database,
  EllipsisVertical,
  FileText,
  Files,
  Folder,
  GripVertical,
  Hash,
  History,
  House,
  IdCard,
  KeyRound,
  Image as ImageIcon,
  Lightbulb,
  Link2,
  List,
  ListChecks,
  ListTodo,
  Lock,
  LockOpen,
  Maximize2,
  Megaphone,
  Minus,
  MessageCircle,
  MessageSquareQuote,
  Palette,
  Paperclip,
  Pause,
  RefreshCw,
  RotateCcw,
  Pencil,
  Play,
  Plug,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Smile,
  SquareCheck,
  SquareKanban,
  StickyNote,
  Sunrise,
  Table2,
  Timer,
  Trash2,
  Type,
  Undo2,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

export type { LucideIcon, LucideProps as IconProps } from 'lucide-react';
