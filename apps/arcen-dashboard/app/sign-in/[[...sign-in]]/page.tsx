import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";

export default function SignInPage() {
  return (
    <AuthShell
      mode="sign-in"
      title="Welcome Back"
      description="Enter your email and password to access your account."
    >
      <SignInForm />
    </AuthShell>
  );
}
