const states = Object.freeze({
  idle: Object.freeze({ scan: 0, queue: 0, receiptStamp: 0, gateTone: "ready" }),
  loading: Object.freeze({ scan: 0.45, queue: 0, receiptStamp: 0, gateTone: "evidence" }),
  analyzing: Object.freeze({ scan: 1, queue: 0.35, receiptStamp: 0, gateTone: "evidence" }),
  verified: Object.freeze({ scan: 0, queue: 1, receiptStamp: 1, gateTone: "verified" }),
  error: Object.freeze({ scan: 0, queue: 0, receiptStamp: 0, gateTone: "caution" })
});

export function getWorkspaceMotion(state) {
  if (!Object.hasOwn(states, state)) {
    throw new Error(`Unknown workspace motion state: ${state}`);
  }

  return { ...states[state] };
}
