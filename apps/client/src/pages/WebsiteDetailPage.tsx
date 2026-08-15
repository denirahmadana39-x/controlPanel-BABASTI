import * as React from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import {
  Globe,
  ExternalLink,
  Rocket,
  Plus,
  Trash2,
  RotateCcw,
  Ban,
  KeyRound,
  Settings as SettingsIcon,
  Loader2,
} from "lucide-react";
import {
  useWebsite,
  useDeployments,
  useDeploymentLogs,
  useCancelDeployment,
  useRollback,
  useDomains,
  useAddDomain,
  useRemoveDomain,
  useEnvironment,
  useReplaceEnvironment,
} from "@/hooks/queries";
import {
  websitesService,
  environmentService,
} from "@/services/websites";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  WebsiteStatusBadge,
  DeploymentStatusBadge,
} from "@/components/ui/status-badge";
import { Skeleton, Alert, EmptyState } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatRelativeTime, formatBytes, maskSecret } from "@/lib/utils";
import { ApiError } from "@/lib/api";

export function WebsiteDetailPage() {
  const { id = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "overview";
  const setTab = (t: string) => setSearchParams({ tab: t });

  const { data: website, isLoading } = useWebsite(id);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!website) {
    return (
      <EmptyState
        title="Website not found"
        description="It may have been deleted or you don't have access."
        action={
          <Link to="/dashboard/websites">
            <Button variant="outline">Back to websites</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{website.name}</h1>
            <WebsiteStatusBadge status={website.status} />
          </div>
          <a
            href={website.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {website.defaultDomain} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="flex gap-2">
          <Link to={`/dashboard/websites/new`}>
            <Button variant="outline" size="sm">
              <Rocket className="h-4 w-4" /> New deploy
            </Button>
          </Link>
          <a href={website.url} target="_blank" rel="noreferrer">
            <Button size="sm">
              <ExternalLink className="h-4 w-4" /> Open Website
            </Button>
          </a>
        </div>
      </div>

      <Tabs
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "deployments", label: "Deployments" },
          { value: "domains", label: "Domains" },
          { value: "environment", label: "Environment" },
          { value: "settings", label: "Settings" },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="pt-2">
        {tab === "overview" && <OverviewTab website={website} />}
        {tab === "deployments" && <DeploymentsTab websiteId={website.id} />}
        {tab === "domains" && <DomainsTab websiteId={website.id} />}
        {tab === "environment" && <EnvironmentTab websiteId={website.id} />}
        {tab === "settings" && <SettingsTab website={website} />}
      </div>
    </div>
  );
}

function OverviewTab({ website }: { website: any }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Latest Deployment</CardTitle>
        </CardHeader>
        <CardContent>
          {website.lastDeployment ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  Release #{website.lastDeployment.releaseNumber ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatRelativeTime(website.lastDeployment.createdAt)}
                </p>
              </div>
              <DeploymentStatusBadge status={website.lastDeployment.status} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No deployments yet.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <WebsiteStatusBadge status={website.status} />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Deployments</span>
            <span>{website.deploymentsCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Default domain</span>
            <span className="truncate pl-2">{website.defaultDomain}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DeploymentsTab({ websiteId }: { websiteId: string }) {
  const { data, isLoading } = useDeployments(websiteId);
  const [logsFor, setLogsFor] = React.useState<string | null>(null);
  const cancel = useCancelDeployment();
  const rollback = useRollback();
  const { toast } = useToast();

  if (isLoading) return <Skeleton className="h-64" />;
  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <EmptyState
          icon={<Rocket className="h-10 w-10" />}
          title="No deployments yet"
          description="Upload a ZIP or connect GitHub to ship your first release."
          action={
            <Link to={`/dashboard/websites/new`}>
              <Button>Deploy now</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((d) => (
            <Card key={d.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {d.source === "GITHUB" ? d.githubRepo : "ZIP upload"}
                    </span>
                    <DeploymentStatusBadge status={d.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {d.releaseNumber ? `Release #${d.releaseNumber} · ` : ""}
                    {formatRelativeTime(d.createdAt)}
                    {d.githubBranch ? ` · ${d.githubBranch}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setLogsFor(d.id)}>
                    Logs
                  </Button>
                  {d.status === "QUEUED" ||
                  d.status === "PREPARING" ||
                  d.status === "BUILDING" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await cancel.mutateAsync(d.id);
                        toast("Deployment cancelled", "info");
                      }}
                    >
                      <Ban className="h-4 w-4" /> Cancel
                    </Button>
                  ) : null}
                  {d.status === "SUCCESS" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await rollback.mutateAsync(d.id);
                        toast("Rollback started", "success");
                      }}
                    >
                      <RotateCcw className="h-4 w-4" /> Rollback
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <DeploymentLogsModal
        deploymentId={logsFor}
        onClose={() => setLogsFor(null)}
      />
    </div>
  );
}

function DeploymentLogsModal({
  deploymentId,
  onClose,
}: {
  deploymentId: string | null;
  onClose: () => void;
}) {
  const { data } = useDeploymentLogs(deploymentId ?? "");
  return (
    <Modal
      open={!!deploymentId}
      onClose={onClose}
      title="Deployment Logs"
      size="lg"
    >
      <div className="max-h-96 overflow-y-auto rounded-md bg-muted/40 p-3 font-mono text-xs">
        {data?.items.length ? (
          data.items.map((l) => (
            <div key={l.id} className="py-0.5">
              <span className="text-muted-foreground">
                {new Date(l.timestamp).toLocaleTimeString()}
              </span>{" "}
              <span
                className={
                  l.level === "ERROR"
                    ? "text-destructive"
                    : l.level === "WARN"
                      ? "text-warning"
                      : "text-foreground"
                }
              >
                {l.message}
              </span>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">Waiting for logs…</p>
        )}
      </div>
    </Modal>
  );
}

function DomainsTab({ websiteId }: { websiteId: string }) {
  const { data, isLoading } = useDomains(websiteId);
  const addDomain = useAddDomain();
  const removeDomain = useRemoveDomain();
  const { toast } = useToast();
  const [domain, setDomain] = React.useState("");
  const [toRemove, setToRemove] = React.useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-40" />;
  const domains = data?.items ?? [];

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Domains</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {domains.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between rounded-md border border-border p-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{d.domain}</span>
                  {d.isDefault && <Badge variant="default">Default</Badge>}
                  <Badge
                    variant={
                      d.status === "ACTIVE"
                        ? "success"
                        : d.status === "PENDING"
                          ? "warning"
                          : "destructive"
                    }
                  >
                    {d.status}
                  </Badge>
                </div>
                {d.instructions && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Add a CNAME record:{" "}
                    <code className="rounded bg-muted px-1">
                      {d.instructions.name} → {d.instructions.value}
                    </code>
                  </p>
                )}
              </div>
              {!d.isDefault && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setToRemove(d.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!domain) return;
            try {
              await addDomain.mutateAsync({ websiteId, domain });
              toast("Domain added", "success");
              setDomain("");
            } catch (e: any) {
              toast(
                e instanceof ApiError ? e.message : "Failed to add domain",
                "error",
              );
            }
          }}
        >
          <Input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="www.example.com"
            className="flex-1"
          />
          <Button type="submit" loading={addDomain.isPending}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </form>
        <Alert variant="warning">
          Custom domains remain <strong>PENDING</strong> until verification is
          enabled in a future release.
        </Alert>
      </CardContent>

      <ConfirmDialog
        open={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={async () => {
          if (!toRemove) return;
          await removeDomain.mutateAsync({ websiteId, domainId: toRemove });
          toast("Domain removed", "success");
          setToRemove(null);
        }}
        title="Remove domain?"
        confirmLabel="Remove"
        destructive
      />
    </Card>
  );
}

function EnvironmentTab({ websiteId }: { websiteId: string }) {
  const { data, isLoading } = useEnvironment(websiteId);
  const replace = useReplaceEnvironment();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<
    { key: string; value: string; visibility: string }[]
  >([]);

  React.useEffect(() => {
    if (data?.items) {
      setRows(
        data.items.map((v) => ({
          key: v.key,
          value: v.value,
          visibility: v.visibility,
        })),
      );
    }
  }, [data]);

  function addRow() {
    setRows((r) => [...r, { key: "", value: "", visibility: "SECRET" }]);
  }
  function updateRow(i: number, patch: Partial<{ key: string; value: string; visibility: string }>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }

  async function save() {
    try {
      await replace.mutateAsync({ websiteId, variables: rows });
      toast("Environment saved", "success");
      setOpen(false);
    } catch (e: any) {
      toast(e instanceof ApiError ? e.message : "Failed to save", "error");
    }
  }

  if (isLoading) return <Skeleton className="h-40" />;
  const vars = data?.items ?? [];

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Environment Variables</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <KeyRound className="h-4 w-4" /> Edit
        </Button>
      </CardHeader>
      <CardContent>
        {vars.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No environment variables configured.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {vars.map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2">
                <span className="font-mono text-sm">{v.key}</span>
                <span className="font-mono text-sm text-muted-foreground">
                  {v.visibility === "PUBLIC" ? v.value : maskSecret(v.value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit Environment Variables"
        description="Secrets are encrypted at rest and never exposed in logs."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} loading={replace.isPending}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2">
              <Input
                value={row.key}
                onChange={(e) => updateRow(i, { key: e.target.value })}
                placeholder="KEY"
              />
              <Input
                value={row.value}
                onChange={(e) => updateRow(i, { value: e.target.value })}
                placeholder="value"
                type={row.visibility === "SECRET" ? "password" : "text"}
              />
              <select
                value={row.visibility}
                onChange={(e) => updateRow(i, { visibility: e.target.value })}
                className="h-10 rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="SECRET">Secret</option>
                <option value="PUBLIC">Public</option>
              </select>
              <Button variant="ghost" onClick={() => removeRow(i)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4" /> Add variable
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

function SettingsTab({ website }: { website: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = React.useState(website.name);
  const [description, setDescription] = React.useState(website.description);
  const [saving, setSaving] = React.useState(false);
  const [toDelete, setToDelete] = React.useState(false);
  const navigate = useNavigate();

  async function save() {
    setSaving(true);
    try {
      await websitesService.update(website.id, { name, description });
      qc.invalidateQueries({ queryKey: ["websites", website.id] });
      toast("Saved", "success");
    } catch (e: any) {
      toast(e instanceof ApiError ? e.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    try {
      await websitesService.remove(website.id);
      toast("Website deleted", "success");
      navigate("/dashboard/websites");
    } catch (e: any) {
      toast(e instanceof ApiError ? e.message : "Failed to delete", "error");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Website name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1"
            />
          </div>
          <Button onClick={save} loading={saving}>
            Save changes
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <SettingsIcon className="h-4 w-4" /> Danger zone
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Deleting a website removes all deployments, domains and environment
            variables. This cannot be undone.
          </p>
          <Button
            variant="destructive"
            className="mt-4"
            onClick={() => setToDelete(true)}
          >
            <Trash2 className="h-4 w-4" /> Delete website
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={toDelete}
        onClose={() => setToDelete(false)}
        onConfirm={remove}
        title="Delete website?"
        description="All deployments and domains for this site will be removed."
        confirmLabel="Delete"
        destructive
      />
    </div>
  );
}
