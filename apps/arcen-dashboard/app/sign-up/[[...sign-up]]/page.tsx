import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";

export default function SignUpPage() {
  return (
    <AuthShell
      mode="sign-up"
      title="Create Account"
      description="Set your credentials to get started."
    >
      <SignUpForm />
    </AuthShell>
  );
}
