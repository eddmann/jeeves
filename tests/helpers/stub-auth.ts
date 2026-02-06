export function buildStubAuth(opts?: { isOAuth?: boolean; key?: string }) {
  const isOAuth = opts?.isOAuth ?? false;
  return {
    isOAuth: () => isOAuth,
    async getCredential() {
      if (isOAuth) {
        return { type: "oauth" as const, accessToken: "test-token" };
      }
      return { type: "api_key" as const, key: opts?.key ?? "test-key" };
    },
  };
}
