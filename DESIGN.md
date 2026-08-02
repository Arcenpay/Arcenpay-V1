# ArcenPay — Dashboard Design System

Complete design token reference for the ArcenPay provider dashboard (`apps/arcen-dashboard`).

> Last updated: 2026-08-02

---

## 1. Tech Stack

| Layer | Technology |
|-------|-----------|
| Component library | **shadcn/ui** (new-york style variant) |
| CSS framework | **Tailwind CSS 4.1.9** |
| Theme provider | `next-themes` v0.4.6 |
| Icons | **Lucide React** v0.454.0 |
| Variants | `class-variance-authority` v0.7.1 |
| Animation | `tw-animate-css` v1.3.3 + `tailwindcss-animate` v1.0.7 |
| Utilities | `clsx` v2.1.1 + `tailwind-merge` v3.3.1 |
| Charts | `recharts` v2.15.4 |
| 3D effects | `@react-three/fiber` v9.6.1 + `three.js` v0.185.1 |

### shadcn/ui Config (`components.json`)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "tailwind": {
    "baseColor": "neutral",
    "cssVariables": true
  }
}
```

Theme file: `app/globals.css` — CSS-first configuration via Tailwind v4 `@theme` directive.

---

## 2. Color Palette

### Light Mode (`:root`)

| Token | Hex | Usage |
|-------|-----|-------|
| `--background` | `#fafafa` | Page background |
| `--foreground` | `#0a0a0a` | Primary text |
| `--card` | `#ffffff` | Card/elevated surfaces |
| `--card-foreground` | `#0a0a0a` | Text on cards |
| `--popover` | `#ffffff` | Popover backgrounds |
| `--popover-foreground` | `#0a0a0a` | Popover text |
| `--primary` | `#0a0a0a` | Primary actions, brand |
| `--primary-foreground` | `#ffffff` | Text on primary |
| `--secondary` | `#f4f4f5` | Secondary surfaces |
| `--secondary-foreground` | `#18181b` | Text on secondary |
| `--muted` | `#f4f4f5` | Muted backgrounds |
| `--muted-foreground` | `#71717a` | Muted text |
| `--accent` | `#f4f4f5` | Accent backgrounds |
| `--accent-foreground` | `#18181b` | Text on accent |
| `--destructive` | `#ef4444` | Danger/destructive |
| `--destructive-foreground` | `#ffffff` | Text on destructive |
| `--border` | `#e4e4e7` | Borders |
| `--input` | `#f4f4f5` | Input backgrounds |
| `--ring` | `#0a0a0a` | Focus ring |
| `--surface` | `#f4f4f5` | Base surface layer |
| `--surface-raised` | `#e4e4e7` | Raised surface |
| `--elevated` | `#ffffff` | Elevated layer |
| `--elevated-hover` | `#f4f4f5` | Elevated hover |
| `--brand` | `var(--primary)` | Brand alias |
| `--brand-dark` | `var(--primary)` | Dark brand alias |
| `--success` | `var(--primary)` | Success/positive |
| `--warning` | `#f59e0b` | Warning (amber-500) |

### Sidebar Colors (Light)

| Token | Hex |
|-------|-----|
| `--sidebar` | `#ffffff` |
| `--sidebar-foreground` | `#0a0a0a` |
| `--sidebar-primary` | `#0a0a0a` |
| `--sidebar-primary-foreground` | `#ffffff` |
| `--sidebar-accent` | `#f4f4f5` |
| `--sidebar-accent-foreground` | `#18181b` |
| `--sidebar-border` | `#e4e4e7` |
| `--sidebar-ring` | `#0a0a0a` |
| `--sidebar-active` | `rgba(0,0,0,0.06)` |
| `--sidebar-hover` | `rgba(0,0,0,0.03)` |

### Chart Colors (Light)

| Token | Hex |
|-------|-----|
| `--chart-1` | `#0a0a0a` |
| `--chart-2` | `#666666` |
| `--chart-3` | `#a0a0a0` |
| `--chart-4` | `#cccccc` |
| `--chart-5` | `#eeeeee` |

### Dark Mode (`.dark`)

Dark mode inverts the palette: near-black background (`#0a0a0a`), white foreground (`#ffffff`), subtler borders (`#1f1f1f`). Same destructive (`#ef4444`) and warning (`#f59e0b`) colors as light mode.

---

## 3. Typography

### Font Stacks

| Token | Value |
|-------|-------|
| `--font-sans` | `"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` |
| `--font-mono` | `"SF Mono", "SF Pro Mono", "JetBrains Mono", "Fira Code", "Menlo", monospace` |
| `--font-display` | `"SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif` |

System fonts only — no `next/font` downloads. Apple devices get SF Pro, others fall back to system defaults.

### Base Layer

```css
@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground; }
  body { font-feature-settings: "rlig" 1, "calt" 1; }  /* ligatures */
  ::selection { background: color-mix(in srgb, var(--muted-foreground) 15%, transparent); }
}
```

---

## 4. Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | shadcn default | Base radius |
| `--radius-sm` | `radius - 4px` | Checkboxes, small pills |
| `--radius-md` | `radius - 2px` | Inputs, buttons |
| `--radius-lg` | `radius` | Cards, dialogs |
| `--radius-xl` | `radius + 4px` | Extra large |

Component defaults: buttons `rounded-md`, cards `rounded-xl`, inputs `rounded-md`, dialogs `rounded-lg`, tooltips `rounded-md`.

---

## 5. Layout Structure

```
<html lang="en" class="dark|light">
  <body class="font-sans antialiased">
    ThemeProvider (storageKey="arcenpay-theme")
      Web3Provider
        <div class="flex min-h-screen bg-background">
          <Sidebar />                    ← fixed, w-[260px] desktop
          <div class="flex-1 flex flex-col min-w-0 lg:ml-[260px]">
            <Header />                   ← h-14, sticky, z-30, border-b
            <main class="flex-1 p-3 sm:p-4 lg:p-6">
              {content}                  ← animate-in fade-in
            </main>
          </div>
        </div>
```

| Element | Desktop | Mobile |
|---------|---------|--------|
| Sidebar | `260px`, fixed | `min(280px, 85vw)`, slide drawer |
| Header | `h-14`, sticky | same |
| Content padding | `p-6` | `p-3` |
| Page transitions | `animate-in fade-in slide-in-from-bottom-4 duration-500` |

---

## 6. Component Tokens

### Buttons

```
base: inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium
variants: default, destructive, outline, secondary, ghost, link
sizes: default(h-9 px-4), sm(h-8 px-3), lg(h-10 px-6), icon(size-9), icon-sm(size-8)
focus: focus-visible:ring-[3px] focus-visible:ring-ring
disabled: opacity-50
default shadow: shadow-xs
```

### Inputs

```
h-9 w-full rounded-md border bg-transparent px-3 py-1 text-base md:text-sm
focus: ring-[3px]
selection: bg-primary text-primary-foreground
```

### Cards

```
bg-card text-card-foreground rounded-xl border py-6 shadow-sm
content: px-6, gap-6
title: leading-none font-semibold
description: text-muted-foreground text-sm
```

### Dialog/Modal

```
overlay: fixed inset-0 bg-black/50, fade-in
content: rounded-lg border p-6 shadow-lg, centered, zoom-in-95
```

### Sidebar Navigation

```
active item: bg-[var(--sidebar-active)] text-sidebar-foreground
inactive: text-sidebar-foreground/50
hover: text-sidebar-foreground/80 bg-[var(--sidebar-hover)]
transition: all duration-150
group padding: px-3 py-2, text-[13px]
sub-item indent: pl-[28px], vertical line at left-[19px] (2px, sidebar-border/70)
```

### Tabs

```
list: bg-muted text-muted-foreground inline-flex h-9 rounded-lg p-[3px] gap-1.5
active trigger: bg-background shadow-sm
```

### Tooltips

```
bg-foreground text-background rounded-md px-3 py-1.5 text-xs
arrow: bg-foreground size-2.5 rotate-45 rounded-[2px]
```

### Dropdown Menu Items

```
rounded-sm px-2 py-1.5 text-sm gap-2
focus: bg-accent text-accent-foreground
```

---

## 7. Theme Toggle (Sidebar)

```
container: rounded-lg border border-sidebar-border/50 p-1
active segment: bg-[var(--sidebar-active)] text-sidebar-foreground
inactive: text-sidebar-foreground/40
icons: w-3.5 h-3.5, strokeWidth=1.5 (Sun, Moon, Monitor)
transition: all duration-200
```

Theme config: `next-themes` with `storageKey="arcenpay-theme"`, `attribute="class"`, `defaultTheme="system"`. Inline FOUC-prevention script in `<head>`.

---

## 8. Logo & Branding

| Property | Value |
|----------|-------|
| File | `public/arcenpay-logo.png` (+ `.avif`) |
| Dimensions | `width={140} height={36}` rendered at `h-7 w-auto` |
| Light mode | As-is (black logo on white) |
| Dark mode | `dark:brightness-0 dark:invert` (white on dark) |
| Optimization | `unoptimized` (PNG transparency) |
| Location | Sidebar header (desktop + mobile) |

---

## 9. Custom Utilities

```css
/* Card hover effect */
.card-lift {
  transition: border-color 0.2s ease;
  &:hover { border-color: #333333; }
}

/* Active nav indicator (left bar) */
.active-indicator {
  &::before {
    content: "";
    width: 2px; height: 16px;
    background: white;
    border-radius: 0 2px 2px 0;
  }
}

/* Scrollbar */
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--muted-foreground) 40%, transparent);
  border-radius: 3px;
}

/* Font display utility */
.font-display { font-family: var(--font-display); }
```

---

## 10. Key shadcn/ui Components in Use

Accordion, Alert Dialog, Avatar, Badge, Breadcrumb, Button, Card, Checkbox, Collapsible, Command, Context Menu, Dialog, Dropdown Menu, Form, Hover Card, Input, Label, Navigation Menu, Popover, Progress, Radio Group, Scroll Area, Select, Separator, Sheet, Sidebar, Skeleton, Slider, Switch, Table, Tabs, Textarea, Toast (Sonner), Toggle, Tooltip

All at `apps/arcen-dashboard/components/ui/`.
