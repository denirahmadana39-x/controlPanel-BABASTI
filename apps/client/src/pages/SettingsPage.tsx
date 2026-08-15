import * as React from "react";
import { useForm } from "react-hook-form";
import { Trash2 } from "lucide-react";
import { useUserProfile, useUpdateProfile, useSessions, useRevokeSession } from "@/hooks/queries";
import { authService } from "@/services/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";

export function SettingsPage() {
  const { data, isLoading } = useUserProfile();
  const { toast } = useToast();

  if (isLoading) return <Skeleton className="h-96" />;
  if (!data) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <ProfileSection defaultName={data.displayName} />
      <SecuritySection hasPassword={!data.connectedAccounts.some((a) => a.provider === "google" && data.connectedAccounts.length === 1)} />
      <ConnectedSection accounts={data.connectedAccounts} />
      <SessionsSection />
    </div>
  );
}

function ProfileSection({ defaultName }: { defaultName: string }) {
  const update = useUpdateProfile();
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { displayName: defaultName } });

  async function onSubmit(values: { displayName: string }) {
    try {
      await update.mutateAsync(values);
      toast("Profile updated", "success");
    } catch (e: any) {
      toast(e instanceof ApiError ? e.message : "Update failed", "error");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Update how your name appears in BabaSTI.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label>Display name</Label>
            <Input {...register("displayName")} className="mt-1" />
            {errors.displayName && (
              <p className="mt-1 text-xs text-destructive">
                {errors.displayName.message}
              </p>
            )}
          </div>
          <Button type="submit" loading={isSubmitting || update.isPending}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SecuritySection({ hasPassword }: { hasPassword: boolean }) {
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm({ defaultValues: { currentPassword: "", newPassword: "" } });

  async function onSubmit(values: { currentPassword: string; newPassword: string }) {
    try {
      await authService.changePassword(values);
      toast("Password changed", "success");
      reset();
    } catch (e: any) {
      toast(e instanceof ApiError ? e.message : "Change failed", "error");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
        <CardDescription>
          {hasPassword
            ? "Change your account password."
            : "This account uses social login."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasPassword ? (
          <form onSubmit={handleSubmit(onSubmit)} className="max-w-sm space-y-4">
            <div>
              <Label>Current password</Label>
              <Input type="password" {...register("currentPassword")} className="mt-1" />
            </div>
            <div>
              <Label>New password</Label>
              <Input type="password" {...register("newPassword")} className="mt-1" />
            </div>
            <Button type="submit" loading={isSubmitting}>
              Update password
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Password management is unavailable for social-only accounts.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectedSection({
  accounts,
}: {
  accounts: { provider: string; connectedAt: string }[];
}) {
  const providers = ["google", "github"];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected Accounts</CardTitle>
        <CardDescription>Accounts linked to your BabaSTI login.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {providers.map((p) => {
          const connected = accounts.find((a) => a.provider === p);
          return (
            <div
              key={p}
              className="flex items-center justify-between rounded-md border border-border p-3"
            >
              <span className="capitalize">{p}</span>
              {connected ? (
                <span className="text-sm text-success">Connected</span>
              ) : (
                <a href={`/api/auth/${p}`}>
                  <Button size="sm" variant="outline">
                    Connect
                  </Button>
                </a>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function SessionsSection() {
  const { data, isLoading } = useSessions();
  const revoke = useRevokeSession();
  const { toast } = useToast();

  if (isLoading) return <Skeleton className="h-48" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Devices currently signed in to your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(data?.items ?? []).map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-md border border-border p-3"
          >
            <div>
              <p className="text-sm font-medium">
                {s.current ? "This device" : s.userAgent ?? "Unknown device"}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.ip ?? "—"} · active {formatRelativeTime(s.createdAt)}
              </p>
            </div>
            {!s.current && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await revoke.mutateAsync(s.id);
                  toast("Session revoked", "success");
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// small helper to keep JSX tidy
function LabelValue({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-medium">{children}</span>;
}
