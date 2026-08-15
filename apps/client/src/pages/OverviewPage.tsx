import { Link } from "react-router-dom";
import { Globe, Activity, HardDrive, Plus } from "lucide-react";
import { useOverview } from "@/hooks/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { DeploymentStatusBadge, WebsiteStatusBadge } from "@/components/ui/status-badge";
import { formatBytes, formatRelativeTime } from "@/lib/utils";

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
          {icon}
        </div>
        <div>
          <p className="text-2xl font-semibold">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  const { data, isLoading } = useOverview();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const counts = data?.counts ?? { websites: 0, domains: 0, deployments: 0 };

  if (counts.websites === 0 && counts.deployments === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Good morning</h1>
        <EmptyState
          icon={<Globe className="h-10 w-10" />}
          title="No websites yet"
          description="Deploy your first website and get a live BabaSTI subdomain in minutes."
          action={
            <Link to="/dashboard/websites/new">
              <Button>
                <Plus className="h-4 w-4" />
                Create Website
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Good morning</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Globe className="h-5 w-5" />} label="Websites" value={counts.websites} />
        <StatCard icon={<Activity className="h-5 w-5" />} label="Deployments" value={counts.deployments} />
        <StatCard icon={<Globe className="h-5 w-5" />} label="Domains" value={counts.domains} />
        <StatCard icon={<HardDrive className="h-5 w-5" />} label="Storage" value={formatBytes(data?.storage.bytes ?? 0)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h3 className="mb-4 text-base font-semibold">Recent Deployments</h3>
            {data?.recentDeployments.length ? (
              <ul className="divide-y divide-border">
                {data.recentDeployments.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">{d.websiteName}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.source} · {formatRelativeTime(d.createdAt)}
                      </p>
                    </div>
                    <DeploymentStatusBadge status={d.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No deployments yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h3 className="mb-4 text-base font-semibold">Your Websites</h3>
            {data?.recentWebsites.length ? (
              <ul className="divide-y divide-border">
                {data.recentWebsites.map((w) => (
                  <li key={w.slug} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">{w.name}</p>
                      <a
                        href={w.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        {w.domain}
                      </a>
                    </div>
                    <WebsiteStatusBadge status={w.status} />
                  </li>
                ))}
              </ul>
            ) : null}
            <Link to="/dashboard/websites" className="mt-2 inline-block">
              <Button variant="outline" size="sm">
                View all
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
