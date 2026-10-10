import type { Instrumentation } from "next";
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  const digest = error && typeof error === "object" && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  console.error(JSON.stringify({event:"app.request_failed",digest,
    route:context.routePath,router:context.routerKind}));
};
