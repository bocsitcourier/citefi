import {
  LayoutDashboard,
  Library,
  Activity,
  Share2,
  Search,
  Image,
  Users,
  Brain,
  Send,
  CalendarClock,
  Shield,
  UserCog,
  BarChart3,
  ScrollText,
  Settings,
  Map,
  AlertCircle,
  KeyRound,
  CreditCard,
  Building2,
  BarChart2,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
  adminOnly?: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { title: "Content Library", href: "/content", icon: Library },
      { title: "Monitoring", href: "/monitoring", icon: Activity },
    ],
  },
  {
    label: "Creation Labs",
    items: [
      { title: "Social Lab", href: "/social", icon: Share2 },
      { title: "SEO Intelligence", href: "/seo-tools", icon: Search },
      { title: "Media Manager", href: "/media", icon: Image },
    ],
  },
  {
    label: "Audience & AI",
    items: [
      { title: "Personas", href: "/personas", icon: Users },
      { title: "AI Learning", href: "/learning", icon: Brain },
    ],
  },
  {
    label: "Agency",
    items: [
      { title: "Agency Clients", href: "/agency", icon: Building2 },
      { title: "Client Dashboard", href: "/client-dashboard", icon: LayoutDashboard },
      { title: "My Dashboard", href: "/client/usage", icon: BarChart2 },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Publishing", href: "/settings/publishing", icon: Send },
      { title: "Billing & Credits", href: "/settings/billing", icon: CreditCard },
      { title: "Site Maps", href: "/site-map", icon: Map },
      { title: "Schedules", href: "/settings/schedules", icon: CalendarClock },
      { title: "Account & Security", href: "/settings", icon: KeyRound },
    ],
  },
  {
    label: "Administration",
    adminOnly: true,
    items: [
      { title: "Admin Hub", href: "/admin", icon: Shield, adminOnly: true },
      { title: "Users", href: "/admin/users", icon: UserCog, adminOnly: true },
      { title: "Analytics", href: "/admin/analytics", icon: BarChart3, adminOnly: true },
      { title: "Activity Logs", href: "/admin/activity-logs", icon: ScrollText, adminOnly: true },
      { title: "Error Logs", href: "/admin/error-logs", icon: AlertCircle, adminOnly: true },
      { title: "Settings", href: "/admin/settings", icon: Settings, adminOnly: true },
    ],
  },
];

export const PUBLIC_ROUTES = [
  "/login",
  "/signup",
  "/register",
  "/forgot-password",
  "/verify-2fa",
  "/accept-invite",
  "/embed",
  "/pricing",
  "/",
];

export const BREADCRUMB_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  content: "Content Library",
  batches: "Batches",
  select: "Select Titles",
  monitoring: "Monitoring",
  social: "Social Lab",
  create: "Create Post",
  "idea-video": "Idea to Video",
  "seo-tools": "SEO Intelligence",
  media: "Media Manager",
  personas: "Personas",
  learning: "AI Learning",
  settings: "Account Settings",
  billing: "Billing & Credits",
  publishing: "Publishing",
  jobs: "Jobs",
  job: "Job Detail",
  schedules: "Schedules",
  "site-map": "Site Maps",
  agency: "Agency Clients",
  "client-dashboard": "Client Dashboard",
  client: "My Dashboard",
  usage: "Usage",
  billing: "Billing",
  team: "Team",
  admin: "Admin",
  users: "Users",
  analytics: "Analytics",
  "activity-logs": "Activity Logs",
  "error-logs": "Error Logs",
  feedback: "Content Feedback",
  "login-history": "Login History",
  sessions: "Sessions",
  health: "Health",
  quotas: "Quotas",
  cleanup: "Cleanup",
};
