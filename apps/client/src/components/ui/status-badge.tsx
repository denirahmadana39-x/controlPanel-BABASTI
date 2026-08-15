import { Circle, Loader2, CheckCircle2, XCircle, Ban } from "lucide-react";
import { Badge } from "./badge";
import { cn } from "@/lib/utils";

const websiteMap: Record<
  string,
  { label: string; variant: "success" | "warning" | "destructive" | "muted"; icon: React.ReactNode }
> = {
  ONLINE: { label: "Online", variant: "success", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  DEPLOYING: { label: "Deploying", variant: "warning", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  FAILED: { label: "Failed", variant: "destructive", icon: <XCircle className="h-3.5 w-3.5" /> },
  OFFLINE: { label: "Offline", variant: "muted", icon: <Circle className="h-3.5 w-3.5" /> },
};

const deploymentMap: Record<
  string,
  { label: string; variant: "default" | "success" | "warning" | "destructive" | "muted"; icon: React.ReactNode }
> = {
  QUEUED: { label: "Queued", variant: "muted", icon: <Circle className="h-3.5 w-3.5" /> },
  PREPARING: { label: "Preparing", variant: "default", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  UPLOADING: { label: "Uploading", variant: "default", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  CLONING: { label: "Cloning", variant: "default", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  INSTALLING: { label: "Installing", variant: "default", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  BUILDING: { label: "Building", variant: "default", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  PUBLISHING: { label: "Publishing", variant: "default", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  CONFIGURING: { label: "Configuring", variant: "default", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  HEALTH_CHECK: { label: "Health check", variant: "default", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
  SUCCESS: { label: "Success", variant: "success", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  FAILED: { label: "Failed", variant: "destructive", icon: <XCircle className="h-3.5 w-3.5" /> },
  CANCELLED: { label: "Cancelled", variant: "muted", icon: <Ban className="h-3.5 w-3.5" /> },
};

export function WebsiteStatusBadge({ status }: { status: string }) {
  const cfg = websiteMap[status] ?? websiteMap.OFFLINE;
  return (
    <Badge variant={cfg.variant} className={cn("gap-1")}>
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

export function DeploymentStatusBadge({ status }: { status: string }) {
  const cfg = deploymentMap[status] ?? deploymentMap.QUEUED;
  return (
    <Badge variant={cfg.variant} className="gap-1">
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}
