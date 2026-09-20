"use client";
import { apiFetch } from "@/lib/api-client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Plus,
  Search,
  ToggleLeft,
  Activity,
  Tag,
  ChevronRight,
  Layers,
  ArrowLeft,
  Hash,
  Info,
  Pencil,
  Trash2,
  MoreHorizontal,
  Copy,
  Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { SkeletonTable } from "@/components/ui/skeleton";
import { useTeamTier } from "@/hooks/use-team-tier";
import { SanitizedSvgIcon } from "@/components/dashboard/sanitized-svg-icon";

// ─── Types ────────────────────────────────────────────────────────────────────

type FeatureType = "boolean" | "event" | "trait";

interface Feature {
  id: string;
  name: string;
  featureKey: string;
  description: string | null;
  icon: string | null;
  featureType: FeatureType;
  eventKey: string | null;
  traitKey: string | null;
  linkedPlans: string[];
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FEATURE_TYPE_META: Record<
  FeatureType,
  { label: string; icon: LucideIcon; color: string; description: string }
> = {
  boolean: {
    label: "Boolean",
    icon: ToggleLeft,
    color: "text-foreground",
    description: "Simple on/off access — is this feature enabled for the user?",
  },
  event: {
    label: "Event-based",
    icon: Activity,
    color: "text-foreground",
    description:
      "Metered by event count — track usage and gate based on thresholds.",
  },
  trait: {
    label: "Trait-based",
    icon: Tag,
    color: "text-foreground",
    description:
      "Determined by a company or user trait value stored on their profile.",
  },
};

const DEFAULT_FEATURE_TYPE_META = FEATURE_TYPE_META.boolean;
const CREATEABLE_FEATURE_TYPES: FeatureType[] = ["boolean", "event"];
const FEATURED_ICON_NAMES = [
  "rocket",
  "sparkles",
  "brain",
  "bot",
  "shield-check",
  "gauge",
  "circle-dollar-sign",
  "wallet",
  "shopping-bag",
  "package",
  "gift",
  "megaphone",
  "message-square",
  "panel-left",
  "server-cog",
  "globe",
  "camera",
  "video",
  "search",
  "link-2",
  "layers",
  "zap",
  "diamond",
  "puzzle",
] as const;
const ALL_LUCIDE_ICON_NAMES = Object.keys(dynamicIconImports).sort();
const FEATURE_EMOJI_OPTIONS = [
  { value: "🚀", label: "Rocket", keywords: ["launch", "fast", "ship"] },
  { value: "⚡", label: "Lightning", keywords: ["speed", "power", "energy"] },
  { value: "🔒", label: "Lock", keywords: ["security", "private", "access"] },
  { value: "🔓", label: "Unlock", keywords: ["open", "access", "public"] },
  { value: "📊", label: "Bar chart", keywords: ["analytics", "metrics", "growth"] },
  { value: "📈", label: "Growth chart", keywords: ["revenue", "trend", "up"] },
  { value: "📉", label: "Decline chart", keywords: ["down", "drop", "trend"] },
  { value: "📦", label: "Package", keywords: ["bundle", "product", "module"] },
  { value: "🎁", label: "Gift", keywords: ["perk", "bonus", "promo"] },
  { value: "💎", label: "Diamond", keywords: ["premium", "pro", "vip"] },
  { value: "⭐", label: "Star", keywords: ["favorite", "featured", "quality"] },
  { value: "🌟", label: "Glow star", keywords: ["shine", "highlight", "magic"] },
  { value: "🔥", label: "Fire", keywords: ["hot", "popular", "trending"] },
  { value: "🧠", label: "Brain", keywords: ["ai", "smart", "intelligence"] },
  { value: "🤖", label: "Robot", keywords: ["bot", "agent", "automation"] },
  { value: "🎯", label: "Target", keywords: ["goal", "focus", "precision"] },
  { value: "🛡️", label: "Shield", keywords: ["protection", "security", "compliance"] },
  { value: "💬", label: "Speech", keywords: ["chat", "support", "message"] },
  { value: "📝", label: "Note", keywords: ["text", "docs", "editor"] },
  { value: "🔍", label: "Search", keywords: ["find", "query", "discover"] },
  { value: "🌐", label: "Globe", keywords: ["global", "web", "world"] },
  { value: "🔗", label: "Link", keywords: ["connect", "integration", "url"] },
  { value: "📱", label: "Phone", keywords: ["mobile", "app", "device"] },
  { value: "💼", label: "Briefcase", keywords: ["business", "work", "b2b"] },
  { value: "🏪", label: "Store", keywords: ["shop", "commerce", "retail"] },
  { value: "🛒", label: "Cart", keywords: ["checkout", "buy", "commerce"] },
  { value: "💳", label: "Card", keywords: ["payment", "billing", "charge"] },
  { value: "💰", label: "Money bag", keywords: ["revenue", "billing", "pricing"] },
  { value: "🏆", label: "Trophy", keywords: ["winner", "best", "achievement"] },
  { value: "🎮", label: "Controller", keywords: ["gaming", "play", "fun"] },
  { value: "🎵", label: "Music", keywords: ["audio", "media", "sound"] },
  { value: "🎬", label: "Clapper", keywords: ["video", "media", "streaming"] },
  { value: "📸", label: "Camera", keywords: ["photo", "capture", "media"] },
  { value: "🎨", label: "Palette", keywords: ["design", "creative", "style"] },
  { value: "🖼️", label: "Picture", keywords: ["image", "media", "gallery"] },
  { value: "🔮", label: "Crystal ball", keywords: ["predict", "future", "insight"] },
  { value: "🪄", label: "Magic wand", keywords: ["magic", "automation", "enhance"] },
  { value: "📡", label: "Satellite", keywords: ["signal", "network", "broadcast"] },
  { value: "📶", label: "Signal", keywords: ["wifi", "network", "connection"] },
  { value: "☁️", label: "Cloud", keywords: ["cloud", "storage", "sync"] },
  { value: "🔔", label: "Bell", keywords: ["notify", "alerts", "updates"] },
  { value: "📬", label: "Inbox", keywords: ["mail", "message", "email"] },
  { value: "👥", label: "Users", keywords: ["team", "people", "collaboration"] },
  { value: "🧩", label: "Puzzle", keywords: ["plugin", "integration", "extension"] },
  { value: "🏗️", label: "Construction", keywords: ["build", "infra", "setup"] },
  { value: "🔬", label: "Microscope", keywords: ["research", "lab", "analysis"] },
  { value: "🎓", label: "Graduation cap", keywords: ["education", "learn", "academy"] },
  { value: "📄", label: "Document", keywords: ["docs", "paper", "file"] },
  { value: "📁", label: "Folder", keywords: ["files", "storage", "organize"] },
  { value: "⚙️", label: "Gear", keywords: ["settings", "config", "admin"] },
  { value: "🔄", label: "Refresh", keywords: ["sync", "repeat", "update"] },
  { value: "✅", label: "Check", keywords: ["success", "approved", "done"] },
  { value: "❌", label: "Cross", keywords: ["disabled", "stop", "error"] },
  { value: "📍", label: "Pin", keywords: ["location", "marker", "place"] },
  { value: "🧪", label: "Test tube", keywords: ["experiments", "beta", "test"] },
  { value: "🛰️", label: "Satellite dish", keywords: ["broadcast", "remote", "signal"] },
  { value: "🪙", label: "Coin", keywords: ["pricing", "token", "payments"] },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toFeatureKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function getFeatureTypeMeta(featureType: string | null | undefined) {
  return FEATURE_TYPE_META[featureType as FeatureType] ?? DEFAULT_FEATURE_TYPE_META;
}

function toIconLabel(iconName: string) {
  return iconName
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toLucideIconToken(iconName: string) {
  return `lucide:${iconName}`;
}

function isLucideIconToken(icon: string | null | undefined) {
  return Boolean(icon?.startsWith("lucide:"));
}

function getLucideIconName(icon: string | null | undefined) {
  return isLucideIconToken(icon) ? icon!.slice("lucide:".length) : null;
}

function isSvgIcon(icon: string | null | undefined) {
  return Boolean(icon?.trim().startsWith("<svg"));
}

function isEmojiLikeIcon(icon: string | null | undefined) {
  return Boolean(icon && !isSvgIcon(icon) && !isLucideIconToken(icon));
}

function getFeatureIconSummary(
  icon: string | null | undefined,
  featureType: FeatureType,
) {
  const lucideIconName = getLucideIconName(icon);
  if (lucideIconName) {
    return {
      label: toIconLabel(lucideIconName),
      hint: "Icon library",
    };
  }

  if (isEmojiLikeIcon(icon)) {
    return {
      label: icon!,
      hint: icon!.length <= 3 ? "Emoji or custom glyph" : "Custom label",
    };
  }

  return {
    label: getFeatureTypeMeta(featureType).label,
    hint: "Default feature type icon",
  };
}

function DynamicLucidePreview({
  iconName,
  className,
}: {
  iconName: string;
  className?: string;
}) {
  const [IconComponent, setIconComponent] = useState<LucideIcon | null>(null);

  useEffect(() => {
    let active = true;
    const loader = dynamicIconImports[iconName as keyof typeof dynamicIconImports];

    if (!loader) {
      setIconComponent(null);
      return;
    }

    void loader().then((mod) => {
      if (active) setIconComponent(() => mod.default);
    });

    return () => {
      active = false;
    };
  }, [iconName]);

  if (!IconComponent) {
    return <div className={cn("h-5 w-5 rounded bg-muted/50 animate-pulse", className)} />;
  }

  return <IconComponent className={className} />;
}

function FeatureIconPicker({
  value,
  featureType,
  onChange,
}: {
  value: string;
  featureType: FeatureType;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"icons" | "emoji" | "custom">("icons");
  const [customGlyph, setCustomGlyph] = useState(
    isEmojiLikeIcon(value) ? value : "",
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setCustomGlyph(isEmojiLikeIcon(value) ? value : "");
      setActiveTab(isEmojiLikeIcon(value) ? "custom" : "icons");
    }
  }, [open, value]);

  const normalizedQuery = query.trim().toLowerCase();
  const selectedLucideIconName = getLucideIconName(value);
  const selectedSummary = getFeatureIconSummary(value, featureType);
  const visibleIconNames = (
    normalizedQuery.length > 0
      ? ALL_LUCIDE_ICON_NAMES.filter((iconName) =>
          `${iconName} ${toIconLabel(iconName)}`.toLowerCase().includes(normalizedQuery),
        )
      : [...FEATURED_ICON_NAMES]
  ).slice(0, 96);
  const visibleEmojis = FEATURE_EMOJI_OPTIONS.filter((emoji) =>
    normalizedQuery.length === 0
      ? true
      : `${emoji.label} ${emoji.keywords.join(" ")} ${emoji.value}`
          .toLowerCase()
          .includes(normalizedQuery),
  );
  const customPreview = customGlyph.trim();

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-xl border bg-secondary/30 shadow-sm transition-all hover:border-accent/40",
            open
              ? "border-accent ring-4 ring-accent/15"
              : "border-border",
          )}
          aria-label="Choose feature icon"
        >
          <FeatureAvatar
            featureType={featureType}
            icon={value || null}
            className="h-full w-full rounded-full border-0 bg-transparent"
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={12}
        className="w-[320px] rounded-2xl border-border bg-popover p-0 shadow-2xl"
      >
        <div className="space-y-3 p-3.5">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-secondary/20 px-3 py-2.5">
            <FeatureAvatar
              featureType={featureType}
              icon={value || null}
              className="h-10 w-10 rounded-xl"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {selectedSummary.label}
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedSummary.hint}
              </p>
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(nextValue) =>
              setActiveTab(nextValue as "icons" | "emoji" | "custom")
            }
            className="gap-4"
          >
            <div className="flex items-center justify-between gap-3">
              <TabsList className="grid w-full max-w-[240px] grid-cols-3">
                <TabsTrigger value="icons">Icons</TabsTrigger>
                <TabsTrigger value="emoji">Emoji</TabsTrigger>
                <TabsTrigger value="custom">Custom</TabsTrigger>
              </TabsList>
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Clear
              </button>
            </div>

            {activeTab !== "custom" && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    activeTab === "icons"
                      ? "Search icons or symbols..."
                      : "Search emojis..."
                  }
                  className="h-10 rounded-xl border-border bg-muted/30 pl-12 text-sm"
                />
              </div>
            )}

            <TabsContent value="icons" className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Icon Library
                </p>
                <p className="text-xs text-muted-foreground">
                  {normalizedQuery ? `${visibleIconNames.length} results` : "Featured picks"}
                </p>
              </div>
              <div className="max-h-[256px] overflow-y-auto pr-1">
                {visibleIconNames.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    No icons match that search.
                  </div>
                ) : (
                  <div className="grid grid-cols-6 gap-2">
                    {visibleIconNames.map((iconName) => {
                      const isSelected = selectedLucideIconName === iconName;
                      return (
                        <button
                          key={iconName}
                          type="button"
                          title={toIconLabel(iconName)}
                          onClick={() => {
                            onChange(toLucideIconToken(iconName));
                            setOpen(false);
                          }}
                          className={cn(
                            "flex h-12 w-12 items-center justify-center rounded-xl border bg-muted/30 text-muted-foreground transition-all hover:border-border hover:text-foreground",
                            isSelected
                              ? "border-accent bg-accent/10 text-foreground ring-2 ring-accent/15"
                              : "border-transparent",
                          )}
                          aria-pressed={isSelected}
                        >
                          <DynamicLucidePreview
                            iconName={iconName}
                            className="h-5 w-5"
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="emoji" className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Emoji Library
                </p>
                <p className="text-xs text-muted-foreground">
                  {visibleEmojis.length} options
                </p>
              </div>
              <div className="max-h-[256px] overflow-y-auto pr-1">
                {visibleEmojis.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    No emojis match that search.
                  </div>
                ) : (
                  <div className="grid grid-cols-6 gap-2">
                    {visibleEmojis.map((emoji) => {
                      const isSelected = value === emoji.value;
                      return (
                        <button
                          key={`${emoji.value}-${emoji.label}`}
                          type="button"
                          title={emoji.label}
                          onClick={() => {
                            onChange(emoji.value);
                            setOpen(false);
                          }}
                          className={cn(
                            "flex h-12 w-12 items-center justify-center rounded-xl border bg-muted/30 text-xl transition-all hover:border-border hover:bg-muted/60",
                            isSelected
                              ? "border-accent bg-accent/10 ring-2 ring-accent/15"
                              : "border-transparent",
                          )}
                          aria-pressed={isSelected}
                        >
                          {emoji.value}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="custom" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="custom-feature-glyph">Custom glyph</Label>
                <Input
                  id="custom-feature-glyph"
                  value={customGlyph}
                  onChange={(e) => setCustomGlyph(e.target.value)}
                  placeholder="Paste an emoji or short text"
                  className="h-12 rounded-xl border-border bg-muted/30 text-base"
                  maxLength={8}
                />
                <p className="text-xs text-muted-foreground">
                  Useful for emoji, initials, or a short custom marker.
                </p>
              </div>
              <div className="flex items-center gap-4 rounded-2xl border border-border bg-muted/20 p-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-background text-2xl">
                  {customPreview || "•"}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Preview
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Apply any emoji or short glyph that fits your theme.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                disabled={!customPreview}
                onClick={() => {
                  onChange(customPreview);
                  setOpen(false);
                }}
                className="w-full"
              >
                Use custom icon
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FeatureAvatar({
  featureType,
  icon,
  className,
}: {
  featureType: FeatureType;
  icon?: string | null;
  className?: string;
}) {
  const meta = getFeatureTypeMeta(featureType);
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        "rounded-xl flex items-center justify-center bg-secondary border border-border shrink-0",
        className,
      )}
    >
      {isSvgIcon(icon) ? (
        <SanitizedSvgIcon svg={icon ?? ""} className={meta.color} />
      ) : isLucideIconToken(icon) ? (
        <DynamicLucidePreview
          iconName={getLucideIconName(icon)!}
          className={cn("h-5 w-5", meta.color)}
        />
      ) : isEmojiLikeIcon(icon) ? (
        <span className="text-[1.35rem] leading-none">{icon}</span>
      ) : (
        <Icon className={cn("w-5 h-5", meta.color)} />
      )}
    </div>
  );
}

// ─── Feature Detail View ─────────────────────────────────────────────────────

function FeatureDetailView({
  feature,
  onBack,
  onDelete,
  onUpdate,
}: {
  feature: Feature;
  onBack: () => void;
  onDelete: (id: string) => void;
  onUpdate: (feature: Feature) => void;
}) {
  const meta = getFeatureTypeMeta(feature.featureType);
  const Icon = meta.icon;
  const [copied, setCopied] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const copyKey = () => {
    void navigator.clipboard.writeText(feature.featureKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Features
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowEdit(true)}>
              <Pencil className="w-3.5 h-3.5 mr-2" />
              Edit Feature
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                onDelete(feature.id);
                onBack();
              }}
            >
              <Trash2 className="w-3.5 h-3.5 mr-2" />
              Delete Feature
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Header */}
      <div className="flex items-start gap-4">
        <FeatureAvatar
          featureType={feature.featureType}
          icon={feature.icon}
          className="w-12 h-12"
        />
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold text-foreground">
            {feature.name}
          </h2>
          {feature.description && (
            <p className="text-sm text-muted-foreground mt-1">
              {feature.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge
              variant="secondary"
              className={cn("text-xs gap-1", meta.color)}
            >
              <Icon className="w-3 h-3" />
              {meta.label}
            </Badge>
            <button
              onClick={copyKey}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-secondary border border-border text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              <Hash className="w-3 h-3" />
              {feature.featureKey}
              {copied ? (
                <Check className="w-3 h-3 text-success" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Type
          </p>
          <p className="text-sm font-medium text-foreground">{meta.label}</p>
          <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
        </div>

        {feature.featureType === "event" && feature.eventKey && (
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Event Key
            </p>
            <code className="text-sm font-mono text-foreground">
              {feature.eventKey}
            </code>
            <p className="text-xs text-muted-foreground mt-1">
              Tracked via <code className="font-mono">POST /api/v1/events</code>
            </p>
          </div>
        )}

        {feature.featureType === "trait" && feature.traitKey && (
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Trait Key
            </p>
            <code className="text-sm font-mono text-foreground">
              {feature.traitKey}
            </code>
            <p className="text-xs text-muted-foreground mt-1">
              Read from company or user traits
            </p>
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Linked Plans
          </p>
          {feature.linkedPlans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plans linked yet</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {feature.linkedPlans.map((plan) => (
                <Badge key={plan} variant="outline" className="text-xs">
                  <Layers className="w-3 h-3 mr-1" />
                  {plan}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Created
          </p>
          <p className="text-sm text-foreground">
            {new Date(feature.createdAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/5 border border-accent/20">
        <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">
            Plan entitlements are managed in Plan Catalog
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Linked plans shown here are read-only. Add or update access for{" "}
            <code className="font-mono">{feature.featureKey}</code> from{" "}
            <strong>Plan Catalog</strong>, then use <strong>Flags</strong> only
            for non-plan targeting like usage, traits, and overrides.
          </p>
        </div>
      </div>

      <EditFeatureSheet
        feature={feature}
        open={showEdit}
        onOpenChange={setShowEdit}
        onUpdated={onUpdate}
      />
    </div>
  );
}

// ─── Create Feature Sheet ────────────────────────────────────────────────────

function CreateFeatureSheet({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (f: Feature) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    featureKey: "",
    description: "",
    icon: "",
    featureType: "boolean" as FeatureType,
    eventKey: "",
    traitKey: "",
    keyManuallyEdited: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Auto-generate key from name unless user has manually edited it
  useEffect(() => {
    if (!form.keyManuallyEdited) {
      setForm((p) => ({ ...p, featureKey: toFeatureKey(p.name) }));
    }
  }, [form.name, form.keyManuallyEdited]);

  const reset = () => {
    setForm({
      name: "",
      featureKey: "",
      description: "",
      icon: "",
      featureType: "boolean",
      eventKey: "",
      traitKey: "",
      keyManuallyEdited: false,
    });
    setError("");
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError("Feature name is required");
      return;
    }
    if (!form.featureKey.trim() || !/^[a-z0-9_]+$/.test(form.featureKey)) {
      setError("Feature key must be lowercase alphanumeric with underscores only");
      return;
    }
    if (form.featureType === "event" && !form.eventKey.trim()) {
      setError("Event key is required for event-based features");
      return;
    }
    if (form.featureType === "trait" && !form.traitKey.trim()) {
      setError("Trait key is required for trait-based features");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await apiFetch("/api/v1/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          featureKey: form.featureKey,
          description: form.description || null,
          icon: form.icon || null,
          featureType: form.featureType,
          eventKey: form.featureType === "event" ? form.eventKey : null,
          traitKey: form.featureType === "trait" ? form.traitKey : null,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { feature: Feature };
        onCreate(data.feature);
        toast.success(`Feature "${form.name}" created`);
        reset();
        onOpenChange(false);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not create feature");
      }
    } catch {
      setError("Network error — feature was not created");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <SheetContent className="w-full sm:max-w-[560px] flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 py-4 border-b border-border">
          <SheetTitle>New feature</SheetTitle>
          <SheetDescription>
            Unlock plan entitlements, company overrides, and track feature utilization.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <FeatureIconPicker
                value={form.icon}
                featureType={form.featureType}
                onChange={(value) => setForm((p) => ({ ...p, icon: value }))}
              />
              <Input
                id="feat-name"
                placeholder="Enter name"
                value={form.name}
                onChange={(e) =>
                  setForm((p) => ({ ...p, name: e.target.value }))
                }
                className="h-12 flex-1 rounded-xl border-border bg-secondary/30 text-base"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Pick an icon, emoji, or custom glyph and give the feature a clear name.
            </p>
          </div>

          {/* Feature type selector */}
          <div className="space-y-2">
            <Label>How do you want to control access to this feature?</Label>
            <div className="grid gap-3 md:grid-cols-2">
              {CREATEABLE_FEATURE_TYPES.map(
                (type) => {
                  const typeMeta = FEATURE_TYPE_META[type];
                  const TypeIcon = typeMeta.icon;
                  const isSelected = form.featureType === type;
                  return (
                    <button
                      key={type}
                      onClick={() =>
                        setForm((p) => ({
                          ...p,
                          featureType: type,
                          eventKey: "",
                          traitKey: "",
                        }))
                      }
                      className={cn(
                        "flex min-h-20 flex-col items-start gap-2 rounded-2xl border p-3.5 text-left transition-all duration-150",
                        isSelected
                          ? "border-accent/50 bg-accent/5 text-foreground"
                          : "border-border bg-secondary/20 text-muted-foreground hover:border-border/80 hover:text-foreground",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-xl border border-border bg-background p-2.5">
                          <TypeIcon
                            className={cn(
                              "w-5 h-5",
                              isSelected ? typeMeta.color : "",
                            )}
                          />
                        </div>
                        <span className="text-sm font-semibold text-foreground">
                          {typeMeta.label}
                        </span>
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {typeMeta.description}
                      </p>
                    </button>
                  );
                },
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Trait-based targeting is available in Flags, but persisted feature shortcuts currently support boolean and event-based features only.
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="feat-desc">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="feat-desc"
              placeholder="Enter description"
              value={form.description}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              className="min-h-[84px] rounded-xl border-border bg-secondary/30 resize-none text-sm"
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Optional. What does this feature do for the user?
            </p>
          </div>

          {/* Feature key */}
          <div className="space-y-2">
            <Label htmlFor="feat-key">
              Flag key <span className="text-muted-foreground font-normal text-xs">(used in SDK + rules)</span>
            </Label>
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                id="feat-key"
                placeholder="ai_summary"
                value={form.featureKey}
                onChange={(e) => {
                  const val = e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, "");
                  setForm((p) => ({
                    ...p,
                    featureKey: val,
                    keyManuallyEdited: true,
                  }));
                }}
                className="h-12 rounded-xl border-border bg-secondary/30 pl-8 font-mono text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Keys are lowercase and auto-generated from the feature name.
            </p>
          </div>

          {/* Event key (event-based only) */}
          {form.featureType === "event" && (
            <div className="space-y-2">
              <Label htmlFor="feat-event-key">
                Event key <span className="text-muted-foreground font-normal text-xs">(tracked event name)</span>
              </Label>
              <div className="relative">
                <Activity className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  id="feat-event-key"
                  placeholder="e.g. scan"
                  value={form.eventKey}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      eventKey: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "_"),
                    }))
                  }
                  className="h-12 rounded-xl border-border bg-secondary/30 pl-8 font-mono text-sm"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The event name sent to{" "}
                <code className="font-mono">POST /api/v1/events</code>
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <SheetFooter className="px-5 py-3.5 border-t border-border flex-row justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => { reset(); onOpenChange(false); }}
            className="min-w-28"
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="min-w-32">
            <Plus className="w-4 h-4 mr-1.5" />
            Create
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function EditFeatureSheet({
  feature,
  open,
  onOpenChange,
  onUpdated,
}: {
  feature: Feature;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUpdated: (feature: Feature) => void;
}) {
  const [form, setForm] = useState<{
    name: string;
    description: string;
    icon: string;
    featureType: "boolean" | "event";
    eventKey: string;
  }>({
    name: feature.name,
    description: feature.description ?? "",
    icon: feature.icon ?? "",
    featureType: feature.featureType === "event" ? "event" : "boolean",
    eventKey: feature.eventKey ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm({
      name: feature.name,
      description: feature.description ?? "",
      icon: feature.icon ?? "",
      featureType: feature.featureType === "event" ? "event" : "boolean",
      eventKey: feature.eventKey ?? "",
    });
    setError("");
  }, [feature, open]);

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError("Feature name is required");
      return;
    }
    if (form.featureType === "event" && !form.eventKey.trim()) {
      setError("Event key is required for event-based features");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await apiFetch(`/api/v1/features/${feature.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          icon: form.icon || null,
          featureType: form.featureType,
          eventKey: form.featureType === "event" ? form.eventKey : null,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { feature: Feature };
        onUpdated({
          ...data.feature,
          linkedPlans: feature.linkedPlans,
        });
        toast.success(`Feature "${form.name}" updated`);
        onOpenChange(false);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not update feature");
      }
    } catch {
      setError("Network error — feature was not updated");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[560px] flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 py-4 border-b border-border">
          <SheetTitle>Edit feature</SheetTitle>
          <SheetDescription>
            Update this feature without changing its plan entitlements
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <FeatureIconPicker
                value={form.icon}
                featureType={form.featureType}
                onChange={(value) => setForm((p) => ({ ...p, icon: value }))}
              />
              <Input
                id="edit-feat-name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="h-12 flex-1 rounded-xl border-border bg-secondary/30"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Update the feature name and keep the icon aligned with how this feature is presented.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Access control</Label>
            <div className="grid gap-3 md:grid-cols-2">
              {(["boolean", "event"] as const).map((type) => {
                const typeMeta = FEATURE_TYPE_META[type];
                const TypeIcon = typeMeta.icon;
                const isSelected = form.featureType === type;
                return (
                  <button
                    key={type}
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        featureType: type,
                        eventKey: type === "event" ? p.eventKey : "",
                      }))
                    }
                    className={cn(
                        "flex min-h-20 flex-col items-start gap-2 rounded-2xl border p-3.5 text-left transition-all duration-150",
                      isSelected
                        ? "border-accent/50 bg-accent/5 text-foreground"
                        : "border-border bg-secondary/20 text-muted-foreground hover:border-border/80 hover:text-foreground",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl border border-border bg-background p-2.5">
                        <TypeIcon className={cn("w-5 h-5", isSelected ? typeMeta.color : "")} />
                      </div>
                      <span className="text-sm font-semibold text-foreground">
                        {typeMeta.label}
                      </span>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {typeMeta.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-feat-desc">Description</Label>
            <Textarea
              id="edit-feat-desc"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              className="min-h-[84px] rounded-xl border-border bg-secondary/30 resize-none text-sm"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Feature key</Label>
            <Input value={feature.featureKey} disabled className="h-12 rounded-xl border-border bg-secondary/30 font-mono" />
            <p className="text-xs text-muted-foreground">
              Feature keys stay stable because flags, SDK checks, and entitlements depend on them.
            </p>
          </div>

          {form.featureType === "event" && (
            <div className="space-y-2">
              <Label htmlFor="edit-feat-event-key">Event key</Label>
              <Input
                id="edit-feat-event-key"
                value={form.eventKey}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    eventKey: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                  }))
                }
                className="h-12 rounded-xl border-border bg-secondary/30 font-mono"
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <SheetFooter className="px-5 py-3.5 border-t border-border flex-row justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="min-w-28">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="min-w-32">
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main FeaturesSection ─────────────────────────────────────────────────────

export function FeaturesSection() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FeatureType | "all">("all");
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const { currentTier } = useTeamTier();

  const flagsLimitReached = currentTier && features.length >= currentTier.limits.maxFeatureFlags;
  const canCreateFlags = currentTier && !flagsLimitReached;

  const fetchFeatures = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/v1/features");
      if (res.ok) {
        const data = (await res.json()) as { features: Feature[] };
        setFeatures(data.features ?? []);
      } else {
        setFeatures([]);
        toast.error("Could not load features");
      }
    } catch {
      setFeatures([]);
      toast.error("Could not load features");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFeatures();
  }, [fetchFeatures]);

  const handleDelete = async (id: string) => {
    try {
      const res = await apiFetch(`/api/v1/features/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not delete feature");
      }
      setFeatures((prev) => prev.filter((f) => f.id !== id));
      toast.success("Feature deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete feature");
    }
  };

  const filtered = features.filter((f) => {
    const matchSearch =
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.featureKey.toLowerCase().includes(searchQuery.toLowerCase());
    const matchType = typeFilter === "all" || f.featureType === typeFilter;
    return matchSearch && matchType;
  });

  // ── Detail view ────────────────────────────────────────────────────────────
  if (selectedFeature) {
    return (
      <FeatureDetailView
        feature={selectedFeature}
        onBack={() => setSelectedFeature(null)}
        onDelete={handleDelete}
        onUpdate={(updatedFeature) => {
          setFeatures((prev) =>
            prev.map((feature) =>
              feature.id === updatedFeature.id ? updatedFeature : feature,
            ),
          );
          setSelectedFeature(updatedFeature);
        }}
      />
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Define the capabilities your product offers — Boolean, Event-based, or Trait-based.
          </p>
        </div>
        {canCreateFlags ? (
          <Button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Create feature
          </Button>
        ) : (
            <div className="text-xs text-muted-foreground px-3 py-2 rounded-lg border border-border bg-muted/30">
              {flagsLimitReached
                ? `Feature flag limit reached (${currentTier?.limits.maxFeatureFlags}). Upgrade for more.`
                : "Loading tier info..."}
            </div>
          )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search features…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-56 h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
          />
        </div>
        <div className="flex items-center gap-2">
          {(["all", "boolean", "event", "trait"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 capitalize",
                typeFilter === t
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "all"
                ? "All"
                : t === "event"
                  ? "Event-based"
                  : t === "trait"
                    ? "Trait-based"
                    : "Boolean"}
            </button>
          ))}
        </div>
      </div>

      {/* Feature list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Feature
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Type
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                  Linked Plans
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                  Created
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {loading && <SkeletonTable rows={4} cols={5} />}

              {!loading &&
                filtered.map((feature, index) => {
                  const meta = getFeatureTypeMeta(feature.featureType);
                  const Icon = meta.icon;
                  return (
                    <tr
                      key={feature.id}
                      className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors cursor-pointer animate-in fade-in slide-in-from-left-2"
                      style={{
                        animationDelay: `${index * 40}ms`,
                        animationFillMode: "both",
                      }}
                      onClick={() => setSelectedFeature(feature)}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <FeatureAvatar
                            featureType={feature.featureType}
                            icon={feature.icon}
                            className="w-8 h-8 rounded-lg"
                          />
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {feature.name}
                            </p>
                            <code className="text-xs text-muted-foreground font-mono">
                              {feature.featureKey}
                            </code>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant="secondary"
                          className={cn("text-xs gap-1", meta.color)}
                        >
                          <Icon className="w-3 h-3" />
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 hidden sm:table-cell">
                        {feature.linkedPlans.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {feature.linkedPlans.slice(0, 2).map((plan) => (
                              <Badge
                                key={plan}
                                variant="outline"
                                className="text-xs"
                              >
                                {plan}
                              </Badge>
                            ))}
                            {feature.linkedPlans.length > 2 && (
                              <Badge variant="outline" className="text-xs">
                                +{feature.linkedPlans.length - 2}
                              </Badge>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <span className="text-xs text-muted-foreground">
                          {new Date(feature.createdAt).toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric", year: "numeric" },
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
              <ToggleLeft className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              {searchQuery || typeFilter !== "all"
                ? "No features match your filter"
                : "No features defined yet"}
            </p>
            <p className="text-xs text-muted-foreground max-w-[300px] mb-4">
              Features define the capabilities your product offers. Create your first feature to get started.
            </p>
            {!searchQuery && typeFilter === "all" && (
              <Button onClick={() => setShowCreate(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Create your first feature
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/30">
          <span className="text-sm text-muted-foreground">
            {filtered.length} feature{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Create sheet */}
      <CreateFeatureSheet
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreate={(f) => setFeatures((prev) => [f, ...prev])}
      />
    </div>
  );
}
