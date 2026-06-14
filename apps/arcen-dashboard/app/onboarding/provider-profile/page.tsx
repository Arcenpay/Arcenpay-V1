"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CheckCircle2,
  Globe,
  Loader2,
  Mail,
  User,
  ArrowRight,
  MapPin,
  Phone,
  ReceiptText,
  Hash,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function ProviderProfilePage() {
  const router = useRouter();
  const [providerName, setProviderName] = useState("");
  const [website, setWebsite] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [legalName, setLegalName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [supportUrl, setSupportUrl] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateProvince, setStateProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [taxId, setTaxId] = useState("");
  const [gstin, setGstin] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showBilling, setShowBilling] = useState(false);

  useEffect(() => {
    fetch("/api/provider/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.providerName || data?.contactEmail) {
          router.replace("/onboarding/environment");
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [router]);

  const isValidUrl = (url: string) => !url || /^https?:\/\/.+/.test(url);
  const isValidEmail = (email: string) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  async function handleSave() {
    if (!providerName.trim()) {
      setError("Provider name is required");
      return;
    }
    if (website && !isValidUrl(website)) {
      setError("Website must start with http:// or https://");
      return;
    }
    if (supportUrl && !isValidUrl(supportUrl)) {
      setError("Support URL must start with http:// or https://");
      return;
    }
    if (contactEmail && !isValidEmail(contactEmail)) {
      setError("Invalid contact email format");
      return;
    }
    if (billingEmail && !isValidEmail(billingEmail)) {
      setError("Invalid billing email format");
      return;
    }
    if (supportEmail && !isValidEmail(supportEmail)) {
      setError("Invalid support email format");
      return;
    }
    if (country && country.length !== 2) {
      setError("Country code must be 2 characters (e.g., US, IN)");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string | undefined> = {
        providerName: providerName.trim(),
        website: website.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        legalName: legalName.trim() || undefined,
        billingEmail: billingEmail.trim() || undefined,
        supportEmail: supportEmail.trim() || undefined,
        supportPhone: supportPhone.trim() || undefined,
        supportUrl: supportUrl.trim() || undefined,
        addressLine1: addressLine1.trim() || undefined,
        addressLine2: addressLine2.trim() || undefined,
        city: city.trim() || undefined,
        state: stateProvince.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        country: country.trim().toUpperCase() || undefined,
        taxId: taxId.trim() || undefined,
        gstin: gstin.trim().toUpperCase() || undefined,
      };
      const res = await fetch("/api/provider/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to save profile");
      }
      toast.success("Provider profile saved");
      router.replace("/onboarding/environment");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
        <div className="grid md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="border-b border-border bg-secondary/40 p-8 md:border-b-0 md:border-r">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10">
                <Building2 className="h-6 w-6 text-emerald-500" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Provider Profile</h1>
                <p className="text-sm text-muted-foreground">Set up your business identity</p>
              </div>
            </div>

            <div className="mt-8 space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/70 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-foreground">Why this matters</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Your provider details appear on checkout pages, invoices, tax documents, and customer communications.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/70 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-blue-500 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-foreground">Update anytime</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    All fields can be changed later in Settings → Provider.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/70 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-amber-500 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-foreground">Only name is required</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Provider name is mandatory. Fill billing identity details when you&apos;re ready.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-8 md:p-10 overflow-y-auto max-h-[80vh]">
            <div className="flex items-center gap-3">
              <User className="h-5 w-5 text-emerald-500" />
              <h2 className="text-2xl font-semibold text-foreground">Business details</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              These details identify your business to customers across checkout pages, invoices, and receipts.
            </p>

            <div className="mt-6 space-y-5">
              {/* Business Identity */}
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="provider-name" className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Provider name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="provider-name"
                    value={providerName}
                    onChange={(e) => setProviderName(e.target.value)}
                    placeholder="Acme Labs, Inc."
                    autoFocus
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="website" className="flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                      Website
                    </Label>
                    <Input
                      id="website"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://acmelabs.com"
                      className={website && !isValidUrl(website) ? "border-red-500" : ""}
                    />
                    {website && !isValidUrl(website) && (
                      <p className="text-xs text-red-500">Must start with http:// or https://</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-email" className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      Contact email
                    </Label>
                    <Input
                      id="contact-email"
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      placeholder="hello@acmelabs.com"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="legal-name" className="flex items-center gap-1.5">
                      <ReceiptText className="h-3.5 w-3.5 text-muted-foreground" />
                      Legal business name
                    </Label>
                    <Input
                      id="legal-name"
                      value={legalName}
                      onChange={(e) => setLegalName(e.target.value)}
                      placeholder="Acme Labs Inc."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="billing-email" className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      Billing email
                    </Label>
                    <Input
                      id="billing-email"
                      type="email"
                      value={billingEmail}
                      onChange={(e) => setBillingEmail(e.target.value)}
                      placeholder="billing@acmelabs.com"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="support-email" className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      Support email
                    </Label>
                    <Input
                      id="support-email"
                      type="email"
                      value={supportEmail}
                      onChange={(e) => setSupportEmail(e.target.value)}
                      placeholder="support@acmelabs.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="support-phone" className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      Support phone
                    </Label>
                    <Input
                      id="support-phone"
                      value={supportPhone}
                      onChange={(e) => setSupportPhone(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="support-url" className="flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    Support site URL
                  </Label>
                  <Input
                    id="support-url"
                    value={supportUrl}
                    onChange={(e) => setSupportUrl(e.target.value)}
                    placeholder="https://help.acmelabs.com"
                  />
                </div>
              </div>

              {/* Billing Identity — Collapsible */}
              <div className="rounded-xl border border-border/60 bg-secondary/5">
                <button
                  type="button"
                  onClick={() => setShowBilling(!showBilling)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-secondary/20 transition-colors rounded-t-xl"
                >
                  <span className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    Billing Identity
                  </span>
                  {showBilling ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                {showBilling && (
                  <div className="px-4 pb-4 space-y-4">
                    <p className="text-xs text-muted-foreground">
                      Billing address and tax information for invoices and compliance.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="address1">Address Line 1</Label>
                        <Input
                          id="address1"
                          value={addressLine1}
                          onChange={(e) => setAddressLine1(e.target.value)}
                          placeholder="123 Main Street"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="address2">Address Line 2</Label>
                        <Input
                          id="address2"
                          value={addressLine2}
                          onChange={(e) => setAddressLine2(e.target.value)}
                          placeholder="Suite 400"
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="city">City</Label>
                        <Input
                          id="city"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="San Francisco"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="state">State / Province</Label>
                        <Input
                          id="state"
                          value={stateProvince}
                          onChange={(e) => setStateProvince(e.target.value)}
                          placeholder="CA"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="postal">Postal Code</Label>
                        <Input
                          id="postal"
                          value={postalCode}
                          onChange={(e) => setPostalCode(e.target.value)}
                          placeholder="94105"
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="country" className="flex items-center gap-1.5">
                          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                          Country code (2-letter)
                        </Label>
                        <Input
                          id="country"
                          value={country}
                          onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                          placeholder="US"
                          maxLength={2}
                          className="font-mono"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="tax-id">Tax ID</Label>
                        <Input
                          id="tax-id"
                          value={taxId}
                          onChange={(e) => setTaxId(e.target.value)}
                          placeholder="XX-XXXXXXX"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="gstin" className="flex items-center gap-1.5">
                          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                          GSTIN
                        </Label>
                        <Input
                          id="gstin"
                          value={gstin}
                          onChange={(e) => setGstin(e.target.value.toUpperCase())}
                          placeholder="22AAAAA0000A1Z5"
                          className="font-mono"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    router.replace("/onboarding/environment");
                  }}
                >
                  Skip for now
                </Button>
                <Button
                  onClick={() => void handleSave()}
                  disabled={submitting || !providerName.trim()}
                  className="min-w-40"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <ArrowRight className="mr-2 h-4 w-4" />
                      Save &amp; Continue
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
