import type { AgentMessage } from './types';

/**
 * Detect rate_limit_event JSON in agent text output and convert to
 * a standardized AgentMessage, so the web layer doesn't need to
 * parse undocumented Claude-internal JSON formats.
 *
 * Converted text format (pipe-delimited, parsed by web's reducerEvents.ts):
 *   - "Claude AI usage limit warning|{unixSeconds}|{percentInt}|{rateLimitType}"
 *   - "Claude AI usage limit reached|{unixSeconds}|{rateLimitType}"
 *
 * Returns null if the text is not a rate_limit_event (pass through as-is).
 * Returns { suppress: true } for known-noisy statuses (e.g. 'allowed').
 * Returns { suppress: false, message } for statuses worth displaying.
 * Optional leadingText is emitted as a normal text message when the
 * rate_limit_event was appended to regular assistant output in the
 * same chunk.
 */
export type RateLimitResult =
    | null
    | { suppress: true; leadingText?: string }
    | { suppress: false; message: AgentMessage; leadingText?: string };

export function parseRateLimitText(text: string): RateLimitResult {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;

    // Fast path: the whole chunk is JSON.
    if (trimmed[0] === '{') {
        const direct = classifyJson(trimmed);
        if (direct) return direct;
    }

    // Slow path: rate_limit_event JSON appended to regular text.
    // Claude sometimes emits the event as a trailing `{...}` block in
    // the same agentMessageChunk as the assistant reply.
    const splitAt = findTrailingJsonStart(trimmed);
    if (splitAt < 0) return null;

    const leading = trimmed.slice(0, splitAt).trimEnd();
    const candidate = trimmed.slice(splitAt);
    const result = classifyJson(candidate);
    if (!result) return null;

    if (leading.length === 0) return result;
    return { ...result, leadingText: leading };
}

function classifyJson(candidate: string): RateLimitResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(candidate);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;

    // Unwrap { type: "output", data: { ... } } wrapper
    const record = parsed as Record<string, unknown>;
    let inner = record;
    if (record.type === 'output' && typeof record.data === 'object' && record.data !== null) {
        inner = record.data as Record<string, unknown>;
    }

    if (inner.type !== 'rate_limit_event') return null;

    const info = inner.rate_limit_info;
    if (typeof info !== 'object' || info === null) return null;

    const { status, resetsAt, utilization, rateLimitType } = info as Record<string, unknown>;
    if (typeof resetsAt !== 'number') return null;

    if (status === 'allowed_warning') {
        const pct = typeof utilization === 'number' ? Math.round(utilization * 100) : 0;
        const limitType = typeof rateLimitType === 'string' ? rateLimitType : '';
        return {
            suppress: false,
            message: {
                type: 'text',
                text: `Claude AI usage limit warning|${resetsAt}|${pct}|${limitType}`,
            },
        };
    }

    if (status === 'rejected') {
        const limitType = typeof rateLimitType === 'string' ? rateLimitType : '';
        return {
            suppress: false,
            message: {
                type: 'text',
                text: `Claude AI usage limit reached|${resetsAt}|${limitType}`,
            },
        };
    }

    if (status === 'allowed') {
        return { suppress: true };
    }

    // Unknown status — return null so the original text passes through.
    // Suppressing unknown statuses risks hiding important new events.
    return null;
}

/**
 * Find the start index of a trailing JSON object in `text`. Scans right-
 * to-left for a `{` whose matching close brace is the last non-space
 * character. Returns -1 if none found. Ignores braces inside strings.
 */
function findTrailingJsonStart(text: string): number {
    let i = text.length - 1;
    while (i >= 0 && /\s/.test(text[i])) i--;
    if (i < 0 || text[i] !== '}') return -1;
    const end = i;

    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = end; j >= 0; j--) {
        const ch = text[j];
        if (escape) { escape = false; continue; }
        if (inString) {
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '}') depth++;
        else if (ch === '{') {
            depth--;
            if (depth === 0) return j;
        }
    }
    return -1;
}
