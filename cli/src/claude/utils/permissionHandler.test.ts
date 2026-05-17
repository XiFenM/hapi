import { describe, expect, it, vi } from 'vitest';
import { PermissionHandler } from './permissionHandler';
import { PLAN_FAKE_REJECT, PLAN_FAKE_RESTART } from '../sdk/prompts';
import type { Session } from '../session';

function createFakeSession() {
    const queueItems: { message: string; mode: unknown }[] = [];

    const session = {
        client: {
            rpcHandlerManager: {
                registerHandler: vi.fn(),
            },
            updateAgentState: vi.fn(),
        },
        queue: {
            unshift: vi.fn((message: string, mode: unknown) => {
                queueItems.push({ message, mode });
            }),
        },
        setPermissionMode: vi.fn(),
    } as unknown as Session;

    return { session, queueItems };
}

describe('PermissionHandler — YOLO plan mode', () => {
    it('injects PLAN_FAKE_RESTART and denies exit_plan_mode in bypassPermissions', async () => {
        const { session, queueItems } = createFakeSession();
        const handler = new PermissionHandler(session);
        handler.handleModeChange('bypassPermissions');

        // Simulate Claude emitting an assistant message with exit_plan_mode tool_use
        handler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tc-1', name: 'exit_plan_mode', input: {} }],
            },
        } as any);

        const result = await handler.handleToolCall(
            'exit_plan_mode',
            {},
            { permissionMode: 'bypassPermissions' } as any,
            { signal: new AbortController().signal }
        );

        // Should deny with PLAN_FAKE_REJECT (so Claude restarts)
        expect(result.behavior).toBe('deny');
        expect(result).toEqual({ behavior: 'deny', message: PLAN_FAKE_REJECT });

        // Should inject PLAN_FAKE_RESTART into the queue
        expect(queueItems).toHaveLength(1);
        expect(queueItems[0].message).toBe(PLAN_FAKE_RESTART);
        expect(queueItems[0].mode).toEqual({ permissionMode: 'bypassPermissions' });
    });

    it('injects PLAN_FAKE_RESTART for ExitPlanMode variant', async () => {
        const { session, queueItems } = createFakeSession();
        const handler = new PermissionHandler(session);
        handler.handleModeChange('bypassPermissions');

        handler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tc-2', name: 'ExitPlanMode', input: {} }],
            },
        } as any);

        const result = await handler.handleToolCall(
            'ExitPlanMode',
            {},
            { permissionMode: 'bypassPermissions' } as any,
            { signal: new AbortController().signal }
        );

        expect(result.behavior).toBe('deny');
        expect(result).toEqual({ behavior: 'deny', message: PLAN_FAKE_REJECT });
        expect(queueItems).toHaveLength(1);
        expect(queueItems[0].message).toBe(PLAN_FAKE_RESTART);
    });

    it('allows normal tools in bypassPermissions without queue injection', async () => {
        const { session, queueItems } = createFakeSession();
        const handler = new PermissionHandler(session);
        handler.handleModeChange('bypassPermissions');

        handler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tc-3', name: 'Bash', input: { command: 'ls' } }],
            },
        } as any);

        const result = await handler.handleToolCall(
            'Bash',
            { command: 'ls' },
            { permissionMode: 'bypassPermissions' } as any,
            { signal: new AbortController().signal }
        );

        expect(result.behavior).toBe('allow');
        expect(queueItems).toHaveLength(0);
    });
});

describe('PermissionHandler — SDK-provided toolUseID', () => {
    // Regression: sub-agent (sidechain) tool calls used to fail with
    // "Could not resolve tool call ID for X" because the assistant tool_use
    // block arrives *after* canCallTool fires. The SDK already includes
    // tool_use_id in the can_use_tool control request, so we should use it
    // directly and skip the name+input lookup.
    it('uses toolUseID from options instead of matching against tracked tool_use blocks', async () => {
        const { session } = createFakeSession();
        const handler = new PermissionHandler(session);
        handler.handleModeChange('default');

        const subAgentToolUseId = 'toolu_subagent_WebFetch_42';

        // Deliberately do NOT call handler.onMessage with the tool_use block
        // — this simulates the sub-agent race where the assistant message
        // hasn't been emitted yet when canCallTool fires.
        const decision = handler.handleToolCall(
            'WebFetch',
            { url: 'https://example.com', prompt: 'fetch' },
            { permissionMode: 'default' } as any,
            {
                signal: new AbortController().signal,
                toolUseID: subAgentToolUseId,
                agentID: 'agent_xyz'
            }
        );

        // Pending request must be registered under the SDK-provided id
        // immediately, without the 1-second resolveToolCallId fallback or
        // the "Could not resolve tool call ID" throw.
        await new Promise<void>((resolve) => setImmediate(resolve));

        const updateAgentState = session.client.updateAgentState as unknown as ReturnType<typeof vi.fn>;
        const lastUpdate = updateAgentState.mock.calls.at(-1)?.[0] as (s: any) => any;
        const nextState = lastUpdate?.({ requests: {}, completedRequests: {} });
        expect(nextState?.requests?.[subAgentToolUseId]).toBeDefined();
        expect(nextState?.requests?.[subAgentToolUseId].tool).toBe('WebFetch');

        // Resolve the pending request so the promise doesn't dangle.
        const registerHandler = session.client.rpcHandlerManager.registerHandler as unknown as ReturnType<typeof vi.fn>;
        const permissionRpcHandler = registerHandler.mock.calls.find(([method]) => method === 'permission')?.[1];
        await permissionRpcHandler?.({ id: subAgentToolUseId, approved: true });
        await expect(decision).resolves.toEqual({
            behavior: 'allow',
            updatedInput: { url: 'https://example.com', prompt: 'fetch' }
        });
    });

    it('falls back to name+input matching when SDK omits tool_use_id', async () => {
        const { session } = createFakeSession();
        const handler = new PermissionHandler(session);
        handler.handleModeChange('default');

        // Older SDK / sanity check: no toolUseID provided, but the assistant
        // tool_use block is already known — the legacy resolver must still
        // find it.
        handler.onMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'tc-legacy', name: 'Read', input: { file_path: '/tmp/x' } }],
            },
        } as any);

        const decision = handler.handleToolCall(
            'Read',
            { file_path: '/tmp/x' },
            { permissionMode: 'default' } as any,
            { signal: new AbortController().signal }
        );

        const registerHandler = session.client.rpcHandlerManager.registerHandler as unknown as ReturnType<typeof vi.fn>;
        const permissionRpcHandler = registerHandler.mock.calls.find(([method]) => method === 'permission')?.[1];
        // Give addPendingRequest a tick to register.
        await new Promise<void>((resolve) => setImmediate(resolve));
        await permissionRpcHandler?.({ id: 'tc-legacy', approved: true });
        await expect(decision).resolves.toEqual({
            behavior: 'allow',
            updatedInput: { file_path: '/tmp/x' }
        });
    });
});
