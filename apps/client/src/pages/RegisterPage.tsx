import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { Rocket, AlertCircle } from "lucide-react";
import { registerSchema } from "@babasti/validation";
import { z } from "zod";

type RegisterInput = z.infer<typeof registerSchema>;
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/feedback";
import { AuthLayout } from "./LoginPage";

export function RegisterPage() {
  const { register: doRegister } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(values: {
    email: string;
    password: string;
    displayName: string;
  }) {
    setError(null);
    try {
      await doRegister(values.email, values.password, values.displayName);
      navigate("/dashboard");
    } catch (e: any) {
      setError(e.message ?? "Registration failed");
      toast(e.message ?? "Registration failed", "error");
    }
  }

  return (
    <AuthLayout title="Create your account">
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
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" {...register("displayName")} className="mt-1" />
          {errors.displayName && (
            <p className="mt-1 text-xs text-destructive">
              {errors.displayName.message}
            </p>
          )}
        </div>
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
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
