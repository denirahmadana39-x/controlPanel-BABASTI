import { Link } from "react-router-dom";
import { Globe, Plus, MoreVertical, Trash2, ExternalLink } from "lucide-react";
import { useWebsites, useDeleteWebsite } from "@/hooks/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { WebsiteStatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useState } from "react";
import { formatRelativeTime } from "@/lib/utils";

export function WebsitesPage() {
  const { data, isLoading } = useWebsites();
  const deleteMutation = useDeleteWebsite();
  const { toast } = useToast();
  const [toDelete, setToDelete] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  const websites = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Websites</h1>
        <Link to="/dashboard/websites/new">
          <Button>
            <Plus className="h-4 w-4" />
            Create Website
          </Button>
        </Link>
      </div>

      {websites.length === 0 ? (
        <EmptyState
          icon={<Globe className="h-10 w-10" />}
          title="No websites yet"
          description="Create your first website and we'll give it a free *.babasti.my.id domain."
          action={
            <Link to="/dashboard/websites/new">
              <Button>
                <Plus className="h-4 w-4" />
                Create Website
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {websites.map((w) => (
            <Card key={w.id}>
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{w.name}</h3>
                    <a
                      href={w.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      {w.defaultDomain}
                    </a>
                  </div>
                  <WebsiteStatusBadge status={w.status} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {w.lastDeployment
                    ? `Last deploy ${formatRelativeTime(w.lastDeployment.createdAt)}`
                    : "Not deployed yet"}
                </p>
                <div className="mt-4 flex items-center gap-2">
                  <Link to={`/dashboard/websites/${w.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">
                      Manage
                    </Button>
                  </Link>
                  <a href={w.url} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="sm" aria-label="Open">
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Delete"
                    onClick={() => setToDelete(w.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteMutation.mutateAsync({ id: toDelete });
          toast("Website deleted", "success");
          setToDelete(null);
        }}
        title="Delete website?"
        description="This permanently removes the website, its deployments and domain records."
        confirmLabel="Delete"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
