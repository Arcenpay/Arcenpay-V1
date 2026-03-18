import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function SsoCallbackPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <AuthenticateWithRedirectCallback />
    </div>
  );
}
