export type ScreenFingerprint = {
  route: string;
  uiHash: string;
  visibleStateHash: string;
  operationPath: string[];
};

export class ScreenDeduplicator {
  private seen = new Set<string>();

  private key(screen: ScreenFingerprint): string {
    return `${screen.route}\0${screen.uiHash}\0${screen.visibleStateHash}`;
  }

  isDuplicate(screen: ScreenFingerprint): boolean {
    return this.seen.has(this.key(screen));
  }

  register(screen: ScreenFingerprint): void {
    this.seen.add(this.key(screen));
  }

  get size(): number {
    return this.seen.size;
  }
}
