"use client";
import { apiFetch } from "@/lib/api-client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Globe,
  Loader2,
  Mail,
  User,
  ArrowRight,
  MapPin,
  Phone,
  ReceiptText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { isPlatformAdminEmail } from "@/lib/admin";

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
    apiFetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (
          !data?.user?.id ||
          (!data?.user?.walletAddress &&
            !data?.user?.stellarWalletAddress &&
            !data?.user?.solanaWalletAddress)
        ) {
          router.replace("/login");
          return;
        }
        const isAdmin =
          data?.user?.isPlatformAdmin === true ||
          isPlatformAdminEmail(data?.user?.email);
        const isActivated =
          isAdmin || data?.currentTeam?.isPlatformActivated === true;
        const keyStatus = data?.currentTeam?.activationKeyStatus;
        const isExpiredOrRevoked = keyStatus === "EXPIRED" || keyStatus === "REVOKED";
        if (!isActivated && !isExpiredOrRevoked) {
          router.replace("/onboarding/activation");
        }
      })
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    apiFetch("/api/provider/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((profileData) => {
        if (profileData) {
          setProviderName(profileData.providerName || "");
          setWebsite(profileData.website || "");
          setContactEmail(profileData.contactEmail || "");
          setLegalName(profileData.legalName || "");
          setBillingEmail(profileData.billingEmail || "");
          setSupportEmail(profileData.supportEmail || "");
          setSupportPhone(profileData.supportPhone || "");
          setSupportUrl(profileData.supportUrl || "");
          setAddressLine1(profileData.addressLine1 || "");
          setAddressLine2(profileData.addressLine2 || "");
          setCity(profileData.city || "");
          setStateProvince(profileData.state || "");
          setPostalCode(profileData.postalCode || "");
          setCountry(profileData.country || "");
          setTaxId(profileData.taxId || "");
          setGstin(profileData.gstin || "");
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

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
      const res = await apiFetch("/api/provider/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to save profile");
      }
      toast.success("Workspace profile saved");
      router.replace("/onboarding/environment");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <OnboardingShell
      step={2}
      stepTitle="Workspace Profile"
      stepDescription="Complete your business profile."
    >
      <div className="max-w-lg">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-[28px] font-semibold text-foreground tracking-tight">
            Business Details
          </h1>
          <p className="text-base text-muted-foreground mt-3 leading-relaxed">
            These details identify your business to customers across checkout pages, invoices, and receipts.
          </p>
        </div>

        <div className="space-y-6">
          {/* Provider Name */}
          <div className="space-y-2">
            <Label htmlFor="provider-name" className="text-sm font-medium text-foreground">
              Provider Name <span className="text-red-500">*</span>
            </Label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="provider-name"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                placeholder="Acme Labs, Inc."
                className="pl-10 h-11 bg-background border-input focus-visible:ring-brand text-foreground"
                autoFocus
              />
            </div>
          </div>

          {/* Website & Contact Email */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="website" className="text-sm font-medium text-foreground">
                Website
              </Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://acmelabs.com"
                  className={`pl-10 h-11 bg-background border-input focus-visible:ring-brand text-foreground ${
                    website && !isValidUrl(website) ? "border-red-500 focus-visible:ring-red-500" : ""
                  }`}
                />
              </div>
              {website && !isValidUrl(website) && (
                <p className="text-xs text-red-500 mt-1">Must start with http:// or https://</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact-email" className="text-sm font-medium text-foreground">
                Contact Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="contact-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="hello@acmelabs.com"
                  className="pl-10 h-11 bg-background border-input focus-visible:ring-brand text-foreground"
                />
              </div>
            </div>
          </div>

          {/* Legal Name & Billing Email */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="legal-name" className="text-sm font-medium text-foreground">
                Legal Business Name
              </Label>
              <div className="relative">
                <ReceiptText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="legal-name"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="Acme Labs Inc."
                  className="pl-10 h-11 bg-background border-input focus-visible:ring-brand text-foreground"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="billing-email" className="text-sm font-medium text-foreground">
                Billing Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="billing-email"
                  type="email"
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value)}
                  placeholder="billing@acmelabs.com"
                  className="pl-10 h-11 bg-background border-input focus-visible:ring-brand text-foreground"
                />
              </div>
            </div>
          </div>

          {/* Support Email & Support Phone */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="support-email" className="text-sm font-medium text-foreground">
                Support Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="support-email"
                  type="email"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                  placeholder="support@acmelabs.com"
                  className="pl-10 h-11 bg-background border-input focus-visible:ring-brand text-foreground"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="support-phone" className="text-sm font-medium text-foreground">
                Support Phone
              </Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="support-phone"
                  value={supportPhone}
                  onChange={(e) => setSupportPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="pl-10 h-11 bg-background border-input focus-visible:ring-brand text-foreground"
                />
              </div>
            </div>
          </div>

          {/* Support site URL */}
          <div className="space-y-2">
            <Label htmlFor="support-url" className="text-sm font-medium text-foreground">
              Support Site URL
            </Label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="support-url"
                value={supportUrl}
                onChange={(e) => setSupportUrl(e.target.value)}
                placeholder="https://help.acmelabs.com"
                className="pl-10 h-11 bg-background border-input focus-visible:ring-brand text-foreground"
              />
            </div>
          </div>

          {/* Collapsible Billing Identity */}
          <div>
            <button
              type="button"
              onClick={() => setShowBilling(!showBilling)}
              className="flex w-full items-center justify-between py-3 text-sm font-medium hover:text-foreground transition-colors"
            >
              <span className="flex items-center gap-2.5 text-sm font-medium text-foreground">
                <MapPin className="h-4 w-4 text-brand" />
                Billing Identity &amp; Tax Info
              </span>
              {showBilling ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {showBilling && (
              <div className="pt-4 pb-2 space-y-5 border-t border-border">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Enter address and local compliance credentials to stamp outgoing invoices.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="address1" className="text-xs text-muted-foreground font-medium">Address Line 1</Label>
                    <Input
                      id="address1"
                      value={addressLine1}
                      onChange={(e) => setAddressLine1(e.target.value)}
                      placeholder="123 Main Street"
                      className="bg-background border-input text-foreground h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address2" className="text-xs text-muted-foreground font-medium">Address Line 2</Label>
                    <Input
                      id="address2"
                      value={addressLine2}
                      onChange={(e) => setAddressLine2(e.target.value)}
                      placeholder="Suite 400"
                      className="bg-background border-input text-foreground h-10"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="city" className="text-xs text-muted-foreground font-medium">City</Label>
                    <Input
                      id="city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="San Francisco"
                      className="bg-background border-input text-foreground h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state" className="text-xs text-muted-foreground font-medium">State / Province</Label>
                    <Input
                      id="state"
                      value={stateProvince}
                      onChange={(e) => setStateProvince(e.target.value)}
                      placeholder="CA"
                      className="bg-background border-input text-foreground h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="postal" className="text-xs text-muted-foreground font-medium">Postal Code</Label>
                    <Input
                      id="postal"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      placeholder="94105"
                      className="bg-background border-input text-foreground h-10"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="country" className="text-xs text-muted-foreground font-medium">Country (2-letter)</Label>
                    <Input
                      id="country"
                      value={country}
                      onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                      placeholder="US"
                      maxLength={2}
                      className="bg-background border-input text-foreground h-10 font-mono text-center"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tax-id" className="text-xs text-muted-foreground font-medium">Tax ID / EIN</Label>
                    <Input
                      id="tax-id"
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                      placeholder="XX-XXXXXXX"
                      className="bg-background border-input text-foreground h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gstin" className="text-xs text-muted-foreground font-medium">GSTIN</Label>
                    <Input
                      id="gstin"
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value.toUpperCase())}
                      placeholder="22AAAAA0000A1Z5"
                      className="bg-background border-input text-foreground h-10 font-mono"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500 font-medium mt-4">{error}</p>
        )}

        <div className="flex justify-end gap-3 pt-8 border-t border-border mt-10">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.replace("/onboarding/environment")}
            className="text-muted-foreground hover:text-foreground"
          >
            Skip for now
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={submitting || !providerName.trim()}
            className="min-w-[140px] bg-brand hover:bg-brand-dark text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Save &amp; Continue
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </OnboardingShell>
  );
}
