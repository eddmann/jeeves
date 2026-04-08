export function buildStubAuth() {
  return {
    async getCredential() {
      return {
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiresAt: Date.now() + 3600_000,
        accountId: "test-account-id",
      };
    },
  };
}
