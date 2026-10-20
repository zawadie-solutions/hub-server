import pino from "pino";

const root = pino({ level: process.env.LOG_LEVEL ?? "info", base: { app: "company-research" } });

export const getLogger = (name: string) => root.child({ module: name });
