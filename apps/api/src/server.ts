import "dotenv/config";
import { buildApp } from "./app.js";
import { loadConfig } from "@babasti/config";
import { getQueue } from "./infrastructure/queue/index.js";
import {
  processDeployJob,
  processRollbackJob,
} from "./modules/deployments/deployment.service.js";
import { logger } from "@babasti/shared";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp();

  // Start the asynchronous deployment worker (disabled in some test setups).
  if (process.env.DISABLE_WORKER !== "true") {
    const queue = await getQueue();
    queue.startWorker(async (job) => {
      if (job.kind === "deploy") {
        await processDeployJob(job.deploymentId);
      } else if (job.kind === "rollback") {
        await processRollbackJob(job.deploymentId);
      }
    });
    logger.info("Deployment worker started");
  }

  const port = config.API_PORT;
  const host = config.API_HOST;
  await app.listen({ port, host });
  logger.info(
    `BabaSTI API listening on ${host}:${port} (provider=${config.DEPLOYMENT_PROVIDER})`,
  );
}

main().catch((error) => {
  logger.error("Failed to start API", error);
  process.exit(1);
});
