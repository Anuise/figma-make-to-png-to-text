export type BudgetOptions = {
  maxInteractions: number;
  maxCandidateScreens: number;
  maxDurationMs: number;
  startedAt: number;
};

export type ExhaustedReason = "interactions" | "screens" | "time";

export class ExplorationBudget {
  private interactions = 0;
  private screens = 0;
  private _pendingBranches: string[] = [];

  constructor(private options: BudgetOptions) {}

  recordInteraction(): void {
    this.interactions++;
  }

  recordScreen(): void {
    this.screens++;
  }

  addPendingBranch(branch: string): void {
    this._pendingBranches.push(branch);
  }

  removePendingBranch(branch: string): void {
    const idx = this._pendingBranches.indexOf(branch);
    if (idx !== -1) {
      this._pendingBranches.splice(idx, 1);
    }
  }

  get pendingBranches(): string[] {
    return [...this._pendingBranches];
  }

  isExhausted(): boolean {
    return this.getExhaustedReason() !== null;
  }

  getExhaustedReason(): ExhaustedReason | null {
    if (this.interactions >= this.options.maxInteractions) return "interactions";
    if (this.screens >= this.options.maxCandidateScreens) return "screens";
    if (Date.now() - this.options.startedAt >= this.options.maxDurationMs) return "time";
    return null;
  }
}
