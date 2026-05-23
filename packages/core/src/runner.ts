import { exec } from "node:child_process";

export async function runCommand(
  command: string,
  cwd: string,
  options: { timeoutMs?: number } = {}
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return await new Promise((resolve) => {
    const child = exec(command, { cwd }, (error, stdout, stderr) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      const failure = error as { code?: number } | null;
      resolve({
        exitCode: error ? failure?.code ?? 1 : 0,
        stdout,
        stderr,
        timedOut
      });
    });

    let timedOut = false;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          if (process.platform === "win32" && child.pid) {
            exec(`taskkill /pid ${child.pid} /T /F`, () => undefined);
            return;
          }
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;
  });
}
