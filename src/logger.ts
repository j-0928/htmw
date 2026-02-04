// Centralized logging utility for HTMW MCP Server
// Provides structured logs with timestamps for Render and local debugging

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

const LOG_LEVEL_MAP: Record<string, LogLevel> = {
    'DEBUG': LogLevel.DEBUG,
    'INFO': LogLevel.INFO,
    'WARN': LogLevel.WARN,
    'ERROR': LogLevel.ERROR
};

const CURRENT_LOG_LEVEL = LOG_LEVEL_MAP[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] ?? LogLevel.INFO;

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR'
};

/**
 * Log a message with structured formatting
 * @param level - Log level (DEBUG, INFO, WARN, ERROR)
 * @param tag - Context tag (e.g., 'AUTH', 'API', 'PORTFOLIO')
 * @param message - Human-readable message
 * @param data - Optional additional data to serialize
 */
export function log(level: LogLevel, tag: string, message: string, data?: any): void {
    if (level < CURRENT_LOG_LEVEL) return;

    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level];
    const formattedTag = `[${tag}]`.padEnd(12);

    let logLine = `${timestamp} ${levelName.padEnd(5)} ${formattedTag} ${message}`;

    if (data !== undefined) {
        if (data instanceof Error) {
            logLine += `\n  Error: ${data.message}`;
            if (data.stack) {
                logLine += `\n  Stack: ${data.stack.split('\n').slice(1, 4).join('\n        ')}`;
            }
        } else if (typeof data === 'object') {
            try {
                const serialized = JSON.stringify(data, null, 2);
                // Truncate very long objects
                const maxLen = 2000;
                if (serialized.length > maxLen) {
                    logLine += `\n  Data: ${serialized.substring(0, maxLen)}... [truncated]`;
                } else {
                    logLine += `\n  Data: ${serialized}`;
                }
            } catch {
                logLine += `\n  Data: [Unserializable Object]`;
            }
        } else {
            logLine += `\n  Data: ${String(data)}`;
        }
    }

    // Use appropriate console method based on level
    switch (level) {
        case LogLevel.ERROR:
            console.error(logLine);
            break;
        case LogLevel.WARN:
            console.warn(logLine);
            break;
        default:
            console.log(logLine);
    }
}

// Convenience functions
export const logDebug = (tag: string, message: string, data?: any) => log(LogLevel.DEBUG, tag, message, data);
export const logInfo = (tag: string, message: string, data?: any) => log(LogLevel.INFO, tag, message, data);
export const logWarn = (tag: string, message: string, data?: any) => log(LogLevel.WARN, tag, message, data);
export const logError = (tag: string, message: string, data?: any) => log(LogLevel.ERROR, tag, message, data);

/**
 * Create a timer for measuring operation duration
 */
export function createTimer(): () => number {
    const start = Date.now();
    return () => Date.now() - start;
}
