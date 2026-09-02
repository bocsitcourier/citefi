import * as net from "node:net";

export type PortProbe = (port: number, host: string) => Promise<boolean>;

export const probePortAvailable: PortProbe = (port, host) =>
  new Promise<boolean>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
      else reject(error);
    });
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });

export async function assertPortAvailable(
  port: number,
  probe: PortProbe = probePortAvailable,
  host = "0.0.0.0",
): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${port}`);
  }
  if (!(await probe(port, host))) {
    throw new Error(
      `Port ${port} is already in use; refusing to terminate an unowned process. ` +
      "Stop the existing service or configure a different PORT.",
    );
  }
}