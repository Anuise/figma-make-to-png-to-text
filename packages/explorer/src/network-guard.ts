export type NetworkGuardOptions = {
  allowedHosts: string[];
};

export class NetworkGuard {
  private allowedHosts: Set<string>;

  constructor(options: NetworkGuardOptions) {
    this.allowedHosts = new Set(options.allowedHosts);
  }

  isAllowed(url: string): boolean {
    try {
      const parsed = new URL(url);
      return this.allowedHosts.has(parsed.hostname);
    } catch {
      return false;
    }
  }

  isDenied(url: string): boolean {
    return !this.isAllowed(url);
  }
}
