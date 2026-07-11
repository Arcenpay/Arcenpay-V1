"use client";

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
        if (data) {
          setProviderName(data.providerName || "");
          setWebsite(data.website || "");
          setContactEmail(data.contactEmail || "");
          setLegalName(data.legalName || "");
          setBillingEmail(data.billingEmail || "");
          setSupportEmail(data.supportEmail || "");
          setSupportPhone(data.supportPhone || "");
          setSupportUrl(data.supportUrl || "");
          setAddressLine1(data.addressLine1 || "");
          setAddressLine2(data.addressLine2 || "");
          setCity(data.city || "");
          setStateProvince(data.state || "");
          setPostalCode(data.postalCode || "");
          setCountry(data.country || "");
          setTaxId(data.taxId || "");
          setGstin(data.gstin || "");
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
      const res = await fetch("/api/provider/profile", {
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
    <div className="min-h-screen bg-background flex items-center justify-center p-4 md:p-6 font-sans">
      <div className="w-full max-w-4xl grid md:grid-cols-[280px_1fr] rounded-2xl border border-border bg-card text-card-foreground shadow-lg overflow-hidden">
        
        {/* Left Side: Step Tracker */}
        <div className="border-b border-border bg-muted/40 p-6 md:p-8 md:border-b-0 md:border-r">
          <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
            Onboarding Setup
          </span>
          <h2 className="mt-1.5 text-lg font-semibold text-foreground">Workspace Profile</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Complete your business profile.
          </p>

          <div className="mt-8 space-y-6">
            {/* Step 1 */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-semibold">
                  ✓
                </div>
                <div className="w-0.5 flex-1 bg-border min-h-8 mt-2" />
              </div>
              <div className="pt-0.5">
                <p className="text-xs font-medium text-muted-foreground">Workspace Wallet</p>
                <p className="text-[11px] text-green-600 dark:text-green-500 mt-0.5 font-medium">Linked successfully</p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                  2
                </div>
                <div className="w-0.5 flex-1 bg-border min-h-8 mt-2" />
              </div>
              <div className="pt-0.5">
                <p className="text-xs font-semibold text-foreground">Provider Profile</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Configure details</p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full border border-border bg-muted/50 text-muted-foreground flex items-center justify-center text-xs font-semibold">
                  3
                </div>
              </div>
              <div className="pt-0.5">
                <p className="text-xs font-medium text-muted-foreground">Environment</p>
                <p className="text-[11px] text-muted-foreground/60 mt-0.5">Launch environment</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Form */}
        <div className="p-6 md:p-10 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <User className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold text-foreground">Business Details</h1>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              These details identify your business to customers across checkout pages, invoices, and receipts.
            </p>

            <div className="mt-6 space-y-5">
              {/* Provider Name */}
              <div className="space-y-1.5">
                <Label htmlFor="provider-name" className="text-xs font-medium text-foreground">
                  Provider Name <span className="text-red-500 font-bold">*</span>
                </Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="provider-name"
                    value={providerName}
                    onChange={(e) => setProviderName(e.target.value)}
                    placeholder="Acme Labs, Inc."
                    className="pl-9 bg-background border-input focus-visible:ring-1 focus-visible:ring-ring text-foreground"
                    autoFocus
                  />
                </div>
              </div>

              {/* Website & Contact Email */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="website" className="text-xs font-medium text-foreground">
                    Website
                  </Label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="website"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://acmelabs.com"
                      className={`pl-9 bg-background border-input focus-visible:ring-1 focus-visible:ring-ring text-foreground ${
                        website && !isValidUrl(website) ? "border-destructive focus-visible:ring-destructive" : ""
                      }`}
                    />
                  </div>
                  {website && !isValidUrl(website) && (
                    <p className="text-xs text-destructive mt-1">Must start with http:// or https://</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="contact-email" className="text-xs font-medium text-foreground">
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
                      className="pl-9 bg-background border-input focus-visible:ring-1 focus-visible:ring-ring text-foreground"
                    />
                  </div>
                </div>
              </div>

              {/* Legal Name & Billing Email */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="legal-name" className="text-xs font-medium text-foreground">
                    Legal Business Name
                  </Label>
                  <div className="relative">
                    <ReceiptText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="legal-name"
                      value={legalName}
                      onChange={(e) => setLegalName(e.target.value)}
                      placeholder="Acme Labs Inc."
                      className="pl-9 bg-background border-input focus-visible:ring-1 focus-visible:ring-ring text-foreground"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="billing-email" className="text-xs font-medium text-foreground">
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
                      className="pl-9 bg-background border-input focus-visible:ring-1 focus-visible:ring-ring text-foreground"
                    />
                  </div>
                </div>
              </div>

              {/* Support Email & Support Phone */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="support-email" className="text-xs font-medium text-foreground">
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
                      className="pl-9 bg-background border-input focus-visible:ring-1 focus-visible:ring-ring text-foreground"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="support-phone" className="text-xs font-medium text-foreground">
                    Support Phone
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="support-phone"
                      value={supportPhone}
                      onChange={(e) => setSupportPhone(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className="pl-9 bg-background border-input focus-visible:ring-1 focus-visible:ring-ring text-foreground"
                    />
                  </div>
                </div>
              </div>

              {/* Support site URL */}
              <div className="space-y-1.5">
                <Label htmlFor="support-url" className="text-xs font-medium text-foreground">
                  Support Site URL
                </Label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="support-url"
                    value={supportUrl}
                    onChange={(e) => setSupportUrl(e.target.value)}
                    placeholder="https://help.acmelabs.com"
                    className="pl-9 bg-background border-input focus-visible:ring-1 focus-visible:ring-ring text-foreground"
                  />
                </div>
              </div>

              {/* Collapsible Billing Identity */}
              <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowBilling(!showBilling)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/40 transition-colors"
                >
                  <span className="flex items-center gap-2 text-xs uppercase tracking-wider text-foreground">
                    <MapPin className="h-3.5 w-3.5 text-primary" />
                    Billing Identity &amp; Tax Info
                  </span>
                  {showBilling ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {showBilling && (
                  <div className="px-4 pb-4 pt-1 space-y-4 border-t border-border bg-card/50">
                    <p className="text-xs text-muted-foreground mt-2">
                      Enter address and local compliance credentials to stamp outgoing invoices.
                    </p>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor="address1" className="text-[11px] text-muted-foreground">Address Line 1</Label>
                        <Input
                          id="address1"
                          value={addressLine1}
                          onChange={(e) => setAddressLine1(e.target.value)}
                          placeholder="123 Main Street"
                          className="bg-background border-input text-foreground text-xs h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="address2" className="text-[11px] text-muted-foreground">Address Line 2</Label>
                        <Input
                          id="address2"
                          value={addressLine2}
                          onChange={(e) => setAddressLine2(e.target.value)}
                          placeholder="Suite 400"
                          className="bg-background border-input text-foreground text-xs h-9"
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label htmlFor="city" className="text-[11px] text-muted-foreground">City</Label>
                        <Input
                          id="city"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="San Francisco"
                          className="bg-background border-input text-foreground text-xs h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="state" className="text-[11px] text-muted-foreground">State / Province</Label>
                        <Input
                          id="state"
                          value={stateProvince}
                          onChange={(e) => setStateProvince(e.target.value)}
                          placeholder="CA"
                          className="bg-background border-input text-foreground text-xs h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="postal" className="text-[11px] text-muted-foreground">Postal Code</Label>
                        <Input
                          id="postal"
                          value={postalCode}
                          onChange={(e) => setPostalCode(e.target.value)}
                          placeholder="94105"
                          className="bg-background border-input text-foreground text-xs h-9"
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label htmlFor="country" className="text-[11px] text-muted-foreground">Country Code (2-letter)</Label>
                        <Input
                          id="country"
                          value={country}
                          onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                          placeholder="US"
                          maxLength={2}
                          className="bg-background border-input text-foreground text-xs h-9 font-mono text-center"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="tax-id" className="text-[11px] text-muted-foreground">Tax ID / EIN</Label>
                        <Input
                          id="tax-id"
                          value={taxId}
                          onChange={(e) => setTaxId(e.target.value)}
                          placeholder="XX-XXXXXXX"
                          className="bg-background border-input text-foreground text-xs h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="gstin" className="text-[11px] text-muted-foreground">GSTIN</Label>
                        <Input
                          id="gstin"
                          value={gstin}
                          onChange={(e) => setGstin(e.target.value.toUpperCase())}
                          placeholder="22AAAAA0000A1Z5"
                          className="bg-background border-input text-foreground text-xs h-9 font-mono"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive mt-4 font-semibold">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-6 border-t border-border mt-8">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                router.replace("/onboarding/environment");
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              Skip for now
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={submitting || !providerName.trim()}
              className="min-w-36"
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
        
      </div>
    </div>
  );
}
