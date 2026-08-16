import assert from "node:assert/strict";
import test from "node:test";
import { matchRoutes } from "react-router-dom";
import { DASHBOARD_ROUTE_PATH } from "./routing.js";

const appRoutes = [{ path: DASHBOARD_ROUTE_PATH }, { path: "*" }];

test("dashboard route matches every sidebar destination", () => {
  const destinations = [
    "/dashboard",
    "/dashboard/websites",
    "/dashboard/websites/new",
    "/dashboard/websites/site-id",
    "/dashboard/settings",
  ];

  for (const destination of destinations) {
    const matches = matchRoutes(appRoutes, destination);
    assert.equal(
      matches?.[0]?.route.path,
      DASHBOARD_ROUTE_PATH,
      `${destination} must stay inside the dashboard route`,
    );
  }
});
