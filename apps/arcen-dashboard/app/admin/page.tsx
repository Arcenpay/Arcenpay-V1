"use client";
import { apiFetch } from "@/lib/api-client";
import { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import {
  Shield, Key, Plus, Copy, Search, RefreshCw, Users,
  Building2, CheckCircle2, Clock, Sparkles,
  Loader2, Send, Mail, BarChart3, Activity, XCircle,
  TrendingUp, DollarSign, PieChart as PieIcon, Info, Zap, Globe, Database,
  ChevronRight, AlertCircle, UserCheck, UserX, ExternalLink, UserPlus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart as RPieChart, Pie, Cell,
} from "recharts";
import { isPlatformAdminEmail } from "@/lib/admin";
import { useDashboardSession } from "@/hooks/use-dashboard-session";
import { toast } from "sonner";

const COLORS = ["#6366f1", "#22c55e", "#eab308", "#ef4444", "#a855f7", "#06b6d4"];

interface KeyItem { id: string; key: string; name: string; recipientEmail: string | null; tier: string; maxUses: number; usedCount: number; status: string; expiresAt: string | null; notes: string | null; createdAt: string; }
interface UserItem {
  id: string;
  email: string | null;
  emailVerified?: boolean;
  walletAddress: string | null;
  stellarWalletAddress: string | null;
  solanaWalletAddress: string | null;
  createdAt: string;
  lastSeenAt?: string;
  isAdmin?: boolean;
  isActivated?: boolean;
  activationStatus?: "ADMIN" | "ACTIVATED" | "PENDING_ACTIVATION";
  primaryTeam?: {
    id: string;
    name: string;
    slug: string;
    platformTier: string;
    isPlatformActivated: boolean;
    allowPlatformBilling: boolean;
    activationKeyId: string | null;
    activationKey?: { id: string; key: string; name: string; tier: string; status: string } | null;
    role?: string;
  } | null;
  teamsCount?: number;
}
interface SigninAttemptItem {
  email: string;
  latestAttemptAt: string;
  firstAttemptAt: string;
  totalRequests: number;
  hasCompletedOtp: boolean;
  hasAccount: boolean;
  userId: string | null;
  isActivated: boolean;
  status: "REGISTERED_ACTIVE" | "REGISTERED_NEEDS_KEY" | "OTP_INCOMPLETE";
  team?: {
    id: string;
    name: string;
    slug: string;
    tier: string;
    isActivated: boolean;
  } | null;
}
interface TeamItem { id: string; name: string; slug: string; platformTier: string; isPlatformActivated: boolean; createdAt: string; _count: { members: number }; }

// ── Placeholder for rest (will append sections) ──


function BroadcastTab({ hdrs }: any) {
  const [step, setStep] = useState<"compose" | "preview" | "sending">("compose");
  const [toInput, setToInput] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState("ArcenPay is Live!");
  const [message, setMessage] = useState("");
  const [includeKey, setIncludeKey] = useState(true);
  const [keyId, setKeyId] = useState("");
  const [keys, setKeys] = useState<any[]>([]);
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [targetSegment, setTargetSegment] = useState<"manual" | "unactivated">("manual");

  useEffect(() => {
    apiFetch("/api/admin/activation-keys?limit=100&status=ACTIVE", { headers: hdrs() })
      .then(async (r) => { if (r.ok) { const d = await r.json(); if (d.items) setKeys(d.items); } });
  }, []);

  const addEmails = () => {
    const emails = toInput.split(/[\n,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
    setRecipients((prev) => [...new Set([...prev, ...emails])]);
    setToInput("");
  };

  const handleSend = async () => {
    if (recipients.length === 0) return toast.error("Add at least one recipient");
    setSending(true); setStep("sending");
    const body: any = { to: recipients, subject, message: message || undefined, includeKey };
    if (keyId) body.keyId = keyId;
    const r = await apiFetch("/api/admin/activation-keys/announce", { method: "POST", headers: hdrs(), body: JSON.stringify(body) });
    const d = await r.json();
    if (d.ok) {
      setSentCount(d.sentCount || 0);
      setErrorCount(d.errorCount || 0);
      toast.success(d.message);
    } else {
      toast.error(d.error || "Failed");
    }
    setSending(false);
  };

  const loadUnactivatedEmails = async () => {
    const r = await apiFetch("/api/admin/users/teams?limit=200&activated=false", { headers: hdrs() });
    if (r.ok) {
      const d = await r.json();
      if (d.teams) {
        // Collect team emails from profile data
        const emails: string[] = [];
        for (const team of d.teams) {
          // Get emails from users in the team
          try {
            const tr = await apiFetch("/api/admin/users/teams/" + team.id, { headers: hdrs() });
            if (tr.ok) {
              const td = await tr.json();
              if (td.data?.users) {
                td.data.users.forEach((u: any) => {
                  if (u.email && !emails.includes(u.email.toLowerCase())) emails.push(u.email.toLowerCase());
                });
              }
            }
          } catch {}
        }
        setRecipients(emails);
        toast.success("Loaded " + emails.length + " emails from unactivated teams");
      }
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Compose Panel */}
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-sm"><Send className="w-4 h-4 inline mr-1.5 text-brand" />Compose Broadcast Email</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {/* Target Segment */}
            <div className="flex items-center gap-2">
              <Button variant={targetSegment === "manual" ? "default" : "outline"} size="sm" onClick={() => setTargetSegment("manual")}>Manual Recipients</Button>
              <Button variant={targetSegment === "unactivated" ? "default" : "outline"} size="sm" onClick={() => { setTargetSegment("unactivated"); loadUnactivatedEmails(); }}>Unactivated Teams</Button>
            </div>

            {/* Recipients */}
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">
                Recipients ({recipients.length} added)
              </label>
              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {recipients.slice(0, 20).map((email) => (
                    <span key={email} className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted rounded text-[10px]">
                      {email}
                      <button onClick={() => setRecipients((p) => p.filter((e) => e !== email))} className="text-muted-foreground hover:text-foreground">&times;</button>
                    </span>
                  ))}
                  {recipients.length > 20 && <span className="text-[10px] text-muted-foreground">+{recipients.length - 20} more</span>}
                </div>
              )}
              <div className="flex gap-2">
                <textarea value={toInput} onChange={(e) => setToInput(e.target.value)} rows={2}
                  className="flex-1 p-2 rounded-lg bg-background border border-border text-sm resize-none"
                  placeholder="Enter email addresses (comma or newline separated)" />
                <Button variant="outline" size="sm" onClick={addEmails} className="shrink-0 self-end">Add</Button>
              </div>
            </div>

            {/* Subject & Message */}
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject" />
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6}
              className="w-full p-3 rounded-lg bg-background border border-border text-sm resize-none font-mono"
              placeholder="Write your message. Supports basic HTML tags. Leave empty for default 'ArcenPay is Live!' announcement." />

            {/* Key Options */}
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={includeKey} onChange={(e) => setIncludeKey(e.target.checked)} className="rounded" />
                Include FREE Activation Key
              </label>
              {includeKey && keys.length > 0 && (
                <select value={keyId} onChange={(e) => setKeyId(e.target.value)} className="h-8 px-2 rounded bg-background border border-border text-xs">
                  <option value="">Auto-select best key</option>
                  {keys.map((k: any) => (
                    <option key={k.id} value={k.id}>{k.name} ({k.tier}) — {k.usedCount}/{k.maxUses}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Send */}
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleSend} disabled={sending || recipients.length === 0 || !subject.trim()}
                className="bg-brand hover:bg-brand-dark text-primary-foreground">
                {sending ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Sending to {recipients.length}...</> : <><Send className="w-4 h-4 mr-1.5" />Send to {recipients.length} Recipients</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Preview Panel */}
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-sm"><Mail className="w-4 h-4 inline mr-1.5 text-brand" />Email Preview</CardTitle></CardHeader>
          <CardContent>
            <div className="bg-[#f8fafc] border border-border rounded-lg p-4 text-xs leading-relaxed text-slate-800" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3 text-left">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="font-extrabold text-base tracking-tight text-slate-900">Arcen<span className="text-indigo-600">Pay</span></span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700">PLATFORM ADMIN</span>
                </div>
                {message ? (
                  // SECURITY: rendered as TEXT, not HTML. The admin email composer
                  // must never turn typed/pasted markup into live DOM in the preview
                  // pane (self-XSS → session theft). `whitespace-pre-wrap` preserves
                  // the line breaks the old `<br/>` substitution provided.
                  <div className="text-slate-700 whitespace-pre-wrap">{message}</div>
                ) : (
                  <>
                    <h1 className="text-base font-bold text-slate-900 m-0">ArcenPay is Live!</h1>
                    <p className="text-slate-600 m-0 text-xs leading-normal">We are excited to announce that ArcenPay is live. Build, manage, and scale your billing infrastructure on-chain.</p>
                  </>
                )}
                {includeKey && (
                  <div className="bg-indigo-50/70 border-2 border-dashed border-indigo-200 rounded-lg p-3 text-center my-2">
                    <p className="m-0 mb-1 text-[10px] font-bold uppercase tracking-wider text-indigo-600">Platform Activation Key</p>
                    <p className="m-0 text-base font-extrabold text-indigo-950 font-mono tracking-widest">ARCN-XXXX-XXXX-XXXX</p>
                    <p className="m-0 mt-1 text-[10px] text-indigo-700 font-medium">Valid for 1 workspace &bull; Enterprise billing unlocked</p>
                  </div>
                )}
                <div className="pt-1 text-center">
                  <span className="inline-block bg-indigo-600 text-white font-semibold px-4 py-1.5 rounded-lg text-xs shadow-sm">Activate Workspace &rarr;</span>
                </div>
                <hr className="my-2 border-slate-100" />
                <p className="m-0 text-[10px] text-slate-400">Sent by ArcenPay Platform Admin (hello@arcenpay.com). Reply to this email with questions.</p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Dispatched via hello@arcenpay.com using the new enterprise email template.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { data: sessionData, isLoading: sessionLoading } = useDashboardSession();
  const isAuthorized = sessionData?.user?.isPlatformAdmin === true || isPlatformAdminEmail(sessionData?.user?.email);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState("overview");
  const [analytics, setAnalytics] = useState<any>(null);
  const [trends, setTrends] = useState([]);
  const [revenue, setRevenue] = useState<any>(null);
  const [duneConfigured, setDuneConfigured] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [unactivatedCount, setUnactivatedCount] = useState(0);
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState<"all" | "unactivated" | "activated" | "attempts">("all");
  const [signinAttempts, setSigninAttempts] = useState<any[]>([]);
  const [showDirectKeyModal, setShowDirectKeyModal] = useState(false);
  const [directKeyEmail, setDirectKeyEmail] = useState("");
  const [activatingUserId, setActivatingUserId] = useState<string | null>(null);
  const [teams, setTeams] = useState([]);
  const [teamsTotal, setTeamsTotal] = useState(0);
  const [teamSearch, setTeamSearch] = useState("");
  const [teamTier, setTeamTier] = useState("");
  const [teamActivated, setTeamActivated] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<any>(null);
  const [keys, setKeys] = useState([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keySearch, setKeySearch] = useState("");
  const [keyStatus, setKeyStatus] = useState("ALL");
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [keyForm, setKeyForm] = useState({ name: "", tier: "FREE", maxUses: 100, allowPlatformBilling: true, email: "", notes: "", expiresDays: "365" });
  const [showEmailKey, setShowEmailKey] = useState(false);
  const [emailKeyId, setEmailKeyId] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [emailSubj, setEmailSubj] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showBulkEmail, setShowBulkEmail] = useState(false);
  const [bulkSubj, setBulkSubj] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");
  const [duneQ1, setDuneQ1] = useState("");
  const [duneV1, setDuneV1] = useState("");
  const [duneQ2, setDuneQ2] = useState("");
  const [duneV2, setDuneV2] = useState("");
  const [activeEmbed, setActiveEmbed] = useState(1);

  const hdrs = useCallback(() => ({ "Content-Type": "application/json", ...(authed ? { "x-admin-secret": "admin" } : {}) }), [authed]);

  const loadAll = useCallback(async () => {
    if (!authed) return;
    const [aR, tR, rR, uR, tmR, kR, dR, saR] = await Promise.all([
      apiFetch("/api/admin/activation-keys/analytics", { headers: hdrs() }),
      apiFetch("/api/admin/analytics/trends", { headers: hdrs() }),
      apiFetch("/api/admin/analytics/revenue", { headers: hdrs() }),
      apiFetch("/api/admin/users?limit=150", { headers: hdrs() }),
      apiFetch("/api/admin/users/teams?limit=100", { headers: hdrs() }),
      apiFetch("/api/admin/activation-keys?limit=200", { headers: hdrs() }),
      apiFetch("/api/admin/analytics/dune-status", { headers: hdrs() }),
      apiFetch("/api/admin/users/signin-attempts?limit=150", { headers: hdrs() }),
    ]);
    if (aR.ok) { const d = await aR.json(); if (d.ok) setAnalytics(d.data); }
    if (tR.ok) { const d = await tR.json(); if (d.ok && d.data?.trendData) setTrends(d.data.trendData); }
    if (rR.ok) { const d = await rR.json(); if (d.ok) setRevenue(d.data); }
    if (uR.ok) {
      const d = await uR.json();
      if (d.ok) {
        setUsers(d.users || []);
        setUsersTotal(d.totalAll ?? d.total ?? 0);
        setUnactivatedCount(d.unactivatedCount || 0);
      }
    }
    if (tmR.ok) { const d = await tmR.json(); if (d.ok) { setTeams(d.teams||[]); setTeamsTotal(d.total||0); } }
    if (kR.ok) { const d = await kR.json(); if (d.items) setKeys(d.items); }
    if (dR.ok) { const d = await dR.json(); if (d.ok) setDuneConfigured(d.data.configured); }
    if (saR.ok) { const d = await saR.json(); if (d.ok) setSigninAttempts(d.attempts || []); }
  }, [authed, hdrs]);

  const handleQuickActivate = async (userId: string) => {
    setActivatingUserId(userId);
    try {
      const r = await apiFetch(`/api/admin/users/${userId}/activate`, {
        method: "POST",
        headers: hdrs(),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success(d.message || "Workspace activated successfully!");
        loadAll();
      } else {
        toast.error(d.error || "Failed to activate workspace");
      }
    } catch {
      toast.error("Network error while activating workspace");
    } finally {
      setActivatingUserId(null);
    }
  };

  useEffect(() => {
    if (!sessionLoading && isAuthorized) {
      apiFetch("/api/admin/activation-keys/verify-secret", { method: "POST", headers: { "Content-Type": "application/json" } })
        .then((r) => { if (r.ok) setAuthed(true); });
    }
  }, [sessionLoading, isAuthorized]);

  useEffect(() => { loadAll(); }, [authed, loadAll]);

  useEffect(() => {
    setDuneQ1(localStorage.getItem("dune_q1")||"");
    setDuneV1(localStorage.getItem("dune_v1")||"");
    setDuneQ2(localStorage.getItem("dune_q2")||"");
    setDuneV2(localStorage.getItem("dune_v2")||"");
  }, []);

  const saveDune = () => {
    localStorage.setItem("dune_q1", duneQ1);
    localStorage.setItem("dune_v1", duneV1);
    localStorage.setItem("dune_q2", duneQ2);
    localStorage.setItem("dune_v2", duneV2);
    toast.success("Dune embeds saved");
  };


  if (sessionLoading) return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!isAuthorized) return <div className="min-h-screen flex items-center justify-center bg-background"><Shield className="w-12 h-12 text-muted-foreground/60" /><p className="ml-3 text-muted-foreground">Access Denied</p></div>;
  if (!authed) return <div className="min-h-screen flex items-center justify-center bg-background"><Image src="/arcenpay-logo.png" alt="" width={160} height={40} className="h-8 w-auto dark:brightness-0 dark:invert" /><Loader2 className="w-5 h-5 animate-spin ml-3" /></div>;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Image src="/arcenpay-logo.png" alt="ArcenPay" width={140} height={35} className="h-8 w-auto object-contain dark:brightness-0 dark:invert" />
          <span className="text-[10px] font-bold uppercase tracking-wider bg-brand/10 text-brand px-2 py-0.5 rounded">Admin</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{sessionData?.user?.email}</span>
          {analytics && <Badge variant="outline" className="text-[10px]">{analytics.overview?.totalTeams || 0} teams</Badge>}
        </div>
      </header>

      <div className="px-6 py-4 max-w-[1440px] mx-auto">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="overview"><BarChart3 className="w-4 h-4" /> Overview</TabsTrigger>
            <TabsTrigger value="users" className="relative">
              <Users className="w-4 h-4" /> Users
              {unactivatedCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-500">
                  {unactivatedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="teams"><Building2 className="w-4 h-4" /> Teams</TabsTrigger>
            <TabsTrigger value="keys"><Key className="w-4 h-4" /> Keys</TabsTrigger>
            <TabsTrigger value="onchain"><Globe className="w-4 h-4" /> On-Chain</TabsTrigger>
            <TabsTrigger value="email"><Mail className="w-4 h-4" /> Email</TabsTrigger>
            <TabsTrigger value="broadcast"><Send className="w-4 h-4" /> Broadcast</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <OverviewTab analytics={analytics} trends={trends} revenue={revenue} onRefresh={loadAll} />
          </TabsContent>

          <TabsContent value="users" className="space-y-4">
            <UsersTab
              users={users}
              total={usersTotal}
              unactivatedCount={unactivatedCount}
              signinAttempts={signinAttempts}
              search={userSearch}
              setSearch={setUserSearch}
              filter={userFilter}
              setFilter={setUserFilter}
              onOpenSendKey={(email: string) => {
                setDirectKeyEmail(email);
                setShowDirectKeyModal(true);
              }}
              onQuickActivate={handleQuickActivate}
              activatingUserId={activatingUserId}
              onRefresh={loadAll}
            />
          </TabsContent>

          <TabsContent value="teams" className="space-y-4">
            <TeamsTab teams={teams} total={teamsTotal} search={teamSearch} setSearch={setTeamSearch} tier={teamTier} setTier={setTeamTier} activated={teamActivated} setActivated={setTeamActivated} selectedTeam={selectedTeam} setSelectedTeam={setSelectedTeam} hdrs={hdrs} />
          </TabsContent>

          <TabsContent value="keys" className="space-y-4">
            <KeysTab keys={keys} search={keySearch} setSearch={setKeySearch} statusFilter={keyStatus} setStatusFilter={setKeyStatus} setShowCreateKey={setShowCreateKey} setEmailKeyId={setEmailKeyId} setShowEmailKey={setShowEmailKey} loadAll={loadAll} hdrs={hdrs} />
          </TabsContent>

          <TabsContent value="onchain" className="space-y-6">
            <OnChainTab duneConfigured={duneConfigured} duneQ1={duneQ1} duneV1={duneV1} duneQ2={duneQ2} duneV2={duneV2} setDuneQ1={setDuneQ1} setDuneV1={setDuneV1} setDuneQ2={setDuneQ2} setDuneV2={setDuneV2} activeEmbed={activeEmbed} setActiveEmbed={setActiveEmbed} onSave={saveDune} />
          </TabsContent>

          <TabsContent value="broadcast" className="space-y-6">
            <BroadcastTab hdrs={hdrs} />
          </TabsContent>

          <TabsContent value="email" className="space-y-6 max-w-2xl">
            <EmailTab keys={keys} setEmailKeyId={setEmailKeyId} setShowEmailKey={setShowEmailKey} setShowBulkEmail={setShowBulkEmail} hdrs={hdrs} />
          </TabsContent>
        </Tabs>
      </div>

      {showCreateKey && <CreateKeyModal form={keyForm} setForm={setKeyForm} creating={creatingKey} setCreating={setCreatingKey} onClose={() => setShowCreateKey(false)} onCreated={() => { setShowCreateKey(false); loadAll(); }} hdrs={hdrs} />}
      {showEmailKey && <EmailKeyModal keyId={emailKeyId} keys={keys} to={emailTo} setTo={setEmailTo} subject={emailSubj} setSubject={setEmailSubj} sending={sendingEmail} setSending={setSendingEmail} onClose={() => setShowEmailKey(false)} hdrs={hdrs} />}
      {showBulkEmail && <BulkEmailModal onClose={() => setShowBulkEmail(false)} hdrs={hdrs} />}
      {showDirectKeyModal && (
        <DirectKeyModal
          initialEmail={directKeyEmail}
          onClose={() => setShowDirectKeyModal(false)}
          onSent={() => {
            setShowDirectKeyModal(false);
            loadAll();
          }}
          hdrs={hdrs}
        />
      )}
    </div>
  );
}

function OverviewTab({ analytics, trends, revenue, onRefresh }: any) {
  const pieData = (analytics?.teamsByTier || []).map((t: any) => ({ name: t.tier, value: t.count }));
  if (!analytics) return <div className="py-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />Loading analytics...</div>;
  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Platform Overview</h2>
        <Button variant="ghost" size="sm" onClick={onRefresh}><RefreshCw className="w-4 h-4 mr-1" /> Refresh</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{analytics.overview?.totalTeams || 0}</div><p className="text-xs text-muted-foreground"><Building2 className="w-3 h-3 inline mr-1" />Total Teams</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold">{analytics.overview?.totalUsers || 0}</div><p className="text-xs text-muted-foreground"><Users className="w-3 h-3 inline mr-1" />Users</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className={"text-2xl font-bold " + ((analytics.overview?.activationRate||0) >= 50 ? "text-green-500" : "text-yellow-500")}>{analytics.overview?.activationRate || 0}%</div><p className="text-xs text-muted-foreground"><Activity className="w-3 h-3 inline mr-1" />Activation Rate</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-2xl font-bold text-brand">{revenue?.mrr || 0}</div><p className="text-xs text-muted-foreground"><DollarSign className="w-3 h-3 inline mr-1" />Est. MRR</p></CardContent></Card>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4"><div className="text-xl font-bold">{analytics.overview?.totalKeys || 0}</div><p className="text-xs text-muted-foreground"><Key className="w-3 h-3 inline mr-1" />Total Keys</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xl font-bold">{analytics.overview?.activeKeys || 0}</div><p className="text-xs text-muted-foreground"><CheckCircle2 className="w-3 h-3 inline mr-1 text-green-500" />Active Keys</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xl font-bold">{analytics.overview?.activatedTeams || 0}</div><p className="text-xs text-muted-foreground"><Shield className="w-3 h-3 inline mr-1" />Activated</p></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xl font-bold">{analytics.overview?.paidTeams || 0}</div><p className="text-xs text-muted-foreground"><DollarSign className="w-3 h-3 inline mr-1" />PLUS/PRO</p></CardContent></Card>
      </div>
      {trends.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm"><TrendingUp className="w-4 h-4 inline mr-1.5 text-brand" />30-Day Trend</CardTitle></CardHeader>
          <CardContent><div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2c" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: any) => String(v).slice(5)} stroke="#666" />
                <YAxis tick={{ fontSize: 11 }} stroke="#666" allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#111", border: "1px solid #222", borderRadius: 8, color: "#fff" }} />
                <Legend />
                <Area type="monotone" dataKey="teams" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} name="Teams Created" />
                <Area type="monotone" dataKey="activations" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} strokeWidth={2} name="Activations" />
                <Area type="monotone" dataKey="redemptions" stroke="#eab308" fill="#eab308" fillOpacity={0.1} strokeWidth={2} name="Redemptions" />
              </AreaChart>
            </ResponsiveContainer>
          </div></CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm"><PieIcon className="w-4 h-4 inline mr-1.5 text-brand" />Teams by Tier</CardTitle></CardHeader>
          <CardContent>{pieData.length === 0 ? <p className="text-xs text-muted-foreground">No data</p> : (
            <div className="flex items-center h-[220px]">
              <ResponsiveContainer width="50%" height="100%">
                <RPieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={(d: any) => d.name}>
                    {pieData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#111", border: "1px solid #222", borderRadius: 8 }} />
                </RPieChart>
              </ResponsiveContainer>
              <div className="space-y-2">{(analytics.teamsByTier || []).map((t: any, i: number) => (
                <div key={t.tier} className="flex items-center gap-2 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="capitalize">{t.tier.toLowerCase()}</span>
                  <span className="font-mono font-bold ml-auto">{t.count}</span>
                </div>
              ))}</div>
            </div>
          )}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm"><DollarSign className="w-4 h-4 inline mr-1.5 text-brand" />Revenue Breakdown</CardTitle></CardHeader>
          <CardContent>{!revenue ? <p className="text-xs text-muted-foreground">No data</p> : (
            <><div className="text-2xl font-bold mb-3">{revenue.mrr}<span className="text-sm font-normal text-muted-foreground ml-1">/mo</span></div>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenue.tierBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2c" />
                  <XAxis dataKey="tier" tick={{ fontSize: 11 }} stroke="#666" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#666" />
                  <Tooltip formatter={(v: any) => <span>$v</span>} contentStyle={{ background: "#111", border: "1px solid #222", borderRadius: 8 }} />
                  <Bar dataKey="monthlyRevenue" name="Monthly Rev" fill="#6366f1" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div></>
          )}</CardContent>
        </Card>
      </div>
    </>
  );
}

function UsersTab({
  users,
  total,
  unactivatedCount,
  signinAttempts,
  search,
  setSearch,
  filter,
  setFilter,
  onOpenSendKey,
  onQuickActivate,
  activatingUserId,
  onRefresh,
}: any) {
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedText(null), 2000);
  };

  const unactivatedUsers = useMemo(
    () => users.filter((u: any) => !u.isActivated && !u.isAdmin),
    [users]
  );
  const activatedUsers = useMemo(
    () => users.filter((u: any) => u.isActivated || u.isAdmin),
    [users]
  );

  const filteredUsers = useMemo(() => {
    let list = users;
    if (filter === "unactivated") list = unactivatedUsers;
    else if (filter === "activated") list = activatedUsers;

    if (!search.trim()) return list;
    const q = search.toLowerCase().trim();
    return list.filter((u: any) =>
      (u.email || "").toLowerCase().includes(q) ||
      (u.walletAddress || "").toLowerCase().includes(q) ||
      (u.stellarWalletAddress || "").toLowerCase().includes(q) ||
      (u.primaryTeam?.name || "").toLowerCase().includes(q)
    );
  }, [users, filter, unactivatedUsers, activatedUsers, search]);

  const filteredAttempts = useMemo(() => {
    if (!search.trim()) return signinAttempts;
    const q = search.toLowerCase().trim();
    return signinAttempts.filter((a: any) => a.email.toLowerCase().includes(q));
  }, [signinAttempts, search]);

  return (
    <div className="space-y-4">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{total}</div>
                <p className="text-xs text-muted-foreground"><Users className="w-3 h-3 inline mr-1" />Total Users</p>
              </div>
              <span className="p-2 rounded-lg bg-muted text-muted-foreground"><Users className="w-4 h-4" /></span>
            </div>
          </CardContent>
        </Card>

        <Card className={"border-border " + (unactivatedCount > 0 ? "border-amber-500/40 bg-amber-500/5" : "")}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-amber-500">{unactivatedCount}</div>
                <p className="text-xs text-muted-foreground font-medium"><Clock className="w-3 h-3 inline mr-1 text-amber-500" />Needs Key / Outsiders</p>
              </div>
              <span className="p-2 rounded-lg bg-amber-500/10 text-amber-500"><Key className="w-4 h-4" /></span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-green-500">{activatedUsers.length}</div>
                <p className="text-xs text-muted-foreground"><CheckCircle2 className="w-3 h-3 inline mr-1 text-green-500" />Activated Users</p>
              </div>
              <span className="p-2 rounded-lg bg-green-500/10 text-green-500"><Shield className="w-4 h-4" /></span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold text-indigo-500">{signinAttempts.length}</div>
                <p className="text-xs text-muted-foreground"><Send className="w-3 h-3 inline mr-1 text-indigo-500" />Sign-in Attempts</p>
              </div>
              <span className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500"><Mail className="w-4 h-4" /></span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Control bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        {/* Segmented Filter */}
        <div className="flex items-center gap-1.5 p-1 bg-muted/40 rounded-lg border border-border text-xs flex-wrap">
          <button
            onClick={() => setFilter("all")}
            className={"px-3 py-1.5 rounded-md font-medium transition-all " + (filter === "all" ? "bg-background shadow-xs text-foreground font-semibold" : "text-muted-foreground hover:text-foreground")}
          >
            All Users ({users.length})
          </button>
          <button
            onClick={() => setFilter("unactivated")}
            className={"px-3 py-1.5 rounded-md font-medium transition-all flex items-center gap-1.5 " + (filter === "unactivated" ? "bg-background shadow-xs text-amber-500 font-semibold" : "text-muted-foreground hover:text-foreground")}
          >
            Needs Activation
            {unactivatedUsers.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-500">
                {unactivatedUsers.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setFilter("activated")}
            className={"px-3 py-1.5 rounded-md font-medium transition-all " + (filter === "activated" ? "bg-background shadow-xs text-green-500 font-semibold" : "text-muted-foreground hover:text-foreground")}
          >
            Activated ({activatedUsers.length})
          </button>
          <button
            onClick={() => setFilter("attempts")}
            className={"px-3 py-1.5 rounded-md font-medium transition-all " + (filter === "attempts" ? "bg-background shadow-xs text-indigo-500 font-semibold" : "text-muted-foreground hover:text-foreground")}
          >
            Outsider Sign-ins ({signinAttempts.length})
          </button>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search email, wallet, team..."
              className="pl-9 h-9 text-xs"
            />
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} className="h-9 px-2.5">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            onClick={() => onOpenSendKey("")}
            className="h-9 text-xs bg-brand hover:bg-brand-dark text-primary-foreground gap-1.5 shrink-0"
          >
            <Key className="w-3.5 h-3.5" /> Issue Key
          </Button>
        </div>
      </div>

      {/* Table Content */}
      {filter === "attempts" ? (
        <Card className="border-border">
          <CardHeader className="py-3 px-4 border-b border-border bg-muted/20">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-indigo-500" />
                Recent Sign-in Requests & Outsider Activity
              </CardTitle>
              <span className="text-[11px] text-muted-foreground">Shows outsiders who requested OTP codes to enter</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground bg-muted/10">
                  <th className="text-left p-3 font-medium">Email</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-center p-3 font-medium">OTP Requests</th>
                  <th className="text-left p-3 font-medium">Workspace</th>
                  <th className="text-right p-3 font-medium">Latest Attempt</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAttempts.map((item: any) => (
                  <tr key={item.email} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-indigo-500/10 text-indigo-600 flex items-center justify-center font-bold text-xs uppercase">
                          {item.email.slice(0, 2)}
                        </div>
                        <div>
                          <p className="font-medium text-xs text-foreground">{item.email}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {item.hasAccount ? "Account created" : "OTP requested only"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      {item.status === "REGISTERED_ACTIVE" ? (
                        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-500 border-green-500/20 font-medium">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Active Workspace
                        </Badge>
                      ) : item.status === "REGISTERED_NEEDS_KEY" ? (
                        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20 font-medium">
                          <Clock className="w-3 h-3 mr-1" /> Awaiting Activation Key
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground border-border font-medium">
                          <AlertCircle className="w-3 h-3 mr-1" /> Incomplete OTP
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-muted/40">
                        {item.totalRequests}
                      </span>
                    </td>
                    <td className="p-3 text-xs">
                      {item.team ? (
                        <div>
                          <span className="font-medium">{item.team.name}</span>
                          <span className="ml-1 text-[10px] text-muted-foreground font-mono">({item.team.tier})</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic text-[11px]">Not created yet</span>
                      )}
                    </td>
                    <td className="p-3 text-right text-xs text-muted-foreground">
                      {new Date(item.latestAttemptAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(item.email)}
                          className="h-7 px-2 text-[11px]"
                          title="Copy email"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => onOpenSendKey(item.email)}
                          className="h-7 px-2.5 text-[11px] bg-brand hover:bg-brand-dark text-primary-foreground gap-1"
                        >
                          <Key className="w-3 h-3" /> Send Key
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredAttempts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground text-xs">
                      No sign-in attempts found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground bg-muted/10">
                  <th className="text-left p-3 font-medium">User / Email</th>
                  <th className="text-left p-3 font-medium">Primary Workspace</th>
                  <th className="text-left p-3 font-medium">Activation Status</th>
                  <th className="text-left p-3 font-medium">Linked Wallet</th>
                  <th className="text-right p-3 font-medium">Last Active / Signed In</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u: any) => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    {/* User & Email */}
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <div className={"w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs " + (u.isAdmin ? "bg-purple-500/20 text-purple-600" : u.isActivated ? "bg-green-500/10 text-green-600" : "bg-amber-500/15 text-amber-600")}>
                          {(u.email || "U").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-xs text-foreground">
                              {u.email || <span className="text-muted-foreground italic">no email</span>}
                            </span>
                            {u.isAdmin && (
                              <Badge variant="outline" className="text-[9px] bg-purple-500/10 text-purple-600 border-purple-500/20 font-bold px-1.5 py-0">
                                ADMIN
                              </Badge>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">ID: {u.id.slice(0, 8)}...</span>
                        </div>
                      </div>
                    </td>

                    {/* Workspace */}
                    <td className="p-3 text-xs">
                      {u.primaryTeam ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-foreground">{u.primaryTeam.name}</span>
                            <Badge variant="outline" className="text-[9px] font-mono uppercase px-1 py-0">
                              {u.primaryTeam.platformTier}
                            </Badge>
                          </div>
                          <p className="text-[10px] text-muted-foreground font-mono">slug: {u.primaryTeam.slug}</p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic text-xs">No Workspace</span>
                      )}
                    </td>

                    {/* Activation Status */}
                    <td className="p-3">
                      {u.isAdmin ? (
                        <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-600 border-purple-500/30 font-medium">
                          <Shield className="w-3 h-3 mr-1" /> Platform Admin
                        </Badge>
                      ) : u.isActivated ? (
                        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-500 border-green-500/20 font-medium">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Activated
                        </Badge>
                      ) : (
                        <div className="space-y-1">
                          <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-500 border-amber-500/30 font-semibold animate-pulse">
                            <Clock className="w-3 h-3 mr-1" /> Needs Activation Key
                          </Badge>
                          <p className="text-[10px] text-amber-500/80">Outsider / Pending</p>
                        </div>
                      )}
                    </td>

                    {/* Wallet */}
                    <td className="p-3 text-xs text-muted-foreground">
                      {u.walletAddress ? (
                        <div className="flex items-center gap-1 font-mono text-[11px]">
                          <span>{u.walletAddress.slice(0, 6)}...{u.walletAddress.slice(-4)}</span>
                          <button onClick={() => copyToClipboard(u.walletAddress)} className="text-muted-foreground hover:text-foreground">
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      ) : u.stellarWalletAddress ? (
                        <div className="flex items-center gap-1 font-mono text-[11px]">
                          <span>{u.stellarWalletAddress.slice(0, 6)}...{u.stellarWalletAddress.slice(-4)}</span>
                          <button onClick={() => copyToClipboard(u.stellarWalletAddress)} className="text-muted-foreground hover:text-foreground">
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      ) : u.solanaWalletAddress ? (
                        <div className="flex items-center gap-1 font-mono text-[11px]">
                          <span>{u.solanaWalletAddress.slice(0, 6)}...{u.solanaWalletAddress.slice(-4)}</span>
                          <button onClick={() => copyToClipboard(u.solanaWalletAddress)} className="text-muted-foreground hover:text-foreground">
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic text-[11px]">No wallet</span>
                      )}
                    </td>

                    {/* Dates */}
                    <td className="p-3 text-right text-xs text-muted-foreground">
                      <div>{new Date(u.lastSeenAt || u.createdAt).toLocaleDateString()}</div>
                      <span className="text-[10px] text-muted-foreground/80">
                        Joined {new Date(u.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {u.email && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(u.email)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            title="Copy email"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {!u.isActivated && !u.isAdmin && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={activatingUserId === u.id}
                            onClick={() => onQuickActivate(u.id)}
                            className="h-7 px-2 text-[11px] border-green-500/30 text-green-600 hover:bg-green-500/10 gap-1"
                            title="Instantly activate workspace without needing key"
                          >
                            {activatingUserId === u.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            Activate
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => onOpenSendKey(u.email || "")}
                          className="h-7 px-2.5 text-[11px] bg-brand hover:bg-brand-dark text-primary-foreground gap-1"
                          title="Generate and send key from hello@arcenpay.com"
                        >
                          <Key className="w-3 h-3" /> Send Key
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground text-xs">
                      No users match the selected filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TeamsTab({ teams, total, search, setSearch, tier, setTier, activated, setActivated, selectedTeam, setSelectedTeam, hdrs }: any) {
  const loadDetail = async (id: string) => {
    const r = await apiFetch("/api/admin/users/teams/" + id, { headers: hdrs() });
    if (r.ok) { const d = await r.json(); if (d.ok) setSelectedTeam(d.data); }
  };
  const filtered = teams.filter((t: any) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.slug.toLowerCase().includes(search.toLowerCase())) return false;
    if (tier && t.platformTier !== tier) return false;
    if (activated === "true" && !t.isPlatformActivated) return false;
    if (activated === "false" && t.isPlatformActivated) return false;
    return true;
  });
  if (selectedTeam) {
    return (
      <Card>
        <CardHeader><div className="flex items-center justify-between">
          <CardTitle className="text-sm">{selectedTeam.name}
            <Badge variant="outline" className="ml-2 text-[9px]">{selectedTeam.platformTier}</Badge>
            {selectedTeam.isPlatformActivated && <CheckCircle2 className="w-3.5 h-3.5 inline ml-1.5 text-green-500" />}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setSelectedTeam(null)}>Back</Button>
        </div></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div><span className="text-muted-foreground">Slug:</span> {selectedTeam.slug}</div>
            <div><span className="text-muted-foreground">Tier:</span> {selectedTeam.platformTier}</div>
            <div><span className="text-muted-foreground">Activated:</span> {selectedTeam.isPlatformActivated ? "Yes" : "No"}</div>
            <div><span className="text-muted-foreground">Billing:</span> {selectedTeam.allowPlatformBilling ? "Allowed" : "Blocked"}</div>
            <div><span className="text-muted-foreground">Members:</span> {selectedTeam._count?.members || 0}</div>
            <div><span className="text-muted-foreground">Envs:</span> {selectedTeam._count?.environments || 0}</div>
            <div><span className="text-muted-foreground">Created:</span> {new Date(selectedTeam.createdAt).toLocaleDateString()}</div>
            {selectedTeam.activationKeyId && <div><span className="text-muted-foreground">Key ID:</span> <code>{selectedTeam.activationKeyId}</code></div>}
          </div>
          {selectedTeam.members?.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-2">Members ({selectedTeam.members.length})</p>
              {selectedTeam.members.map((m: any) => (
                <div key={m.id} className="flex items-center gap-2 text-xs p-2 rounded bg-muted/20 mb-1">
                  <span>{m.user?.email || "No email"}</span>
                  {m.role && <Badge variant="outline" className="text-[8px]">{m.role}</Badge>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search teams..." className="pl-9 h-10" />
        </div>
        <select value={tier} onChange={(e) => setTier(e.target.value)} className="h-10 px-3 rounded-lg bg-background border border-border text-sm">
          <option value="">All Tiers</option><option value="FREE">FREE</option><option value="PLUS">PLUS</option><option value="PRO">PRO</option>
        </select>
        <select value={activated} onChange={(e) => setActivated(e.target.value)} className="h-10 px-3 rounded-lg bg-background border border-border text-sm">
          <option value="">All</option><option value="true">Activated</option><option value="false">Not Activated</option>
        </select>
        <span className="text-xs text-muted-foreground">{total} teams</span>
      </div>
      <div className="grid gap-2">
        {filtered.map((t: any) => (
          <div key={t.id} onClick={() => loadDetail(t.id)}
            className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/30 cursor-pointer">
            <div className="flex items-center gap-3">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t.name}</span>
              <Badge variant="outline" className="text-[9px]">{t.platformTier}</Badge>
              {t.isPlatformActivated && <CheckCircle2 className="w-3 h-3 text-green-500" />}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{t._count?.members || 0} members</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center py-8 text-muted-foreground">No teams found</p>}
      </div>
    </>
  );
}

function KeysTab({ keys, search, setSearch, statusFilter, setStatusFilter, setShowCreateKey, setEmailKeyId, setShowEmailKey, loadAll, hdrs }: any) {
  const revokeKey = async (id: string) => {
    if (!confirm("Revoke this key?")) return;
    const r = await apiFetch("/api/admin/activation-keys/" + id + "/revoke", { method: "POST", headers: hdrs(), body: JSON.stringify({ reason: "Revoked by admin" }) });
    const d = await r.json();
    if (d.ok) { toast.success("Revoked"); loadAll(); } else toast.error(d.error);
  };
  const copyKey = (k: string) => { navigator.clipboard.writeText(k); toast.success("Copied!"); };
  const filtered = keys.filter((k: any) => {
    if (statusFilter !== "ALL" && k.status !== statusFilter) return false;
    if (search && !k.name.toLowerCase().includes(search.toLowerCase()) && !k.key.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  return (
    <>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search keys..." className="pl-9 h-10" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 px-3 rounded-lg bg-background border border-border text-sm">
            <option value="ALL">All</option><option value="ACTIVE">Active</option><option value="EXHAUSTED">Exhausted</option><option value="REVOKED">Revoked</option><option value="EXPIRED">Expired</option>
          </select>
        </div>
        <Button size="sm" onClick={() => setShowCreateKey(true)} className="bg-brand hover:bg-brand-dark text-primary-foreground shrink-0">
          <Plus className="w-4 h-4 mr-1" /> Create Key
        </Button>
      </div>
      <div className="grid gap-2">
        {filtered.map((k: any) => (
          <div key={k.id} className="p-3 rounded-lg border border-border bg-card hover:bg-muted/20">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{k.name}</span>
                  <Badge variant="outline" className={"text-[9px] " + (k.tier==="FREE"?"bg-blue-500/10 text-blue-500":k.tier==="PLUS"?"bg-purple-500/10 text-purple-500":"bg-amber-500/10 text-amber-500")}>{k.tier}</Badge>
                  <span className={"px-1.5 py-0.5 rounded text-[9px] font-bold uppercase " + (k.status==="ACTIVE"?"bg-green-500/10 text-green-500":k.status==="EXHAUSTED"?"bg-yellow-500/10 text-yellow-500":"bg-red-500/10 text-red-500")}>{k.status}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{k.key}</code>
                  <button onClick={() => copyKey(k.key)}><Copy className="w-3 h-3" /></button>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                  <span>{k.usedCount}/{k.maxUses}</span>
                  {k.recipientEmail && <span>{k.recipientEmail}</span>}
                  {k.expiresAt && <span>Exp {new Date(k.expiresAt).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => { setEmailKeyId(k.id); setShowEmailKey(true); }}><Mail className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="sm" onClick={() => copyKey(k.key)}><Copy className="w-3.5 h-3.5" /></Button>
                {k.status === "ACTIVE" && <Button variant="ghost" size="sm" onClick={() => revokeKey(k.id)}><XCircle className="w-3.5 h-3.5 text-red-500" /></Button>}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center py-8 text-muted-foreground text-sm">No keys found</p>}
      </div>
    </>
  );
}

function OnChainTab({ duneConfigured, duneQ1, duneV1, duneQ2, duneV2, setDuneQ1, setDuneV1, setDuneQ2, setDuneV2, activeEmbed, setActiveEmbed, onSave }: any) {
  const url1 = duneQ1 && duneV1 ? "https://dune.com/embeds/" + duneQ1 + "/" + duneV1 : null;
  const url2 = duneQ2 && duneV2 ? "https://dune.com/embeds/" + duneQ2 + "/" + duneV2 : null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm flex items-center gap-2">
        <Globe className="w-4 h-4 text-brand" /> On-Chain Analytics
        <Badge variant="outline" className="ml-2">{duneConfigured ? <><CheckCircle2 className="w-3 h-3 text-green-500 mr-1" />Dune Ready</> : <><Info className="w-3 h-3 text-yellow-500 mr-1" />Configure Dune API Key</>}</Badge>
      </CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Embed live on-chain data from Dune Analytics at <a href="https://dune.com" target="_blank" className="text-brand hover:underline">dune.com</a>. 
          Create SQL queries for ArcenPay contracts then paste the IDs.
        </p>
        <div className="bg-muted/20 border border-border rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium flex items-center gap-2"><Zap className="w-3.5 h-3.5 text-brand" />Dune SQL Templates</p>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Subscribers Over Time</summary>
            <pre className="mt-1 p-2 bg-background rounded text-[10px] overflow-x-auto">SELECT DATE_TRUNC('day', block_time) AS day, COUNT(*) AS mints FROM bot_mainnet.SubscriptionRegistry_evt_SubscriptionMinted GROUP BY 1 ORDER BY 1</pre>
          </details>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Fees Collected (USDT)</summary>
            <pre className="mt-1 p-2 bg-background rounded text-[10px] overflow-x-auto">SELECT DATE_TRUNC('day', block_time) AS day, SUM(value/1e6) AS total_usdt FROM bot_mainnet.FeeCollector_evt_FeesCollected GROUP BY 1 ORDER BY 1</pre>
          </details>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-muted-foreground font-medium">Embed 1 — Query ID</label><Input value={duneQ1} onChange={e => setDuneQ1(e.target.value)} className="mt-1" placeholder="3493826" /></div>
          <div><label className="text-xs text-muted-foreground font-medium">Embed 1 — Viz ID</label><Input value={duneV1} onChange={e => setDuneV1(e.target.value)} className="mt-1" placeholder="238460" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-muted-foreground font-medium">Embed 2 — Query ID</label><Input value={duneQ2} onChange={e => setDuneQ2(e.target.value)} className="mt-1" placeholder="3493827" /></div>
          <div><label className="text-xs text-muted-foreground font-medium">Embed 2 — Viz ID</label><Input value={duneV2} onChange={e => setDuneV2(e.target.value)} className="mt-1" placeholder="238461" /></div>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={onSave} className="bg-brand hover:bg-brand-dark text-primary-foreground"><Database className="w-4 h-4 mr-1" /> Save Embeds</Button>
          <div className="flex gap-1">
            <Button variant={activeEmbed === 1 ? "default" : "outline"} size="sm" onClick={() => setActiveEmbed(1)}>Embed 1</Button>
            <Button variant={activeEmbed === 2 ? "default" : "outline"} size="sm" onClick={() => setActiveEmbed(2)}>Embed 2</Button>
          </div>
        </div>
        {activeEmbed === 1 && url1 && <div className="border border-border rounded-xl overflow-hidden"><iframe src={url1} width="100%" height="500" style={{ border: 0, background: "#0a0a0a" }} /></div>}
        {activeEmbed === 2 && url2 && <div className="border border-border rounded-xl overflow-hidden"><iframe src={url2} width="100%" height="500" style={{ border: 0, background: "#0a0a0a" }} /></div>}
        {activeEmbed === 1 && !url1 && <div className="p-8 text-center border border-dashed rounded-xl text-muted-foreground"><Globe className="w-8 h-8 mx-auto mb-2 opacity-60" /><p className="text-sm">Enter query &amp; viz IDs to preview</p></div>}
      </CardContent>
    </Card>
  );
}

function EmailTab({ keys, setEmailKeyId, setShowEmailKey, setShowBulkEmail, hdrs }: any) {
  const active = keys.filter((k: any) => k.status === "ACTIVE" && k.usedCount < k.maxUses).slice(0, 5);
  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-sm"><Send className="w-4 h-4 inline mr-1.5 text-brand" />Send Key to Email</CardTitle></CardHeader>
        <CardContent>
          {active.length === 0 ? <p className="text-xs text-muted-foreground">No active keys with capacity.</p> : active.map((k: any) => (
            <div key={k.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20 mb-2">
              <div><div className="flex items-center gap-2 text-sm"><span className="font-medium">{k.name}</span><Badge variant="outline" className="text-[9px]">{k.tier}</Badge></div><code className="text-[10px] font-mono text-muted-foreground">{k.key}</code></div>
              <Button variant="outline" size="sm" onClick={() => { setEmailKeyId(k.id); setShowEmailKey(true); }}><Send className="w-3.5 h-3.5 mr-1" />Send</Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm"><Users className="w-4 h-4 inline mr-1.5 text-brand" />Bulk Email — Free Plan</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">Send FREE plan activation key to all unactivated teams with contact emails.</p>
          <Button onClick={() => setShowBulkEmail(true)} className="bg-brand hover:bg-brand-dark text-primary-foreground"><Send className="w-4 h-4 mr-1.5" />Send Bulk Email</Button>
        </CardContent>
      </Card>
    </>
  );
}

function CreateKeyModal({ form, setForm, creating, setCreating, onClose, onCreated, hdrs }: any) {
  const handleCreate = async () => {
    if (!form.name.trim()) return toast.error("Name required");
    setCreating(true);
    const body: any = { name: form.name, tier: form.tier, maxUses: form.maxUses, allowPlatformBilling: form.allowPlatformBilling };
    if (form.email) body.recipientEmail = form.email;
    if (form.notes) body.notes = form.notes;
    if (form.expiresDays) body.expiresAt = new Date(Date.now() + parseInt(form.expiresDays) * 86400000).toISOString();
    const r = await apiFetch("/api/admin/activation-keys", { method: "POST", headers: hdrs(), body: JSON.stringify(body) });
    const d = await r.json();
    if (d.ok) { toast.success("Key created: " + d.data.key); onCreated(); } else toast.error(d.error || "Failed");
    setCreating(false);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold flex items-center gap-2"><Sparkles className="w-5 h-5 text-brand" /> Create Key</h2>
        <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Key name *" />
        <div className="grid grid-cols-2 gap-3">
          <select value={form.tier} onChange={e => setForm({...form, tier: e.target.value})} className="w-full h-10 px-3 rounded-lg bg-background border border-border text-sm">
            <option value="FREE">FREE</option><option value="PLUS">PLUS</option><option value="PRO">PRO</option>
          </select>
          <Input type="number" value={form.maxUses} onChange={e => setForm({...form, maxUses: parseInt(e.target.value) || 1})} placeholder="Max uses" />
        </div>
        <Input value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="Recipient email" />
        <div className="grid grid-cols-2 gap-3">
          <Input type="number" value={form.expiresDays} onChange={e => setForm({...form, expiresDays: e.target.value})} placeholder="Expires in days" />
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={form.allowPlatformBilling} onChange={e => setForm({...form, allowPlatformBilling: e.target.checked})} /> Allow Billing</label>
        </div>
        <Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Notes" />
        <div className="flex gap-3 pt-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={handleCreate} disabled={creating||!form.name.trim()} className="flex-1 bg-brand hover:bg-brand-dark text-primary-foreground">
            {creating ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Creating...</> : "Create Key"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmailKeyModal({ keyId, keys, to, setTo, subject, setSubject, sending, setSending, onClose, hdrs }: any) {
  const handleSend = async () => {
    if (!to) return toast.error("Enter email");
    setSending(true);
    const r = await apiFetch("/api/admin/activation-keys/send-email", { method: "POST", headers: hdrs(), body: JSON.stringify({ keyId, to, subject: subject || undefined }) });
    const d = await r.json();
    if (d.ok) { toast.success(d.message); onClose(); } else toast.error(d.error);
    setSending(false);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold"><Send className="w-5 h-5 inline mr-2 text-brand" />Send Key</h2>
        <p className="text-xs text-muted-foreground">Key: {keys.find((k: any) => k.id === keyId)?.key}</p>
        <Input value={to} onChange={e => setTo(e.target.value)} placeholder="Recipient email" />
        <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject (optional)" />
        <div className="flex gap-3 pt-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={handleSend} disabled={sending||!to} className="flex-1 bg-brand hover:bg-brand-dark text-primary-foreground">
            {sending ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Sending...</> : "Send Email"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BulkEmailModal({ onClose, hdrs }: any) {
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const handleBulk = async () => {
    setSending(true);
    const r = await apiFetch("/api/admin/activation-keys/bulk-email-free", { method: "POST", headers: hdrs(), body: JSON.stringify({ subject: subject||undefined, message: message||undefined }) });
    const d = await r.json();
    if (d.ok) { toast.success("Sent to " + d.sentCount + " recipients"); onClose(); } else toast.error(d.error);
    setSending(false);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold"><Users className="w-5 h-5 inline mr-2 text-brand" />Bulk Email</h2>
        <p className="text-xs text-muted-foreground">Send FREE activation key to unactivated teams with contact emails.</p>
        <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject (optional)" />
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={2} className="w-full p-3 rounded-lg bg-background border border-border text-sm resize-none" placeholder="Custom message" />
        <div className="flex gap-3 pt-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
          <Button onClick={handleBulk} disabled={sending} className="flex-1 bg-brand hover:bg-brand-dark text-primary-foreground">
            {sending ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Sending...</> : "Send Bulk Email"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DirectKeyModal({ initialEmail, onClose, onSent, hdrs }: any) {
  const [email, setEmail] = useState(initialEmail || "");
  const [tier, setTier] = useState<"FREE" | "PLUS" | "PRO">("PRO");
  const [maxUses, setMaxUses] = useState(1);
  const [notes, setNotes] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !email.includes("@")) {
      return toast.error("Please provide a valid recipient email");
    }
    setSending(true);
    try {
      const res = await apiFetch("/api/admin/users/send-activation-key", {
        method: "POST",
        headers: hdrs(),
        body: JSON.stringify({
          email: email.trim(),
          tier,
          maxUses,
          notes: notes.trim() || undefined,
          customMessage: customMessage.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(data.message || "Activation key sent successfully!");
        onSent();
      } else {
        toast.error(data.error || "Failed to send activation key");
      }
    } catch {
      toast.error("Network error while sending activation key");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl text-foreground" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-brand/10 text-brand"><Key className="w-5 h-5" /></span>
            <div>
              <h3 className="text-base font-bold">Issue & Email Activation Key</h3>
              <p className="text-xs text-muted-foreground">Sent from <span className="font-mono text-indigo-500 font-semibold">hello@arcenpay.com</span></p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm font-bold">&times;</button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label className="font-semibold block mb-1">Recipient Email *</label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="text-xs h-9"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">Platform Tier</label>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value as any)}
                className="w-full h-9 px-3 rounded-md bg-background border border-border text-xs"
              >
                <option value="PRO">PRO (Recommended)</option>
                <option value="PLUS">PLUS</option>
                <option value="FREE">FREE</option>
              </select>
            </div>
            <div>
              <label className="font-semibold block mb-1">Max Workspaces</label>
              <Input
                type="number"
                min={1}
                max={50}
                value={maxUses}
                onChange={(e) => setMaxUses(parseInt(e.target.value || "1", 10))}
                className="text-xs h-9"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold block mb-1">Internal Note (optional)</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. VIP onboarding invite / requested access"
              className="text-xs h-9"
            />
          </div>

          <div>
            <label className="font-semibold block mb-1">Custom Message in Email (optional)</label>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              rows={3}
              placeholder="Optional greeting or instructions shown in the email..."
              className="w-full p-2.5 rounded-md bg-background border border-border text-xs resize-none"
            />
          </div>

          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 text-[11px] text-muted-foreground leading-relaxed">
            <p className="font-semibold text-indigo-400 mb-0.5 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> High-Contrast Enterprise Template
            </p>
            The user receives an email from <strong>hello@arcenpay.com</strong> with their unique key and a 1-click &ldquo;Activate Workspace&rdquo; button.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={sending} className="text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={sending || !email.trim()}
            className="text-xs bg-brand hover:bg-brand-dark text-primary-foreground gap-1.5"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {sending ? "Sending..." : "Send Activation Key"}
          </Button>
        </div>
      </div>
    </div>
  );
}
