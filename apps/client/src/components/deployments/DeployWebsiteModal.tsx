import * as React from "react";
import { FileArchive, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { deploymentsService } from "@/services/deployments";
import { queryKeys } from "@/lib/queryClient";
import { ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function DeployWebsiteModal({
  websiteId,
  websiteName,
  open,
  onClose,
}: {
  websiteId: string;
  websiteName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [outputDirectory, setOutputDirectory] = React.useState("");
  const [deploying, setDeploying] = React.useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const close = () => {
    if (!deploying) onClose();
  };

  const deploy = async () => {
    if (!file) {
      toast("Choose a ZIP archive first", "error");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast("ZIP archives are limited to 50 MB", "error");
      return;
    }

    setDeploying(true);
    try {
      await deploymentsService.deployZip(websiteId, file, {
        outputDirectory: outputDirectory || undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.deployments(websiteId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.website(websiteId) }),
      ]);
      toast("Deployment started", "success");
      onClose();
    } catch (error) {
      toast(
        error instanceof ApiError ? error.message : "Deployment could not start",
        "error",
      );
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={`Deploy ${websiteName}`}
      description="Publish a new immutable release. The current website stays online if deployment fails."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={deploying}>
            Cancel
          </Button>
          <Button onClick={deploy} loading={deploying}>
            Deploy release
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs">
          <PipelineStep label="Archive" />
          <span className="text-muted-foreground">→</span>
          <PipelineStep label="Safe extract" />
          <span className="text-muted-foreground">→</span>
          <PipelineStep label="Online" />
        </div>

        <div className="rounded-lg border border-primary bg-primary/5 p-4">
          <Upload className="mb-2 h-5 w-5 text-primary" />
          <p className="text-sm font-medium">Static ZIP release</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload an exported project containing index.html.
          </p>
        </div>

        <div className="space-y-3">
          <Label htmlFor="release-archive">Project archive</Label>
          <label
            htmlFor="release-archive"
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border bg-card p-4 transition-colors hover:bg-muted/40 focus-within:focus-ring"
          >
            <span className="rounded-md bg-primary/10 p-2 text-primary">
              <FileArchive className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {file?.name ?? "Choose a .zip file"}
              </span>
              <span className="block text-xs text-muted-foreground">
                {file ? formatBytes(file.size) : "Maximum 50 MB"}
              </span>
            </span>
            <input
              id="release-archive"
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <div>
          <Label htmlFor="release-output">Publish directory (optional)</Label>
          <Input
            id="release-output"
            value={outputDirectory}
            onChange={(event) => setOutputDirectory(event.target.value)}
            placeholder="dist"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Leave blank when index.html is at the archive root.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function PipelineStep({ label }: { label: string }) {
  return <span className="text-center font-medium text-foreground">{label}</span>;
}
