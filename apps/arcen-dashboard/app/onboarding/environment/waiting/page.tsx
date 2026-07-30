import { Clock3 } from "lucide-react";

export default function WaitingForEnvironmentPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
          <Clock3 className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="mt-6 text-[28px] font-semibold text-foreground tracking-tight">
          Waiting for an environment
        </h1>
        <p className="mt-3 text-base text-muted-foreground leading-relaxed">
          An owner or admin needs to create the first workspace environment before this dashboard can be used.
        </p>
      </div>
    </div>
  );
}
