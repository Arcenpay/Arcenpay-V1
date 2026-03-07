"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  Plus,
  Eye,
  Download,
  Package,
  ChevronDown,
  X,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Types ────────────────────────────────────────────────────────────────────

type TemplateStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
type EnvironmentMode = "DEVELOPMENT" | "PRODUCTION";

type BlockType = "heading" | "text" | "price" | "feature-list" | "cta";

type Block = {
  type: BlockType;
  content?: string;
  amount?: string;
  interval?: string;
  itemsRaw?: string; // comma-separated in the editor
  href?: string;
};

type TemplateVersion = {
  version: number;
  reactBlocks: unknown;
  schemaJson: unknown;
  styleTokens: unknown;
  compatibility: unknown;
};

type TemplateItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: TemplateStatus;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  versions: TemplateVersion[];
  installs: Array<{ id: string; status: string }>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CHAIN_LABELS: Record<number, string> = {
  11155111: "Sepolia (testnet)",
  8453: "Base Mainnet",
};

const ENV_CHAINS: Record<EnvironmentMode, number> = {
  DEVELOPMENT: 11155111,
  PRODUCTION: 8453,
};

const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Heading",
  text: "Text paragraph",
  price: "Price display",
  "feature-list": "Feature list",
  cta: "CTA button",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function blocksToReactBlocks(blocks: Block[]) {
  return blocks.map((b) => {
    const base: Record<string, unknown> = { type: b.type };
    if (b.content !== undefined) base.content = b.content;
    if (b.amount !== undefined) base.amount = b.amount;
    if (b.interval !== undefined) base.interval = b.interval;
    if (b.href !== undefined) base.href = b.href;
    if (b.type === "feature-list") {
      base.items = (b.itemsRaw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return base;
  });
}

function reactBlocksToBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((b: Record<string, unknown>) => ({
    type: (b.type as BlockType) || "text",
    content: typeof b.content === "string" ? b.content : undefined,
    amount: typeof b.amount === "string" ? b.amount : undefined,
    interval: typeof b.interval === "string" ? b.interval : undefined,
    itemsRaw: Array.isArray(b.items)
      ? (b.items as string[]).join(", ")
      : undefined,
    href: typeof b.href === "string" ? b.href : undefined,
  }));
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: TemplateStatus }) {
  if (status === "PUBLISHED") {
    return (
      <Badge className="bg-success/10 text-success border-success/20 text-xs">
        Published
      </Badge>
    );
  }
  if (status === "ARCHIVED") {
    return (
      <Badge variant="secondary" className="text-xs">
        Archived
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs">
      Draft
    </Badge>
  );
}

// ─── Inline block preview ─────────────────────────────────────────────────────

function BlockPreview({ block }: { block: Record<string, unknown> }) {
  const type = block.type as BlockType;
  if (type === "heading") {
    return (
      <h3 className="text-base font-semibold text-foreground">
        {String(block.content || "")}
      </h3>
    );
  }
  if (type === "text") {
    return (
      <p className="text-sm text-muted-foreground">
        {String(block.content || "")}
      </p>
    );
  }
  if (type === "price") {
    return (
      <p className="text-xl font-bold text-foreground">
        {String(block.amount || "")}{" "}
        {typeof block.interval === "string" && block.interval && (
          <span className="text-sm font-normal text-muted-foreground">
            / {String(block.interval)}
          </span>
        )}
      </p>
    );
  }
  if (type === "feature-list") {
    const items = Array.isArray(block.items) ? (block.items as string[]) : [];
    return (
      <ul className="space-y-1 text-sm text-muted-foreground">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    );
  }
  if (type === "cta") {
    return (
      <div>
        <span className="inline-block px-4 py-2 bg-accent text-accent-foreground text-sm font-medium rounded-md cursor-default">
          {String(block.content || "Continue")}
        </span>
      </div>
    );
  }
  return null;
}

// ─── Preview modal ────────────────────────────────────────────────────────────

function PreviewModal({
  template,
  open,
  onClose,
}: {
  template: TemplateItem;
  open: boolean;
  onClose: () => void;
}) {
  const latestVersion = template.versions[0];
  const blocks = Array.isArray(latestVersion?.reactBlocks)
    ? (latestVersion.reactBlocks as Record<string, unknown>[])
    : [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{template.name} — Preview</DialogTitle>
          <p className="text-xs text-muted-foreground">
            v{template.currentVersion} · {blocks.length} block
            {blocks.length !== 1 ? "s" : ""}
          </p>
        </DialogHeader>
        <div className="border border-border rounded-lg p-5 space-y-4 bg-background min-h-[120px]">
          {blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No blocks in this template version.
            </p>
          ) : (
            blocks.map((block, i) => <BlockPreview key={i} block={block} />)
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Install dialog ───────────────────────────────────────────────────────────

function InstallDialog({
  template,
  open,
  onClose,
  onInstalled,
}: {
  template: TemplateItem;
  open: boolean;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [env, setEnv] = useState<EnvironmentMode>("DEVELOPMENT");
  const [busy, setBusy] = useState(false);
  const chainId = ENV_CHAINS[env];

  const handleInstall = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentMode: env, chainId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Install failed");
      toast.success(`Template installed on ${CHAIN_LABELS[chainId]}`);
      onInstalled();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Install failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Install Template</DialogTitle>
          <p className="text-sm text-muted-foreground">{template.name}</p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Environment</Label>
            <select
              value={env}
              onChange={(e) => setEnv(e.target.value as EnvironmentMode)}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="DEVELOPMENT">Development (Sepolia)</option>
              <option value="PRODUCTION">Production (Base Mainnet)</option>
            </select>
          </div>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Chain: </span>
            <span className="font-medium">{CHAIN_LABELS[chainId]}</span>
            <span className="text-muted-foreground ml-2">(ID: {chainId})</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Installing v{template.currentVersion} of this template. The install
            can be updated later by re-installing.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleInstall} disabled={busy}>
            <Package className="w-4 h-4 mr-2" />
            {busy ? "Installing…" : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Block editor row ─────────────────────────────────────────────────────────

function BlockEditorRow({
  block,
  index,
  onChange,
  onRemove,
}: {
  block: Block;
  index: number;
  onChange: (updated: Block) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border border-border rounded-lg p-3 space-y-2 bg-card">
      <div className="flex items-center gap-2">
        <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
        <select
          value={block.type}
          onChange={(e) => onChange({ type: e.target.value as BlockType })}
          className="flex-1 h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          {(Object.keys(BLOCK_LABELS) as BlockType[]).map((t) => (
            <option key={t} value={t}>
              {BLOCK_LABELS[t]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive transition-colors"
          aria-label={`Remove block ${index + 1}`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {(block.type === "heading" ||
        block.type === "text" ||
        block.type === "cta") && (
        <Input
          placeholder={block.type === "cta" ? "Button label" : "Content"}
          value={block.content ?? ""}
          onChange={(e) => onChange({ ...block, content: e.target.value })}
          className="text-sm h-8"
        />
      )}

      {block.type === "price" && (
        <div className="flex gap-2">
          <Input
            placeholder="Amount (e.g. 29.00)"
            value={block.amount ?? ""}
            onChange={(e) => onChange({ ...block, amount: e.target.value })}
            className="text-sm h-8"
          />
          <Input
            placeholder="Interval (e.g. month)"
            value={block.interval ?? ""}
            onChange={(e) => onChange({ ...block, interval: e.target.value })}
            className="text-sm h-8"
          />
        </div>
      )}

      {block.type === "feature-list" && (
        <Input
          placeholder="Feature 1, Feature 2, Feature 3"
          value={block.itemsRaw ?? ""}
          onChange={(e) => onChange({ ...block, itemsRaw: e.target.value })}
          className="text-sm h-8"
        />
      )}

      {block.type === "cta" && (
        <Input
          placeholder="Link URL (optional)"
          value={block.href ?? ""}
          onChange={(e) => onChange({ ...block, href: e.target.value })}
          className="text-sm h-8"
        />
      )}
    </div>
  );
}

// ─── Create template dialog ───────────────────────────────────────────────────

function CreateTemplateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([
    { type: "heading", content: "Plan Name" },
    { type: "price", amount: "0.00", interval: "month" },
    { type: "feature-list", itemsRaw: "Feature one, Feature two" },
    { type: "cta", content: "Get Started" },
  ]);
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setSlug("");
    setDescription("");
    setBlocks([
      { type: "heading", content: "Plan Name" },
      { type: "price", amount: "0.00", interval: "month" },
      { type: "feature-list", itemsRaw: "Feature one, Feature two" },
      { type: "cta", content: "Get Started" },
    ]);
  }

  function handleClose() {
    reset();
    onClose();
  }

  const addBlock = () =>
    setBlocks((prev) => [...prev, { type: "text", content: "" }]);

  const updateBlock = (i: number, updated: Block) =>
    setBlocks((prev) => prev.map((b, idx) => (idx === i ? updated : b)));

  const removeBlock = (i: number) =>
    setBlocks((prev) => prev.filter((_, idx) => idx !== i));

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Template name is required");
      return;
    }
    if (!slug.trim()) {
      toast.error("Slug is required");
      return;
    }
    if (blocks.length === 0) {
      toast.error("Add at least one block");
      return;
    }

    setBusy(true);
    try {
      const reactBlocks = blocksToReactBlocks(blocks);
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || undefined,
          schemaJson: { blocks: reactBlocks.map((b) => ({ type: b.type })) },
          reactBlocks,
          styleTokens: {},
          compatibility: {
            environments: ["DEVELOPMENT", "PRODUCTION"],
            chains: [11155111, 8453],
            tokens: ["USDC"],
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed");
      toast.success("Template created");
      onCreated();
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                placeholder="Pro Plan Card"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slug || slug === slugify(name)) {
                    setSlug(slugify(e.target.value));
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input
                placeholder="pro-plan-card"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Blocks</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addBlock}
              >
                <Plus className="w-3 h-3 mr-1" />
                Add block
              </Button>
            </div>
            {blocks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4 border border-dashed border-border rounded-lg">
                No blocks yet. Add one above.
              </p>
            )}
            <div className="space-y-2">
              {blocks.map((block, i) => (
                <BlockEditorRow
                  key={i}
                  block={block}
                  index={i}
                  onChange={(updated) => updateBlock(i, updated)}
                  onRemove={() => removeBlock(i)}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={busy}>
            {busy ? "Creating…" : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Template card ────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onStatusChange,
  onRefresh,
}: {
  template: TemplateItem;
  onStatusChange: (id: string, status: TemplateStatus) => Promise<void>;
  onRefresh: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const nextStatuses: TemplateStatus[] =
    template.status === "DRAFT"
      ? ["PUBLISHED"]
      : template.status === "PUBLISHED"
        ? ["ARCHIVED"]
        : [];

  const STATUS_ACTION_LABELS: Record<TemplateStatus, string> = {
    DRAFT: "Draft",
    PUBLISHED: "Publish",
    ARCHIVED: "Archive",
  };

  const handleStatusChange = async (s: TemplateStatus) => {
    setBusy(true);
    try {
      await onStatusChange(template.id, s);
    } finally {
      setBusy(false);
    }
  };

  const installCount = template.installs.length;

  return (
    <>
      <Card className="border-border bg-card flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">{template.name}</p>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {template.slug}
              </p>
            </div>
            <StatusBadge status={template.status} />
          </div>
          {template.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
              {template.description}
            </p>
          )}
        </CardHeader>
        <CardContent className="pt-0 flex-1 flex flex-col justify-between gap-4">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>v{template.currentVersion}</span>
            <span>·</span>
            <span>
              {installCount} install{installCount !== 1 ? "s" : ""}
            </span>
            <span>·</span>
            <span>
              {Array.isArray(template.versions[0]?.reactBlocks)
                ? (template.versions[0].reactBlocks as unknown[]).length
                : 0}{" "}
              block
              {(Array.isArray(template.versions[0]?.reactBlocks)
                ? (template.versions[0].reactBlocks as unknown[]).length
                : 0) !== 1
                ? "s"
                : ""}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="w-3.5 h-3.5 mr-1" />
              Preview
            </Button>

            {template.status === "PUBLISHED" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInstallOpen(true)}
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                Install
              </Button>
            )}

            {nextStatuses.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={busy}>
                    Actions
                    <ChevronDown className="w-3 h-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {nextStatuses.map((s) => (
                    <DropdownMenuItem
                      key={s}
                      onClick={() => handleStatusChange(s)}
                    >
                      {STATUS_ACTION_LABELS[s]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </CardContent>
      </Card>

      <PreviewModal
        template={template}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
      <InstallDialog
        template={template}
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        onInstalled={onRefresh}
      />
    </>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function TemplatesSection() {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"ALL" | TemplateStatus>(
    "ALL",
  );

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/templates");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load templates");
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load templates",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleStatusChange = async (id: string, status: TemplateStatus) => {
    try {
      const res = await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      toast.success(`Template ${status.toLowerCase()}`);
      await fetchTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const filtered =
    statusFilter === "ALL"
      ? templates
      : templates.filter((t) => t.status === statusFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "ALL" | TemplateStatus)
            }
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchTemplates}
            disabled={loading}
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Template
        </Button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 rounded-lg border border-border bg-card animate-pulse"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border rounded-xl">
          <Package className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {statusFilter === "ALL"
              ? "No templates yet"
              : `No ${statusFilter.toLowerCase()} templates`}
          </p>
          {statusFilter === "ALL" && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Create your first template
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onStatusChange={handleStatusChange}
              onRefresh={fetchTemplates}
            />
          ))}
        </div>
      )}

      <CreateTemplateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchTemplates}
      />
    </div>
  );
}
