import { loadConfig } from "@babasti/config";
import { logger } from "@babasti/shared";
import Redis from "ioredis";

export type DeploymentJob = {
  kind: "deploy" | "rollback";
  deploymentId: string;
};

export type JobHandler = (job: DeploymentJob) => Promise<void>;

export interface Queue {
  enqueue(job: DeploymentJob): Promise<void>;
  startWorker(handler: JobHandler): void;
  close(): Promise<void>;
}

class InMemoryQueue implements Queue {
  private buffer: DeploymentJob[] = [];
  private processing = false;
  private handler: JobHandler | null = null;
  private closed = false;

  async enqueue(job: DeploymentJob): Promise<void> {
    this.buffer.push(job);
    void this.drain();
  }

  startWorker(handler: JobHandler): void {
    this.handler = handler;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.processing || !this.handler || this.closed) return;
    this.processing = true;
    try {
      while (this.buffer.length > 0 && !this.closed) {
        const job = this.buffer.shift()!;
        try {
          await this.handler(job);
        } catch (error) {
          logger.error("Job processing failed", job, error);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class RedisQueue implements Queue {
  private pub: import("ioredis").Redis;
  private sub: import("ioredis").Redis;
  private listKey = "babasti:deployment-queue";
  private workerRunning = false;
  private handler: JobHandler | null = null;
  private closed = false;

  constructor(url: string) {
    this.pub = new Redis(url);
    this.sub = new Redis(url);
  }

  async enqueue(job: DeploymentJob): Promise<void> {
    await this.pub.rpush(this.listKey, JSON.stringify(job));
  }

  startWorker(handler: JobHandler): void {
    this.handler = handler;
    void this.loop();
  }

  private async loop(): Promise<void> {
    if (this.workerRunning || this.closed) return;
    this.workerRunning = true;
    while (!this.closed) {
      try {
        const result = await this.sub.blpop(this.listKey, 5);
        if (!result) continue;
        const job = JSON.parse(result[1]) as DeploymentJob;
        try {
          await this.handler?.(job);
        } catch (error) {
          logger.error("Redis job processing failed", job, error);
        }
      } catch (error) {
        logger.error("Queue loop error", error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    this.workerRunning = false;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.pub.disconnect();
    this.sub.disconnect();
  }
}

let instance: Queue | null = null;

export async function getQueue(): Promise<Queue> {
  if (instance) return instance;
  const config = loadConfig();
  if (config.REDIS_URL) {
    instance = new RedisQueue(config.REDIS_URL);
    logger.info("Using Redis-backed deployment queue");
  } else {
    instance = new InMemoryQueue();
    logger.info("Using in-memory deployment queue (single instance)");
  }
  return instance;
}
