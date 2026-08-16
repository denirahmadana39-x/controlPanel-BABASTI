import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Upload,
} from "lucide-react";
import { createWebsiteSchema } from "@babasti/validation";
import { websitesService } from "@/services/websites";
import { deploymentsService } from "@/services/deployments";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";

export function CreateWebsitePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = React.useState<1 | 2>(1);
  const [file, setFile] = React.useState<File | null>(null);
  const [deploying, setDeploying] = React.useState(false);
  const [zipBuild, setZipBuild] = React.useState({ outputDirectory: "" });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
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
    if (!file) {
      toast("Please choose a ZIP file to upload", "error");
      return;
    }

    setDeploying(true);
    try {
      const website = await websitesService.create({
        name,
        slug,
        description: description ?? "",
      });
      await deploymentsService.deployZip(website.id, file, {
        outputDirectory: zipBuild.outputDirectory || undefined,
      });
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
              <div className="rounded-lg border border-primary bg-primary/5 p-4">
                <Upload className="mb-2 h-5 w-5 text-primary" />
                <p className="text-sm font-medium">Static ZIP release</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Upload an exported project containing index.html.
                </p>
              </div>

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
                <div>
                  <Label>Publish directory (optional)</Label>
                  <Input
                    value={zipBuild.outputDirectory}
                    onChange={(e) =>
                      setZipBuild((b) => ({ ...b, outputDirectory: e.target.value }))
                    }
                    placeholder="dist"
                    className="mt-1"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Upload a pre-built project. Leave blank when index.html is
                    at the archive root.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button variant="outline" onClick={() => setStep(1)} disabled={deploying}>
                  Back
                </Button>
                <Button onClick={submit} loading={deploying}>
                  Create &amp; deploy
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
