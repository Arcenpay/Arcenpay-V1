"use client";
import { apiFetch } from "@/lib/api-client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FilePen,
  Plus,
  Trash2,
  Copy,
  CheckCircle2,
  Upload,
  ArrowLeft,
  Save,
  Eye,
  Crown,
  Rocket,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

/* ── Types (mirrors backend invoice-builder schema) ───────────────────────── */

type SectionType =
  | "header"
  | "metadata"
  | "addresses"
  | "itemsTable"
  | "totals"
  | "footer";

type Section = { type: SectionType; visible: boolean } & Record<string, unknown>;

type TemplateConfig = {
  schemaVersion: 1;
  meta: { name: string; description?: string };
  style: {
    primaryColor: string;
    accentColor: string;
    mutedColor: string;
    borderColor: string;
    backgroundColor: string;
    fontFamily: "helvetica" | "courier";
    baseFontSize: number;
    logoMaxHeight: number;
    pageOrientation: "portrait" | "landscape";
  };
  sections: Section[];
  watermark: { onPaid: string | null; onOverdue: string | null };
};

type TemplateMeta = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isProtected?: boolean;
  environmentId: string | null;
  createdAt: string;
  updatedAt: string;
};

type EditorState = {
  id: string | null;
  name: string;
  description: string;
  config: TemplateConfig;
};

/* ── Config helpers ───────────────────────────────────────────────────────── */

function cloneConfig(config: TemplateConfig): TemplateConfig {
  return JSON.parse(JSON.stringify(config)) as TemplateConfig;
}

function updateSection(config: TemplateConfig, type: SectionType, patch: Record<string, unknown>): TemplateConfig {
  const next = cloneConfig(config);
  next.sections = next.sections.map((section) =>
    section.type === type ? { ...section, ...patch } : section,
  );
  return next;
}

function toggleSection(config: TemplateConfig, type: SectionType): TemplateConfig {
  const section = config.sections.find((item) => item.type === type);
  return updateSection(config, type, { visible: !section?.visible });
}

function getSection(config: TemplateConfig, type: SectionType): Section | undefined {
  return config.sections.find((item) => item.type === type);
}

const SECTION_LABELS: Record<SectionType, string> = {
  header: "Header (title + logo)",
  metadata: "Invoice metadata",
  addresses: "From & Bill to",
  itemsTable: "Line items table",
  totals: "Totals block",
  footer: "Footer",
};

const SECTION_DESCRIPTIONS: Record<SectionType, string> = {
  header: "Document title, provider name and optional logo.",
  metadata: "Invoice/receipt numbers and issue/due/paid dates.",
  addresses: "Provider and customer address blocks.",
  itemsTable: "Descriptions, quantities, unit prices and amounts.",
  totals: "Subtotal, tax, total and amount due/paid.",
  footer: "Payment method, support details and a custom note.",
};

function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delay: number,
): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: TArgs) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
/* ── Main section ──────────────────────────────────────────────────────────── */

export function InvoiceBuilderSection() {
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [builderAvailable, setBuilderAvailable] = useState(true);
  const [upgradeRequired, setUpgradeRequired] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await apiFetch("/api/v1/invoices/templates");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed to load templates (${res.status})`);
      setTemplates(body.data ?? []);
      setBuilderAvailable(body.builderAvailable !== false);
      setUpgradeRequired(body.upgradeRequired ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const startFromDefault = async () => {
    try {
      const res = await apiFetch("/api/v1/invoices/templates/default-config");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load default config");
      const config = body.data as TemplateConfig;
      setEditor({
        id: null,
        name: `${config.meta.name} (custom)`,
        description: "Custom invoice design",
        config,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load default config");
    }
  };

  const openTemplate = async (template: TemplateMeta) => {
    try {
      const res = await apiFetch(`/api/v1/invoices/templates/${template.id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load template");
      setEditor({
        id: template.id,
        name: body.data.name,
        description: body.data.description ?? "",
        config: body.data.config as TemplateConfig,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load template");
    }
  };

  const activate = async (template: TemplateMeta) => {
    setBusyId(template.id);
    try {
      const res = await apiFetch(`/api/v1/invoices/templates/${template.id}/activate`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to activate template");
      toast.success(`"${template.name}" is now active`);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to activate template");
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = async (template: TemplateMeta) => {
    setBusyId(template.id);
    try {
      const res = await apiFetch(`/api/v1/invoices/templates/${template.id}/duplicate`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to duplicate template");
      toast.success("Template duplicated");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to duplicate template");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (template: TemplateMeta) => {
    setBusyId(template.id);
    try {
      const res = await apiFetch(`/api/v1/invoices/templates/${template.id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to delete template");
      toast.success("Template deleted");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete template");
    } finally {
      setBusyId(null);
    }
  };

  if (editor) {
    return (
      <InvoiceBuilderEditor
        initial={editor}
        onBack={() => setEditor(null)}
        onSaved={() => reload()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FilePen className="h-5 w-5 text-primary" />
              Invoice Builder
            </CardTitle>
            <CardDescription className="mt-1.5">
              Design the invoices, receipts and emails your customers receive —
              logo, colors, fonts, watermark, layout and branding.
            </CardDescription>
          </div>
          <Button onClick={startFromDefault} disabled={!builderAvailable} className="shrink-0">
            <Plus className="h-4 w-4 mr-1.5" />
            New template
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!builderAvailable && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex items-start gap-3 p-4">
                <Crown className="h-5 w-5 text-amber-500/80 mt-0.5" />
                <div className="text-sm space-y-1">
                  <div className="font-semibold">
                    Custom invoice design is available on {upgradeRequired ?? "Plus"} and above
                  </div>
                  <p className="text-muted-foreground">
                    Upgrade to unlock the invoice builder, remove the ArcenPay badge from your
                    embedded billing page, and design invoices with your own logo and brand colors.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : templates.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No invoice templates yet. Start from the classic layout to customize your
              invoice design.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.map((template) => (
                <Card key={template.id} className="border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{template.name}</span>
                          {template.isActive && (
                            <Badge className="border-border bg-secondary text-success">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          )}
                          {template.isProtected && (
                            <Badge variant="outline" className="text-[11px] border-border text-muted-foreground">
                              Default
                            </Badge>
                          )}
                        </div>
                        {template.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {template.description}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground/70 mt-2">
                          Updated {new Date(template.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => openTemplate(template)}>
                        Edit
                      </Button>
                      {!template.isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === template.id}
                          onClick={() => activate(template)}
                        >
                          Activate
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === template.id}
                        onClick={() => duplicate(template)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      {!template.isProtected && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={busyId === template.id}
                          onClick={() => remove(template)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Editor ────────────────────────────────────────────────────────────────── */

const COLOR_FIELDS: Array<{ key: keyof TemplateConfig["style"]; label: string }> = [
  { key: "primaryColor", label: "Primary (headings)" },
  { key: "accentColor", label: "Accent (rules/watermark)" },
  { key: "mutedColor", label: "Muted (labels)" },
  { key: "borderColor", label: "Border (rules)" },
  { key: "backgroundColor", label: "Background" },
];

function InvoiceBuilderEditor({
  initial,
  onBack,
  onSaved,
}: {
  initial: EditorState;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [config, setConfig] = useState<TemplateConfig>(() => cloneConfig(initial.config));
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"invoice" | "receipt">("invoice");
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewObjectUrls = useRef<string | null>(null);

  const configRef = useRef(config);
  configRef.current = config;
  const previewKindRef = useRef(previewKind);
  previewKindRef.current = previewKind;

  const runPreview = useCallback(async () => {
    const current = configRef.current;
    setPreviewLoading(true);
    try {
      const res = await apiFetch("/api/v1/invoices/templates/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: current,
          kind: previewKindRef.current,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Preview failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (previewObjectUrls.current) {
        URL.revokeObjectURL(previewObjectUrls.current);
      }
      previewObjectUrls.current = url;
      setPreviewUrl(url);
    } catch (err) {
      setPreviewUrl(null);
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const debouncedPreview = useMemo(
    () => debounce(() => runPreview(), 250),
    [runPreview],
  );

  // Re-render the live preview whenever the design or kind changes (the
  // preview pane is always visible on the right, so edits show immediately).
  useEffect(() => {
    debouncedPreview();
  }, [config, previewKind, debouncedPreview]);

  useEffect(
    () => () => {
      if (previewObjectUrls.current) {
        URL.revokeObjectURL(previewObjectUrls.current);
      }
    },
    [],
  );

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name,
        description,
        config: {
          ...config,
          meta: { ...config.meta, name },
        },
      };
      const url = initial.id
        ? `/api/v1/invoices/templates/${initial.id}`
        : "/api/v1/invoices/templates";
      const res = await apiFetch(url, {
        method: initial.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save template");
      toast.success("Template saved");
      onSaved();
      onBack();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  const patchStyle = (patch: Partial<TemplateConfig["style"]>) => {
    setConfig((current) => ({ ...cloneConfig(current), style: { ...current.style, ...patch } }));
  };

  const handleLogoUpload = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch("/api/v1/invoices/templates/logo", {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Logo upload failed");
      setConfig((current) =>
        updateSection(current, "header", {
          showLogo: true,
          logoObjectKey: body.data.objectKey,
        }),
      );
      toast.success("Logo uploaded");
      debouncedPreview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Logo upload failed");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="font-semibold truncate">{name || "Untitled template"}</div>
              <div className="text-xs text-muted-foreground">
                {initial.id ? "Editing saved template" : "New template — not saved yet"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => runPreview()} disabled={previewLoading}>
              <Eye className="h-4 w-4 mr-1.5" />
              Preview
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="h-4 w-4 mr-1.5" />
              {saving ? "Saving…" : "Save template"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex h-[calc(100vh-9rem)] min-h-[560px] flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <Tabs defaultValue="design">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="design">Design</TabsTrigger>
              <TabsTrigger value="sections">Sections</TabsTrigger>
            </TabsList>

        <TabsContent value="design" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Template details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ib-name">Name</Label>
                <Input
                  id="ib-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ib-desc">Description</Label>
                <Input
                  id="ib-desc"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={500}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Colors & typography</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {COLOR_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label className="text-xs">{field.label}</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={config.style[field.key]}
                      onChange={(event) =>
                        patchStyle({ [field.key]: event.target.value })
                      }
                      className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
                    />
                    <span className="font-mono text-xs">{config.style[field.key]}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Page & watermark</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Font family</Label>
                <Select
                  value={config.style.fontFamily}
                  onValueChange={(value) =>
                    patchStyle({ fontFamily: value as "helvetica" | "courier" })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Font family" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="helvetica">Helvetica</SelectItem>
                    <SelectItem value="courier">Courier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Page orientation</Label>
                <Select
                  value={config.style.pageOrientation}
                  onValueChange={(value) =>
                    patchStyle({ pageOrientation: value as "portrait" | "landscape" })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Page orientation" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Portrait (A4)</SelectItem>
                    <SelectItem value="landscape">Landscape (A4)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Base font size ({config.style.baseFontSize}px)</Label>
                <input
                  type="range"
                  min={8}
                  max={16}
                  value={config.style.baseFontSize}
                  onChange={(event) =>
                    patchStyle({ baseFontSize: Number(event.target.value) })
                  }
                  className="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max logo height ({config.style.logoMaxHeight}px)</Label>
                <input
                  type="range"
                  min={24}
                  max={120}
                  value={config.style.logoMaxHeight}
                  onChange={(event) =>
                    patchStyle({ logoMaxHeight: Number(event.target.value) })
                  }
                  className="w-full"
                />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Watermarks</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ib-wm-paid">When paid (receipts)</Label>
                <Input
                  id="ib-wm-paid"
                  value={config.watermark.onPaid ?? ""}
                  placeholder="e.g. PAID"
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...cloneConfig(current),
                      watermark: {
                        ...current.watermark,
                        onPaid: event.target.value || null,
                      },
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Diagonal watermark on paid receipts. Empty hides it.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ib-wm-overdue">When overdue (invoices)</Label>
                <Input
                  id="ib-wm-overdue"
                  value={config.watermark.onOverdue ?? ""}
                  placeholder="e.g. OVERDUE"
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...cloneConfig(current),
                      watermark: {
                        ...current.watermark,
                        onOverdue: event.target.value || null,
                      },
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Diagonal watermark on overdue invoices. Empty hides it.
                </p>
              </div>
            </CardContent>
          </Card>

        </TabsContent>

        <TabsContent value="sections" className="space-y-3 pt-4">
          {config.sections.map((section) => (
            <Card key={section.type} className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{SECTION_LABELS[section.type]}</div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {SECTION_DESCRIPTIONS[section.type]}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(section.visible)}
                      onChange={() =>
                        setConfig((current) => toggleSection(current, section.type))
                      }
                      className="h-4 w-4 accent-zinc-900"
                    />
                    Shown
                  </label>
                </div>

                {section.visible && section.type === "header" && (
                  <div className="grid gap-3 sm:grid-cols-2 mt-4 border-t pt-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Title override (empty = “Invoice”/“Receipt”)</Label>
                      <Input
                        value={String(section.title ?? "")}
                        maxLength={120}
                        placeholder="Invoice"
                        onChange={(event) =>
                          setConfig((current) =>
                            updateSection(current, "header", {
                              title: event.target.value || null,
                            }),
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Title alignment</Label>
                      <Select
                        value={String(section.align ?? "left")}
                        onValueChange={(value) =>
                          setConfig((current) =>
                            updateSection(current, "header", { align: value }),
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="left">Left</SelectItem>
                          <SelectItem value="center">Center</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(section.accentBar)}
                        onChange={(event) =>
                          setConfig((current) =>
                            updateSection(current, "header", {
                              accentBar: event.target.checked,
                            }),
                          )
                        }
                        className="h-4 w-4 accent-zinc-900"
                      />
                      Accent rule under header
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(section.showLogo)}
                        onChange={(event) =>
                          setConfig((current) =>
                            updateSection(current, "header", {
                              showLogo: event.target.checked,
                            }),
                          )
                        }
                        className="h-4 w-4 accent-zinc-900"
                      />
                      Show logo
                    </label>
                    {Boolean(section.showLogo) && (
                      <div className="sm:col-span-2 space-y-1.5">
                        <Label className="text-xs">Logo (PNG or JPEG, max 2MB)</Label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Button type="button" variant="outline" size="sm" asChild>
                            <span>
                              <Upload className="h-3.5 w-3.5 mr-1.5" />
                              {section.logoObjectKey ? "Replace logo" : "Upload logo"}
                            </span>
                          </Button>
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) handleLogoUpload(file);
                              event.target.value = "";
                            }}
                          />
                          {Boolean(section.logoObjectKey) && (
                            <Badge variant="secondary" className="text-xs">
                              Uploaded
                            </Badge>
                          )}
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {section.visible && section.type === "itemsTable" && (
                  <div className="grid gap-3 sm:grid-cols-4 mt-4 border-t pt-4">
                    {(
                      [
                        ["description", "Description"],
                        ["qty", "Qty"],
                        ["unitPrice", "Unit price"],
                        ["amount", "Amount"],
                      ] as const
                    ).map(([key, label]) => {
                      const widths = (section.columnWidths ?? {}) as Record<string, number>;
                      const value = typeof widths[key] === "number" ? widths[key] : 0.25;
                      return (
                        <div key={key} className="space-y-1.5">
                          <Label className="text-xs">
                            {label} ({Math.round(value * 100)}%)
                          </Label>
                          <input
                            type="range"
                            min={0}
                            max={0.5}
                            step={0.05}
                            value={value}
                            onChange={(event) =>
                              setConfig((current) =>
                                updateSection(current, "itemsTable", {
                                  columnWidths: {
                                    ...widths,
                                    [key]: Number(event.target.value),
                                  },
                                }),
                              )
                            }
                            className="w-full"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                {section.visible && section.type === "footer" && (
                  <div className="grid gap-3 sm:grid-cols-2 mt-4 border-t pt-4">
                    {(
                      [
                        ["showPaymentMethod", "Show payment method"],
                        ["showSupport", "Show support details"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(section[key])}
                          onChange={(event) =>
                            setConfig((current) =>
                              updateSection(current, "footer", {
                                [key]: event.target.checked,
                              }),
                            )
                          }
                          className="h-4 w-4 accent-zinc-900"
                        />
                        {label}
                      </label>
                    ))}
                    <div className="sm:col-span-2 space-y-1.5">
                      <Label className="text-xs">Footer note</Label>
                      <Textarea
                        value={String(section.note ?? "")}
                        placeholder="Thank you for your business!"
                        maxLength={500}
                        onChange={(event) =>
                          setConfig((current) =>
                            updateSection(current, "footer", {
                              note: event.target.value || null,
                            }),
                          )
                        }
                      />
                    </div>
                  </div>
                )}

                {section.visible &&
                  (section.type === "metadata" ||
                    section.type === "addresses" ||
                    section.type === "totals") && (
                    <div className="grid gap-2 sm:grid-cols-2 mt-4 border-t pt-4">
                      {section.type === "metadata" &&
                        (
                          [
                            ["showInvoiceNumber", "Invoice number"],
                            ["showIssueDate", "Date of issue"],
                            ["showDueDate", "Date due"],
                            ["showReceiptNumber", "Receipt number"],
                            ["showPaidDate", "Date paid"],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={Boolean(section[key])}
                              onChange={(event) =>
                                setConfig((current) =>
                                  updateSection(current, "metadata", {
                                    [key]: event.target.checked,
                                  }),
                                )
                              }
                              className="h-4 w-4 accent-zinc-900"
                            />
                            {label}
                          </label>
                        ))}
                      {section.type === "addresses" &&
                        (
                          [
                            ["showFrom", "Show “From” block"],
                            ["showBillTo", "Show “Bill to” block"],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={Boolean(section[key])}
                              onChange={(event) =>
                                setConfig((current) =>
                                  updateSection(current, "addresses", {
                                    [key]: event.target.checked,
                                  }),
                                )
                              }
                              className="h-4 w-4 accent-zinc-900"
                            />
                            {label}
                          </label>
                        ))}
                      {section.type === "totals" &&
                        (
                          [
                            ["showSubtotal", "Subtotal"],
                            ["showTax", "Tax"],
                            ["showTotal", "Total"],
                            ["showAmountDue", "Amount due"],
                            ["showAmountPaid", "Amount paid"],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={Boolean(section[key])}
                              onChange={(event) =>
                                setConfig((current) =>
                                  updateSection(current, "totals", {
                                    [key]: event.target.checked,
                                  }),
                                )
                              }
                              className="h-4 w-4 accent-zinc-900"
                            />
                            {label}
                          </label>
                        ))}
                    </div>
                  )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

          </Tabs>
        </div>

        <div className="min-w-0 w-full shrink-0 lg:w-[500px] xl:w-[540px]">
          <Card className="h-full overflow-hidden border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">
                  {previewLoading ? "Rendering preview…" : "Live preview"}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {(["invoice", "receipt"] as const).map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    className="h-8 px-3"
                    variant={previewKind === kind ? "default" : "outline"}
                    onClick={() => setPreviewKind(kind)}
                  >
                    {kind === "invoice" ? "Invoice" : "Receipt"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex h-full min-h-[480px] items-start justify-center overflow-hidden bg-muted/30 p-6">
              {previewUrl ? (
                <iframe
                  src={previewUrl}
                  title="Invoice preview"
                  className="h-full w-full max-w-[520px] bg-white shadow-sm"
                />
              ) : (
                <div className="py-20 text-sm text-muted-foreground">
                  <Rocket className="mx-auto mb-2 h-6 w-6 opacity-40" />
                  Adjust the design to generate the first preview.
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

