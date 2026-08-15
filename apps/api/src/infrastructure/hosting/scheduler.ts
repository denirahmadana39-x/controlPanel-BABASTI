import { prisma } from "../database/prisma.js";
import { AppError, ErrorCode } from "@babasti/shared";
import type { HostingNode } from "./types.js";

/**
 * Node selection strategy. The client never chooses a node; the scheduler does.
 * The MVP uses a deterministic online-node selection. Future versions can
 * consider CPU/RAM/disk/active-website counts without changing callers because
 * this is the single place node decisions are made.
 */

const MOCK_NODE: HostingNode = {
  id: "mock-node",
  name: "Mock Node",
  status: "ONLINE",
};

export async function chooseNode(
  providerName: string,
): Promise<HostingNode | null> {
  if (providerName === "mock") {
    return MOCK_NODE;
  }

  const nodes = await prisma.hostingNodeReference.findMany({
    where: { status: "ONLINE" },
    orderBy: { name: "asc" },
  });

  if (nodes.length === 0) {
    return null;
  }

  // Deterministic selection: pick the node with the fewest websites, falling
  // back to alphabetical order for stability. A simple, swappable heuristic.
  let best = nodes[0];
  let bestCount = await countWebsitesOnNode(best.id);
  for (const node of nodes.slice(1)) {
    const count = await countWebsitesOnNode(node.id);
    if (count < bestCount) {
      best = node;
      bestCount = count;
    }
  }

  return {
    id: best.id,
    name: best.name,
    status: best.status as HostingNode["status"],
  };
}

async function countWebsitesOnNode(nodeId: string): Promise<number> {
  // We track node assignment via the latest deployment's nodeId. A lightweight
  // proxy for capacity used by the scheduler.
  const result = await prisma.deployment.groupBy({
    by: ["websiteId"],
    where: { nodeId },
  });
  return result.length;
}

export async function assertNodeAvailable(
  providerName: string,
): Promise<HostingNode> {
  const node = await chooseNode(providerName);
  if (!node) {
    throw new AppError(ErrorCode.NODE_UNAVAILABLE, "No hosting node available");
  }
  return node;
}
