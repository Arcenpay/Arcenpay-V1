import { Clock3 } from "lucide-react";

export default function WaitingForEnvironmentPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
          <Clock3 className="h-6 w-6 text-foreground" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-foreground">
          Waiting for an environment
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          An owner or admin needs to create the first workspace environment before this dashboard can be used.
        </p>
      </div>
    </div>
  );
}
