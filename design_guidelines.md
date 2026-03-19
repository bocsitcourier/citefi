# Design Guidelines: Dual-AI SEO Content Factory

## Design Approach
**Selected Approach:** Design System (Modern SaaS Productivity Tool)

**Rationale:** This is a utility-focused, information-dense application requiring efficiency and consistency. Drawing inspiration from Linear, Notion, and Vercel's design languages for their clarity, professional aesthetics, and excellent handling of complex workflows.

**Core Principles:**
- Clarity over decoration: Every element serves a functional purpose
- Consistent patterns: Users learn once, apply everywhere
- Speed and efficiency: Minimize cognitive load in content creation workflows
- Professional polish: Build trust for enterprise users

## Typography System

**Primary Font:** Inter (Google Fonts)
- Headings: 600 weight
- Body: 400 weight
- Labels/UI: 500 weight

**Scale:**
- Page Titles: text-3xl (30px)
- Section Headers: text-xl (20px)
- Card Titles: text-lg (18px)
- Body Text: text-base (16px)
- Captions/Labels: text-sm (14px)
- Micro-copy: text-xs (12px)

## Layout System

**Spacing Primitives:** Use Tailwind units of 2, 4, 6, 8, 12, 16, 24
- Component padding: p-4, p-6
- Section spacing: space-y-6, space-y-8
- Page margins: px-6 md:px-8 lg:px-12
- Vertical rhythm: my-8, my-12 for major sections

**Container Strategy:**
- Sidebar: Fixed 240px (w-60) on desktop
- Main content: max-w-7xl with responsive padding
- Forms/modals: max-w-2xl for optimal readability
- Dashboard cards: Grid system with gap-6

## Component Library

### Navigation
**Sidebar (Primary Navigation):**
- Fixed left sidebar with logo at top
- Navigation items with icons (Heroicons) + labels
- Active state: subtle background highlight
- Collapsible on mobile (hamburger menu)
- Bottom section for user profile/settings

**Top Bar:**
- Breadcrumb navigation (left)
- Search bar (center, prominent)
- User actions: notifications, account menu (right)
- Height: h-16

### Dashboard Components
**Content Cards:**
- Elevated surface with subtle border
- Header with title + action buttons
- Content area with appropriate density
- Footer with metadata (dates, status)
- Hover state: subtle shadow increase

**Data Tables:**
- Sticky header row
- Alternating row backgrounds for readability
- Sortable columns with indicators
- Row actions on hover (right-aligned)
- Pagination controls at bottom
- Empty states with helpful guidance

**Stats/Metrics Cards:**
- Prominent numeric value (text-3xl)
- Label underneath (text-sm)
- Trend indicator with icon
- Compact layout in grid (grid-cols-2 md:grid-cols-4)

### Forms & Input
**Form Layout:**
- Vertical stacking with consistent spacing (space-y-6)
- Labels above inputs (font-medium, text-sm)
- Helper text below inputs (text-xs)
- Error states: red accent with icon
- Group related fields with subtle dividers

**Input Components:**
- Text inputs: Full-width, h-10, rounded-md border
- Textareas: Minimum h-24, auto-resize for content
- Select dropdowns: Match text input styling
- Checkboxes/Radio: Left-aligned with labels
- Multi-step forms: Progress indicator at top

### Content Generation Workflow
**Multi-Step Process:**
- Vertical stepper/progress bar (left or top)
- Step validation before proceeding
- Save draft functionality
- Step navigation: Next/Back buttons (bottom-right)
- Preview pane (right side for 2-column layouts)

**AI Generation Interface:**
- Prompt input: Large textarea with formatting toolbar
- Parameter controls: Grouped in collapsible sections
- Generate button: Primary CTA (prominent)
- Loading states: Skeleton screens + progress
- Generated output: Editable rich text area

### Modals & Overlays
**Modal Structure:**
- Backdrop with opacity-50
- Centered card with max-w-2xl
- Header with title + close button (X icon)
- Content area with scroll if needed
- Footer with Cancel/Confirm actions (right-aligned)

**Toast Notifications:**
- Top-right position
- Auto-dismiss (4-5 seconds)
- Success/Error/Info variants
- Icon + message + optional action

### Buttons & CTAs
**Button Hierarchy:**
- Primary: Solid background, font-medium
- Secondary: Border with transparent background
- Ghost: No border, hover background
- Sizes: h-8 (small), h-10 (default), h-12 (large)

**Icon Buttons:**
- Square aspect ratio
- Same heights as text buttons
- Tooltip on hover for context

## Page Layouts

### Dashboard/Home
- Sidebar + top bar layout
- Welcome section with user name + quick stats
- Recent activity feed
- Quick actions grid (Create Content, View Analytics, etc.)
- Content library preview (last 5-10 items)

### Content Library
- Filterable list/grid view toggle
- Search + filters in top bar
- Bulk actions toolbar (appears on selection)
- Content cards with thumbnail, title, metadata
- Status badges (Draft, Published, Scheduled)

### Content Creation/Editor
- Two-column layout (form left, preview right) on desktop
- Sticky save/publish toolbar (top)
- Collapsible sections for advanced options
- Real-time character/word count
- SEO score indicator

### Analytics Dashboard
- KPI cards grid at top (4 columns)
- Charts section (2-column grid for graphs)
- Data table for detailed metrics
- Date range selector (top-right)
- Export functionality

### Settings
- Tabbed navigation (left sidebar or top tabs)
- Form sections with clear headings
- Grouped related settings
- Save confirmation feedback

## Animations & Interactions
**Minimal, Purposeful Animations:**
- Page transitions: Subtle fade (150ms)
- Modal entry: Fade + scale from 95% (200ms)
- Loading states: Subtle pulse or skeleton
- Hover states: 150ms transition for backgrounds
- **No scroll-triggered animations or complex effects**

## Images & Visual Assets

**Icons:** Heroicons (outline for navigation, solid for actions)

**No Hero Images** - This is a productivity tool, not a marketing site

**Images Usage:**
- Empty states: Simple illustrations (200x200px)
- User avatars: Circular, 32px default, 40px in profile
- Content thumbnails: 16:9 aspect ratio in cards
- Logo: Top of sidebar (40px height)

**Placeholder Strategy:**
- Empty states with icon + text + CTA
- Skeleton loaders for content loading
- Default avatars with user initials

## Accessibility
- Semantic HTML throughout
- ARIA labels for icon-only buttons
- Keyboard navigation support
- Focus indicators (ring-2 ring-offset-2)
- Sufficient contrast ratios (WCAG AA minimum)
- Screen reader announcements for dynamic content