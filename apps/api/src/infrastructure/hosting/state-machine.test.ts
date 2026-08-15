import { test } from "node:test";
import assert from "node:assert/strict";
import { DeploymentStatus } from "@babasti/types";
import {
  canTransition,
  isTerminal,
  isRejectableTransition,
  TERMINAL_STATUSES,
} from "./state-machine.js";

test("valid forward transitions are allowed", () => {
  assert.equal(
    canTransition(DeploymentStatus.QUEUED, DeploymentStatus.PREPARING),
    true,
  );
  assert.equal(
    canTransition(DeploymentStatus.PREPARING, DeploymentStatus.UPLOADING),
    true,
  );
  assert.equal(
    canTransition(DeploymentStatus.PREPARING, DeploymentStatus.CLONING),
    true,
  );
  assert.equal(
    canTransition(DeploymentStatus.BUILDING, DeploymentStatus.PUBLISHING),
    true,
  );
  assert.equal(
    canTransition(DeploymentStatus.CONFIGURING, DeploymentStatus.HEALTH_CHECK),
    true,
  );
  assert.equal(
    canTransition(DeploymentStatus.HEALTH_CHECK, DeploymentStatus.SUCCESS),
    true,
  );
  // No build command: UPLOADING jumps straight to PUBLISHING.
  assert.equal(
    canTransition(DeploymentStatus.UPLOADING, DeploymentStatus.PUBLISHING),
    true,
  );
});

test("failure and cancellation are allowed from any non-terminal state", () => {
  for (const from of Object.values(DeploymentStatus)) {
    if (TERMINAL_STATUSES.includes(from)) continue;
    assert.equal(canTransition(from, DeploymentStatus.FAILED), true);
    assert.equal(canTransition(from, DeploymentStatus.CANCELLED), true);
  }
});

test("invalid transitions are rejected", () => {
  // Cannot go backwards.
  assert.equal(
    canTransition(DeploymentStatus.SUCCESS, DeploymentStatus.QUEUED),
    false,
  );
  assert.equal(
    canTransition(DeploymentStatus.BUILDING, DeploymentStatus.UPLOADING),
    false,
  );
  // Cannot skip required stages.
  assert.equal(
    canTransition(DeploymentStatus.QUEUED, DeploymentStatus.SUCCESS),
    false,
  );
  assert.equal(
    canTransition(DeploymentStatus.PREPARING, DeploymentStatus.SUCCESS),
    false,
  );
});

test("terminal states reject further transitions", () => {
  for (const terminal of TERMINAL_STATUSES) {
    assert.equal(isTerminal(terminal), true);
    for (const to of Object.values(DeploymentStatus)) {
      if (to === terminal) continue;
      assert.equal(canTransition(terminal, to), false);
    }
  }
  assert.equal(isTerminal(DeploymentStatus.BUILDING), false);
});

test("isRejectableTransition only blocks leaving a terminal state", () => {
  assert.equal(
    isRejectableTransition(DeploymentStatus.SUCCESS, DeploymentStatus.FAILED),
    true,
  );
  assert.equal(
    isRejectableTransition(DeploymentStatus.FAILED, DeploymentStatus.QUEUED),
    true,
  );
  // Out-of-order intermediate reports are tolerated (not rejected).
  assert.equal(
    isRejectableTransition(DeploymentStatus.UPLOADING, DeploymentStatus.SUCCESS),
    false,
  );
  assert.equal(
    isRejectableTransition(null, DeploymentStatus.PREPARING),
    false,
  );
});
