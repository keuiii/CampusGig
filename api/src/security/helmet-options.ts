export function createHelmetOptions(nodeEnv: string | undefined) {
  const isProduction = nodeEnv === "production";

  return {
    contentSecurityPolicy: {
      directives: {
        "upgrade-insecure-requests": isProduction ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" as const },
  };
}
