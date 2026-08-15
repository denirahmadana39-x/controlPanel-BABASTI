import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  Github,
  Loader2,
} from "lucide-react";
import { createWebsiteSchema } from "@babasti/validation";
import { websitesService } from "@/services/websites";
import { deploymentsService } from "@/services/deployments";
import { githubService } from "@/services/auth";
import { useCreateWebsite, useGithubRepositories } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";

export function CreateWebsitePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const createMutation = useCreateWebsite();
  const [step, setStep] = React.useState<1 | 2>(1);
  const [method, setMethod] = React.useState<"ZIP" | "GITHUB">("ZIP");
  const [file, setFile] = React.useState<File | null>(null);
  const [deploying, setDeploying] = React.useState(false);
  const [zipBuild, setZipBuild] = React.useState({ buildCommand: "", outputDirectory: "" });
  const [ghBuild, setGhBuild] = React.useState({ buildCommand: "", outputDirectory: "" });

  const github = useGithubRepositories();
  const [selectedRepo, setSelectedRepo] = React.useState("");
  const [branch, setBranch] = React.useState("main");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    setFocus,
  } = useForm({ resolver: zodResolver(createWebsiteSchema) });
  const nameValue = watch("name");

  React.useEffect(() => {
    if (nameValue && !getValues("slug")) {
      websitesService
        .suggestSlug(nameValue)
        .then((r) => setValue("slug", r.slug))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameValue]);

  const onStep1 = handleSubmit(() => setStep(2));

  async function submit() {
    const { name, slug, description } = getValues();
    if (!name || !slug) {
      toast("Please complete the website details", "error");
      setStep(1);
      return;
    }
    setDeploying(true);
    try {
      const website = await websitesService.create({
        name,
        slug,
        description: description ?? "",
      });
      if (method === "ZIP") {
        if (!file) {
          toast("Please choose a ZIP file to upload", "error");
          setDeploying(false);
          return;
        }
        await deploymentsService.deployZip(website.id, file, {
          buildCommand: zipBuild.buildCommand || undefined,
          outputDirectory: zipBuild.outputDirectory || undefined,
        });
      } else {
        if (!selectedRepo) {
          toast("Please select a GitHub repository", "error");
          setDeploying(false);
          return;
        }
        await deploymentsService.deployGithub(website.id, {
          repository: selectedRepo,
          branch,
          buildCommand: ghBuild.buildCommand || undefined,
          outputDirectory: ghBuild.outputDirectory || undefined,
        });
      }
      toast("Deployment started", "success");
      navigate(`/dashboard/websites/${website.id}?tab=deployments`);
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : "Failed to create website";
      toast(msg, "error");
      setDeploying(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <button
        onClick={() => navigate("/dashboard/websites")}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to websites
      </button>
      <h1 className="text-2xl font-semibold">Create Website</h1>

      <Card>
        <CardContent className="space-y-5 p-6">
          {step === 1 ? (
            <form onSubmit={onStep1} className="space-y-4">
              <div>
                <Label htmlFor="name">Website name</Label>
                <Input id="name" {...register("name")} className="mt-1" placeholder="My Portfolio" />
              </div>
              <div>
                <Label htmlFor="slug">Subdomain</Label>
                <div className="mt-1 flex items-center rounded-md border border-input bg-card px-3 focus-within:focus-ring">
                  <Input
                    id="slug"
                    {...register("slug")}
                    className="border-0 px-0 focus-visible:ring-0"
                    placeholder="my-portfolio"
                  />
                  <span className="whitespace-nowrap pl-2 text-sm text-muted-foreground">
                    .babasti.my.id
                  </span>
                </div>
              </div>
              <div>
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea id="description" {...register("description")} className="mt-1" />
              </div>
              <Button type="submit" className="w-full">
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium">Deployment method</p>
                <div className="grid grid-cols-2 gap-3">
                  <MethodCard
                    active={method === "ZIP"}
                    onClick={() => setMethod("ZIP")}
                    icon={<Upload className="h-5 w-5" />}
                    title="Upload ZIP"
                    description="Drag a static build or project archive."
                  />
                  <MethodCard
                    active={method === "GITHUB"}
                    onClick={() => setMethod("GITHUB")}
                    icon={<Github className="h-5 w-5" />}
                    title="GitHub"
                    description="Deploy from a repository branch."
                  />
                </div>
              </div>

              {method === "ZIP" ? (
                <div className="space-y-3">
                  <div>
                    <Label>Project archive (.zip)</Label>
                    <input
                      type="file"
                      accept=".zip,application/zip"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Build command (optional)</Label>
                      <Input
                        value={zipBuild.buildCommand}
                        onChange={(e) =>
                          setZipBuild((b) => ({ ...b, buildCommand: e.target.value }))
                        }
                        placeholder="npm run build"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Output directory (optional)</Label>
                      <Input
                        value={zipBuild.outputDirectory}
                        onChange={(e) =>
                          setZipBuild((b) => ({ ...b, outputDirectory: e.target.value }))
                        }
                        placeholder="dist"
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {!github.data?.connected ? (
                    <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
                      Connect your GitHub account to choose a repository.
                      <div className="mt-3">
                        <a href={githubService.connectUrl()}>
                          <Button size="sm" variant="outline">
                            <Github className="h-4 w-4" /> Connect GitHub
                          </Button>
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <Label>Repository</Label>
                        <select
                          value={selectedRepo}
                          onChange={(e) => {
                            setSelectedRepo(e.target.value);
                            const repo = github.data!.items.find(
                              (r) => r.name === e.target.value,
                            );
                            if (repo) setBranch(repo.defaultBranch);
                          }}
                          className="mt-1 flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                        >
                          <option value="">Select a repository</option>
                          {github.data!.items.map((r) => (
                            <option key={r.name} value={r.name}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label>Branch</Label>
                          <Input
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>Build command (optional)</Label>
                          <Input
                            value={ghBuild.buildCommand}
                            onChange={(e) =>
                              setGhBuild((b) => ({ ...b, buildCommand: e.target.value }))
                            }
                            placeholder="npm run build"
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>Output directory (optional)</Label>
                          <Input
                            value={ghBuild.outputDirectory}
                            onChange={(e) =>
                              setGhBuild((b) => ({ ...b, outputDirectory: e.target.value }))
                            }
                            placeholder="dist"
                            className="mt-1"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep(1)} disabled={deploying}>
                  Back
                </Button>
                <Button onClick={submit} loading={deploying || createMutation.isPending}>
                  {deploying ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Deploying…
                    </>
                  ) : (
                    "Create & Deploy"
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MethodCard({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-4 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
      )}
    >
      <div className="mb-2 text-primary">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}
