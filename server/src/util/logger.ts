import { config } from '../config/env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = WEIGHT[config.LOG_LEVEL];

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (WEIGHT[level] < threshold) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields });
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
