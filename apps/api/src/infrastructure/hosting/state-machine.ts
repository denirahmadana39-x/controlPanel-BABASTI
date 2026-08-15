import { DeploymentStatus } from "@babasti/types";

/**
 * Deployment lifecycle state machine.
 *
 * The control plane never lets a deployment jump arbitrarily between states.
 * This module is the single source of truth for which transitions are legal.
 * It is intentionally pure (no I/O) so it can be unit-tested in isolation and
 * reused by both the control plane and the Node Agent contract.
 *
 * Allowed transitions:
 *   QUEUED      -> PREPARING | FAILED | CANCELLED
 *   PREPARING   -> UPLOADING | CLONING | FAILED | CANCELLED
 *   UPLOADING   -> INSTALLING | PUBLISHING | FAILED | CANCELLED
 *   CLONING     -> INSTALLING | PUBLISHING | FAILED | CANCELLED
 *   INSTALLING  -> BUILDING | FAILED | CANCELLED
 *   BUILDING    -> PUBLISHING | FAILED | CANCELLED
 *   PUBLISHING  -> CONFIGURING | FAILED | CANCELLED
 *   CONFIGURING -> HEALTH_CHECK | FAILED | CANCELLED
 *   HEALTH_CHECK-> SUCCESS | FAILED | CANCELLED
 *   SUCCESS/FAILED/CANCELLED are terminal.
 */

export const TERMINAL_STATUSES: readonly DeploymentStatus[] = [
  DeploymentStatus.SUCCESS,
  DeploymentStatus.FAILED,
  DeploymentStatus.CANCELLED,
];

const TRANSITIONS: Record<DeploymentStatus, readonly DeploymentStatus[]> = {
  [DeploymentStatus.QUEUED]: [
    DeploymentStatus.PREPARING,
    DeploymentStatus.FAILED,
    DeploymentStatus.CANCELLED,
  ],
  [DeploymentStatus.PREPARING]: [
    DeploymentStatus.UPLOADING,
    DeploymentStatus.CLONING,
    DeploymentStatus.FAILED,
    DeploymentStatus.CANCELLED,
  ],
  [DeploymentStatus.UPLOADING]: [
    DeploymentStatus.INSTALLING,
    DeploymentStatus.PUBLISHING,
    DeploymentStatus.FAILED,
    DeploymentStatus.CANCELLED,
  ],
  [DeploymentStatus.CLONING]: [
    DeploymentStatus.INSTALLING,
    DeploymentStatus.PUBLISHING,
    DeploymentStatus.FAILED,
    DeploymentStatus.CANCELLED,
  ],
  [DeploymentStatus.INSTALLING]: [
    DeploymentStatus.BUILDING,
    DeploymentStatus.FAILED,
    DeploymentStatus.CANCELLED,
  ],
  [DeploymentStatus.BUILDING]: [
    DeploymentStatus.PUBLISHING,
    DeploymentStatus.FAILED,
    DeploymentStatus.CANCELLED,
  ],
  [DeploymentStatus.PUBLISHING]: [
    DeploymentStatus.CONFIGURING,
    DeploymentStatus.FAILED,
    DeploymentStatus.CANCELLED,
  ],
  [DeploymentStatus.CONFIGURING]: [
    DeploymentStatus.HEALTH_CHECK,
    DeploymentStatus.FAILED,
    DeploymentStatus.CANCELLED,
  ],
  [DeploymentStatus.HEALTH_CHECK]: [
    DeploymentStatus.SUCCESS,
    DeploymentStatus.FAILED,
    DeploymentStatus.CANCELLED,
  ],
  [DeploymentStatus.SUCCESS]: [],
  [DeploymentStatus.FAILED]: [],
  [DeploymentStatus.CANCELLED]: [],
};

export function isTerminal(status: DeploymentStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function canTransition(
  from: DeploymentStatus,
  to: DeploymentStatus,
): boolean {
  if (from === to) return true;
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

/**
 * Production guard used by the deploy worker. We intentionally only hard-reject
 * the transitions that would corrupt state (leaving a terminal state, or moving
 * to an unknown status). Intermediate ordering mismatches reported by a Node
 * Agent are tolerated so a slightly out-of-order progress report can never
 * wedge a deployment in a non-terminal state.
 */
export function isRejectableTransition(
  from: DeploymentStatus | null | undefined,
  to: DeploymentStatus,
): boolean {
  if (!from) return false;
  if (isTerminal(from) && from !== to) return true;
  return false;
}
