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
 *   Direction    ChevronDown ChevronRight ChevronLeft ArrowUp ArrowDown
 *   Status       CircleCheck CircleX Lock Clock KeyRound
 *   Content      FileText Folder Link2 AtSign Lightbulb ListChecks Bug Play Pause RotateCcw
 *   Column types Type Hash SquareCheck CircleChevronDown List Contact
 */
export {
  ArrowDown,
  ArrowUp,
  AtSign,
  Bell,
  Bug,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleChevronDown,
  CircleDollarSign,
  CircleX,
  Clock,
  Contact,
  Copy,
  EllipsisVertical,
  FileText,
  Files,
  Folder,
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
  Lock,
  Maximize2,
  Minus,
  MessageCircle,
  MessageSquareQuote,
  Paperclip,
  Pause,
  RotateCcw,
  Pencil,
  Play,
  Plug,
  Plus,
  Search,
  Settings,
  Smile,
  SquareCheck,
  SquareKanban,
  Table2,
  Trash2,
  Type,
  Users,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

export type { LucideProps as IconProps } from 'lucide-react';
