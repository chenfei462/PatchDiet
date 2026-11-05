export interface HomepageFrame {
  progress: number;
  scene: 0 | 1 | 2 | 3 | 4;
  intake: number;
  gateScan: number;
  fragmentEjection: number;
  receiptAssembly: number;
  handoff: number;
  pointerWeight: number;
}

export function getHomepageFrame(progress: number): HomepageFrame;
