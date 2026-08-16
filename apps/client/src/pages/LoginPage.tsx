import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { Rocket, AlertCircle, Github } from "lucide-react";
import { loginSchema } from "@babasti/validation";
import { z } from "zod";

type LoginInput = z.infer<typeof loginSchema>;
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/feedback";
import { authService } from "@/services/auth";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(values: { email: string; password: string }) {
    setError(null);
    try {
      await login(values.email, values.password);
      navigate("/dashboard");
    } catch (e: any) {
      setError(e.message ?? "Login failed");
      toast(e.message ?? "Login failed", "error");
    }
  }

  return (
    <AuthLayout title="Sign in to your account">
      {error && (
        <Alert variant="destructive" className="mb-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        </Alert>
      )}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" {...register("email")} className="mt-1" />
          {errors.email && (
            <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            {...register("password")}
            className="mt-1"
          />
          {errors.password && (
            <p className="mt-1 text-xs text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>

      <a href={authService.googleUrl()}>
        <Button variant="outline" className="w-full" type="button">
          <Rocket className="h-4 w-4" />
          Continue with Google
        </Button>
      </a>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don't have an account?{" "}
        <Link to="/register" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </AuthLayout>
  );
}

export function AuthLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-foreground/10">
            <Rocket className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold">BabaSTI Hosting</span>
        </div>
        <div>
          <h1 className="text-3xl font-bold leading-tight">
            Ship your sites to a live URL in minutes.
          </h1>
          <p className="mt-4 max-w-sm text-primary-foreground/80">
            Upload a pre-built ZIP, get a *.babasti.my.id address, and roll back
            instantly — all from one clean dashboard.
          </p>
        </div>
        <p className="text-sm text-primary-foreground/60">
          Multi-node hosting, developer-first.
        </p>
      </div>
      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Rocket className="h-4 w-4" />
            </div>
            <span className="font-semibold">BabaSTI Hosting</span>
          </div>
          <h2 className="mb-6 text-xl font-semibold">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
