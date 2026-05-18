/**
 * WebSocket client for machine/runner communication with hapi-hub
 */

import { io, type Socket } from 'socket.io-client'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { z } from 'zod'
import { logger } from '@/ui/logger'
import { configuration } from '@/configuration'
import type { Update, UpdateMachineBody } from '@hapi/protocol'
import type { ClaudeModelOption, RunnerState, Machine, MachineMetadata } from './types'
import { ClaudeModelOptionSchema, RunnerStateSchema, MachineMetadataSchema } from './types'
import { backoff } from '@/utils/time'
import { getInvokedCwd } from '@/utils/invokedCwd'
import { updateSettings } from '@/persistence'
import { RpcHandlerManager } from './rpc/RpcHandlerManager'
import { registerCommonHandlers } from '../modules/common/registerCommonHandlers'
import {
    listOpencodeModelsForCwd,
    type ListOpencodeModelsForCwdRequest,
    type ListOpencodeModelsForCwdResponse
} from '../modules/common/opencodeModels'
import type { SpawnSessionOptions, SpawnSessionResult } from '../modules/common/rpcTypes'
import { applyVersionedAck } from './versionedUpdate'
import { buildSocketIoExtraHeaderOptions } from './hubExtraHeaders'

const setMachineClaudeOptionsRequestSchema = z.object({
    models: z.array(ClaudeModelOptionSchema).max(50),
    defaultContextWindow: z.number().int().positive().max(10_000_000).optional()
})

interface ServerToRunnerEvents {
    update: (data: Update) => void
    'rpc-request': (data: { method: string; params: string }, callback: (response: string) => void) => void
    error: (data: { message: string }) => void
}

interface RunnerToServerEvents {
    'machine-alive': (data: { machineId: string; time: number }) => void
    'machine-update-metadata': (data: { machineId: string; metadata: unknown; expectedVersion: number }, cb: (answer: {
        result: 'error'
    } | {
        result: 'version-mismatch'
        version: number
        metadata: unknown | null
    } | {
        result: 'success'
        version: number
        metadata: unknown | null
    }) => void) => void
    'machine-update-state': (data: { machineId: string; runnerState: unknown | null; expectedVersion: number }, cb: (answer: {
        result: 'error'
    } | {
        result: 'version-mismatch'
        version: number
        runnerState: unknown | null
    } | {
        result: 'success'
        version: number
        runnerState: unknown | null
    }) => void) => void
    'rpc-register': (data: { method: string }) => void
    'rpc-unregister': (data: { method: string }) => void
}

type MachineRpcHandlers = {
    spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>
    stopSession: (sessionId: string) => boolean
    requestShutdown: () => void
}

interface PathExistsRequest {
    paths: string[]
}

interface PathExistsResponse {
    exists: Record<string, boolean>
}

// Fork: machine-scope file APIs (no validatePath restriction)
interface MachineListDirectoryRequest {
    path: string
}

interface MachineDirectoryEntry {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

interface MachineListDirectoryResponse {
    success: boolean
    entries?: MachineDirectoryEntry[]
    error?: string
}

interface MachineReadFileRequest {
    path: string
}

interface MachineReadFileResponse {
    success: boolean
    content?: string
    error?: string
}

interface MachineReadFileChunkRequest {
    path: string
    offset: number
    length: number
}

interface MachineReadFileChunkResponse {
    success: boolean
    content?: string  // base64
    bytesRead?: number
    error?: string
}

interface MachineFileStatRequest {
    path: string
}

interface MachineFileStatResponse {
    success: boolean
    size?: number
    error?: string
}

// Upstream: workspace-scoped browser (with --workspace-root opt-in)
interface ListMachineDirectoryRequest {
    path: string
}

interface ListMachineDirectoryEntry {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
    isGitRepo?: boolean
}

interface ListMachineDirectoryResponse {
    success: boolean
    entries?: ListMachineDirectoryEntry[]
    error?: string
}

export class ApiMachineClient {
    private socket!: Socket<ServerToRunnerEvents, RunnerToServerEvents>
    private keepAliveInterval: NodeJS.Timeout | null = null
    private rpcHandlerManager: RpcHandlerManager

    private readonly normalizedWorkspaceRoot: string | undefined

    constructor(
        private readonly token: string,
        private readonly machine: Machine,
        private readonly workspaceRoot?: string
    ) {
        // realpath the root once so all subsequent comparisons are against
        // the canonical, symlink-resolved path. Falls back to a lexical
        // resolve if realpath fails (e.g. unusual permission setup) so we
        // still get *some* protection rather than skipping the check.
        if (workspaceRoot) {
            try {
                this.normalizedWorkspaceRoot = realpathSync(workspaceRoot)
            } catch {
                this.normalizedWorkspaceRoot = resolvePath(workspaceRoot)
            }
        } else {
            this.normalizedWorkspaceRoot = undefined
        }

        this.rpcHandlerManager = new RpcHandlerManager({
            scopePrefix: this.machine.id,
            logger: (msg, data) => logger.debug(msg, data)
        })

        registerCommonHandlers(this.rpcHandlerManager, getInvokedCwd())

        this.rpcHandlerManager.registerHandler<PathExistsRequest, PathExistsResponse>('path-exists', async (params) => {
            const rawPaths = Array.isArray(params?.paths) ? params.paths : []
            const uniquePaths = Array.from(new Set(rawPaths.filter((path): path is string => typeof path === 'string')))
            const exists: Record<string, boolean> = {}

            await Promise.all(uniquePaths.map(async (path) => {
                const trimmed = path.trim()
                if (!trimmed) return
                try {
                    const stats = await stat(trimmed)
                    exists[trimmed] = stats.isDirectory()
                } catch {
                    exists[trimmed] = false
                }
            }))

            return { exists }
        })

        // Fork: machine-scope directory listing (no workspace restriction)
        this.rpcHandlerManager.registerHandler<MachineListDirectoryRequest, MachineListDirectoryResponse>('machine-list-directory', async (params) => {
            const targetPath = (params?.path || '').trim()
            if (!targetPath) {
                return { success: false, error: 'Path is required' }
            }

            try {
                const entries = await readdir(targetPath, { withFileTypes: true })
                const directoryEntries: MachineDirectoryEntry[] = await Promise.all(
                    entries.map(async (entry) => {
                        const fullPath = join(targetPath, entry.name)
                        let type: 'file' | 'directory' | 'other' = 'other'
                        let size: number | undefined
                        let modified: number | undefined

                        if (entry.isDirectory()) {
                            type = 'directory'
                        } else if (entry.isFile()) {
                            type = 'file'
                        }

                        if (!entry.isSymbolicLink()) {
                            try {
                                const stats = await stat(fullPath)
                                size = stats.size
                                modified = stats.mtime.getTime()
                            } catch {
                                // skip stat errors
                            }
                        }

                        return { name: entry.name, type, size, modified }
                    })
                )

                directoryEntries.sort((a, b) => {
                    if (a.type === 'directory' && b.type !== 'directory') return -1
                    if (a.type !== 'directory' && b.type === 'directory') return 1
                    return a.name.localeCompare(b.name)
                })

                return { success: true, entries: directoryEntries }
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : 'Failed to list directory' }
            }
        })

        // Upstream: workspace-scoped directory listing (--workspace-root opt-in)
        this.rpcHandlerManager.registerHandler<ListMachineDirectoryRequest, ListMachineDirectoryResponse>('list-directory', async (params) => {
            if (!this.normalizedWorkspaceRoot) {
                return { success: false, error: 'Workspace browsing is not enabled for this machine' }
            }

            const rawPath = typeof params?.path === 'string' ? params.path.trim() : ''
            if (!rawPath) {
                return { success: false, error: 'Path is required' }
            }

            const targetPath = await this.resolveForWorkspaceCheck(rawPath)
            if (!this.isWithinWorkspaceRoot(targetPath)) {
                return { success: false, error: 'Path is outside workspace root' }
            }

            try {
                const dirStat = await stat(targetPath)
                if (!dirStat.isDirectory()) {
                    return { success: false, error: 'Path is not a directory' }
                }

                const dirEntries = await readdir(targetPath, { withFileTypes: true })
                const entries: ListMachineDirectoryEntry[] = []

                await Promise.all(dirEntries.map(async (entry) => {
                    if (entry.name.startsWith('.')) return

                    const fullPath = join(targetPath, entry.name)
                    let type: 'file' | 'directory' | 'other' = 'other'
                    let size: number | undefined
                    let modified: number | undefined
                    let isGitRepo = false

                    if (entry.isDirectory()) {
                        type = 'directory'
                        try {
                            const gitStat = await stat(join(fullPath, '.git'))
                            isGitRepo = gitStat.isDirectory() || gitStat.isFile()
                        } catch {
                            // not a git repo
                        }
                    } else if (entry.isFile()) {
                        type = 'file'
                    }

                    if (!entry.isSymbolicLink()) {
                        try {
                            const stats = await stat(fullPath)
                            size = stats.size
                            modified = stats.mtime.getTime()
                        } catch {
                            // ignore stat errors
                        }
                    }

                    entries.push({ name: entry.name, type, size, modified, isGitRepo })
                }))

                entries.sort((a, b) => {
                    if (a.type === 'directory' && b.type !== 'directory') return -1
                    if (a.type !== 'directory' && b.type === 'directory') return 1
                    return a.name.localeCompare(b.name)
                })

                return { success: true, entries }
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : 'Failed to list directory' }
            }
        })

        // Fork: machine-scope file read/stat/chunk
        this.rpcHandlerManager.registerHandler<MachineReadFileRequest, MachineReadFileResponse>('machine-read-file', async (params) => {
            const targetPath = (params?.path || '').trim()
            if (!targetPath) {
                return { success: false, error: 'Path is required' }
            }

            try {
                const buffer = await readFile(targetPath)
                const content = buffer.toString('base64')
                return { success: true, content }
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : 'Failed to read file' }
            }
        })

        this.rpcHandlerManager.registerHandler<MachineFileStatRequest, MachineFileStatResponse>('machine-file-stat', async (params) => {
            const targetPath = (params?.path || '').trim()
            if (!targetPath) {
                return { success: false, error: 'Path is required' }
            }

            try {
                const stats = await stat(targetPath)
                return { success: true, size: stats.size }
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : 'Failed to stat file' }
            }
        })

        this.rpcHandlerManager.registerHandler<MachineReadFileChunkRequest, MachineReadFileChunkResponse>('machine-read-file-chunk', async (params) => {
            const targetPath = (params?.path || '').trim()
            if (!targetPath) {
                return { success: false, error: 'Path is required' }
            }
            const offset = params?.offset ?? 0
            const length = params?.length ?? (2 * 1024 * 1024)

            try {
                const fullBuffer = await readFile(targetPath)
                const chunk = fullBuffer.subarray(offset, offset + length)
                const content = chunk.toString('base64')
                return { success: true, content, bytesRead: chunk.length }
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : 'Failed to read file chunk' }
            }
        })

        // Upstream: workspace-scoped re-registration of OpenCode model discovery.
        // OpenCode model discovery spawns an `opencode acp` subprocess scoped to the
        // requested cwd, so it must obey the same workspace-root containment as
        // `list-directory` and `spawn-happy-session`. Re-register the handler that
        // `registerCommonHandlers` installed unguarded with a guarded version that
        // resolves symlinks and rejects paths outside the configured root before
        // delegating to the lower-level probe. This intentionally overwrites the
        // earlier registration on the same scoped method name.
        this.rpcHandlerManager.registerHandler<ListOpencodeModelsForCwdRequest, ListOpencodeModelsForCwdResponse>(
            'listOpencodeModelsForCwd',
            async (params) => {
                const rawCwd = typeof params?.cwd === 'string' ? params.cwd.trim() : ''
                if (!rawCwd) {
                    return { success: false, error: 'cwd is required' }
                }

                const resolvedCwd = await this.resolveForWorkspaceCheck(rawCwd)
                if (!this.isWithinWorkspaceRoot(resolvedCwd)) {
                    return { success: false, error: 'Path is outside workspace root' }
                }

                return await listOpencodeModelsForCwd(resolvedCwd)
            }
        )
    }

    private registerMachineClaudeOptionsHandler(): void {
        this.rpcHandlerManager.registerHandler('set-machine-claude-options', async (params: unknown) => {
            const parsed = setMachineClaudeOptionsRequestSchema.safeParse(params)
            if (!parsed.success) {
                throw new Error('Invalid set-machine-claude-options payload')
            }
            const models: ClaudeModelOption[] = parsed.data.models
            const defaultContextWindow = parsed.data.defaultContextWindow

            await updateSettings((current) => ({
                ...current,
                claude: {
                    ...(current.claude ?? {}),
                    models: models.length > 0 ? models : undefined,
                    defaultContextWindow: defaultContextWindow
                }
            }))

            await this.updateMachineMetadata((metadata) => ({
                ...(metadata ?? this.buildFallbackMetadata()),
                claudeModels: models.length > 0 ? models : undefined,
                claudeDefaultContextWindow: defaultContextWindow
            }))

            return { models, defaultContextWindow: defaultContextWindow ?? null }
        })
    }

    private buildFallbackMetadata(): MachineMetadata {
        // Only used when metadata was never populated (rare — registration
        // always supplies it). Keeps required fields non-empty.
        return {
            host: 'unknown',
            platform: 'unknown',
            happyCliVersion: 'unknown',
            homeDir: 'unknown',
            happyHomeDir: configuration.happyHomeDir,
            happyLibDir: 'unknown'
        }
    }

    private isWithinWorkspaceRoot(absolutePath: string): boolean {
        if (!this.normalizedWorkspaceRoot) return true
        const rel = relative(this.normalizedWorkspaceRoot, absolutePath)
        return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    }

    /**
     * Canonicalize a path for workspace-root containment checks. Resolves
     * symlinks via realpath so a symlink such as `/safe/out -> /etc` cannot
     * be used to escape the configured root with a lexical-only check.
     *
     * If the path doesn't exist (e.g. a session is being spawned in a
     * directory we'll create), walks up to the nearest existing ancestor
     * and realpaths *that*, joining the missing tail back on. This way the
     * check still runs against the real on-disk location once any
     * intermediate symlink in the parent chain has been resolved.
     */
    private async resolveForWorkspaceCheck(path: string): Promise<string> {
        const absolute = resolvePath(path)
        try {
            return await realpath(absolute)
        } catch {
            const missing: string[] = []
            let cursor = absolute
            while (cursor !== dirname(cursor)) {
                missing.unshift(basename(cursor))
                cursor = dirname(cursor)
                try {
                    return join(await realpath(cursor), ...missing)
                } catch {
                    // keep walking to the nearest existing parent
                }
            }
            return absolute
        }
    }

    setRPCHandlers({ spawnSession, stopSession, requestShutdown }: MachineRpcHandlers): void {
        this.registerMachineClaudeOptionsHandler()

        this.rpcHandlerManager.registerHandler('spawn-happy-session', async (params: any) => {
            const { directory, sessionId, resumeSessionId, machineId, approvedNewDirectoryCreation, agent, model, effort, modelReasoningEffort, yolo, permissionMode, token, sessionType, worktreeName, allowedTools } = params || {}

            if (!directory) {
                throw new Error('Directory is required')
            }

            const resolvedDirectory = await this.resolveForWorkspaceCheck(directory)
            if (!this.isWithinWorkspaceRoot(resolvedDirectory)) {
                return { type: 'error', errorMessage: 'Directory is outside this machine\'s workspace root' }
            }

            const result = await spawnSession({
                directory,
                sessionId,
                resumeSessionId,
                machineId,
                approvedNewDirectoryCreation,
                agent,
                model,
                effort,
                modelReasoningEffort,
                yolo,
                permissionMode,
                token,
                sessionType,
                worktreeName,
                allowedTools: Array.isArray(allowedTools)
                    ? allowedTools.filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
                    : undefined
            })

            switch (result.type) {
                case 'success':
                    return { type: 'success', sessionId: result.sessionId }
                case 'requestToApproveDirectoryCreation':
                    return { type: 'requestToApproveDirectoryCreation', directory: result.directory }
                case 'error':
                    return { type: 'error', errorMessage: result.errorMessage }
            }
        })

        this.rpcHandlerManager.registerHandler('stop-session', (params: any) => {
            const { sessionId } = params || {}
            if (!sessionId) {
                throw new Error('Session ID is required')
            }

            const success = stopSession(sessionId)
            if (!success) {
                throw new Error('Session not found or failed to stop')
            }

            return { message: 'Session stopped' }
        })

        this.rpcHandlerManager.registerHandler('stop-runner', () => {
            setTimeout(() => requestShutdown(), 100)
            return { message: 'Runner stop request acknowledged' }
        })
    }

    async updateMachineMetadata(handler: (metadata: MachineMetadata | null) => MachineMetadata): Promise<void> {
        await backoff(async () => {
            const updated = handler(this.machine.metadata)

            const answer = await this.socket.emitWithAck('machine-update-metadata', {
                machineId: this.machine.id,
                metadata: updated,
                expectedVersion: this.machine.metadataVersion
            }) as unknown

            applyVersionedAck(answer, {
                valueKey: 'metadata',
                parseValue: (value) => {
                    const parsed = MachineMetadataSchema.safeParse(value)
                    return parsed.success ? parsed.data : null
                },
                applyValue: (value) => {
                    this.machine.metadata = value
                },
                applyVersion: (version) => {
                    this.machine.metadataVersion = version
                },
                logInvalidValue: (context, version) => {
                    const suffix = context === 'success' ? 'ack' : 'version-mismatch ack'
                    logger.debug(`[API MACHINE] Ignoring invalid metadata value from ${suffix}`, { version })
                },
                invalidResponseMessage: 'Invalid machine-update-metadata response',
                errorMessage: 'Machine metadata update failed',
                versionMismatchMessage: 'Metadata version mismatch'
            })
        })
    }

    async updateRunnerState(handler: (state: RunnerState | null) => RunnerState): Promise<void> {
        await backoff(async () => {
            const updated = handler(this.machine.runnerState)

            const answer = await this.socket.emitWithAck('machine-update-state', {
                machineId: this.machine.id,
                runnerState: updated,
                expectedVersion: this.machine.runnerStateVersion
            }) as unknown

            applyVersionedAck(answer, {
                valueKey: 'runnerState',
                parseValue: (value) => {
                    const parsed = RunnerStateSchema.safeParse(value)
                    return parsed.success ? parsed.data : null
                },
                applyValue: (value) => {
                    this.machine.runnerState = value
                },
                applyVersion: (version) => {
                    this.machine.runnerStateVersion = version
                },
                logInvalidValue: (context, version) => {
                    const suffix = context === 'success' ? 'ack' : 'version-mismatch ack'
                    logger.debug(`[API MACHINE] Ignoring invalid runnerState value from ${suffix}`, { version })
                },
                invalidResponseMessage: 'Invalid machine-update-state response',
                errorMessage: 'Machine state update failed',
                versionMismatchMessage: 'Runner state version mismatch'
            })
        })
    }

    connect(): void {
        this.socket = io(`${configuration.apiUrl}/cli`, {
            transports: ['websocket'],
            auth: {
                token: this.token,
                clientType: 'machine-scoped' as const,
                machineId: this.machine.id
            },
            path: '/socket.io/',
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            ...buildSocketIoExtraHeaderOptions()
        })

        this.socket.on('connect', () => {
            logger.debug('[API MACHINE] Connected to bot')
            this.rpcHandlerManager.onSocketConnect(this.socket)
            this.updateRunnerState((state) => ({
                ...(state ?? {}),
                status: 'running',
                pid: process.pid,
                httpPort: this.machine.runnerState?.httpPort,
                startedAt: Date.now()
            })).catch((error) => {
                logger.debug('[API MACHINE] Failed to update runner state on connect', error)
            })

            const hubWorkspaceRoot = this.machine.metadata?.workspaceRoot
            const desiredWorkspaceRoot = this.workspaceRoot
            if (desiredWorkspaceRoot !== hubWorkspaceRoot) {
                if (desiredWorkspaceRoot) {
                    console.log(`[HAPI] Syncing workspace root to hub: ${desiredWorkspaceRoot} (current hub value: ${hubWorkspaceRoot ?? 'none'})`)
                } else {
                    console.log(`[HAPI] Clearing workspace root on hub (was: ${hubWorkspaceRoot})`)
                }
                this.updateMachineMetadata((current) => {
                    const base = current ?? this.machine.metadata
                    if (!base) {
                        return { workspaceRoot: desiredWorkspaceRoot } as MachineMetadata
                    }
                    if (desiredWorkspaceRoot) {
                        return { ...base, workspaceRoot: desiredWorkspaceRoot }
                    }
                    const { workspaceRoot: _omit, ...rest } = base
                    return rest as MachineMetadata
                }).then(() => {
                    console.log(`[HAPI] Workspace root synced: ${this.machine.metadata?.workspaceRoot ?? '(none)'}`)
                }).catch((error) => {
                    console.error('[HAPI] Failed to sync workspace root:', error instanceof Error ? error.message : error)
                })
            } else if (desiredWorkspaceRoot) {
                console.log(`[HAPI] Workspace root already up to date on hub: ${desiredWorkspaceRoot}`)
            }

            this.startKeepAlive()
        })

        this.socket.on('disconnect', () => {
            logger.debug('[API MACHINE] Disconnected from bot')
            this.rpcHandlerManager.onSocketDisconnect()
            this.stopKeepAlive()
        })

        this.socket.on('rpc-request', async (data: { method: string; params: string }, callback: (response: string) => void) => {
            callback(await this.rpcHandlerManager.handleRequest(data))
        })

        this.socket.on('update', (data: Update) => {
            if (data.body.t !== 'update-machine') {
                return
            }

            const update = data.body as UpdateMachineBody
            if (update.machineId !== this.machine.id) {
                return
            }

            if (update.metadata) {
                const parsed = MachineMetadataSchema.safeParse(update.metadata.value)
                if (parsed.success) {
                    this.machine.metadata = parsed.data
                } else {
                    logger.debug('[API MACHINE] Ignoring invalid metadata update', { version: update.metadata.version })
                }
                this.machine.metadataVersion = update.metadata.version
            }

            if (update.runnerState) {
                const next = update.runnerState.value
                if (next == null) {
                    this.machine.runnerState = null
                } else {
                    const parsed = RunnerStateSchema.safeParse(next)
                    if (parsed.success) {
                        this.machine.runnerState = parsed.data
                    } else {
                        logger.debug('[API MACHINE] Ignoring invalid runnerState update', { version: update.runnerState.version })
                    }
                }
                this.machine.runnerStateVersion = update.runnerState.version
            }
        })

        this.socket.on('connect_error', (error) => {
            logger.debug(`[API MACHINE] Connection error: ${error.message}`)
        })

        this.socket.on('error', (payload) => {
            logger.debug('[API MACHINE] Socket error:', payload)
        })
    }

    private startKeepAlive(): void {
        this.stopKeepAlive()
        this.keepAliveInterval = setInterval(() => {
            this.socket.emit('machine-alive', {
                machineId: this.machine.id,
                time: Date.now()
            })
        }, 20_000)
    }

    private stopKeepAlive(): void {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval)
            this.keepAliveInterval = null
        }
    }

    shutdown(): void {
        this.stopKeepAlive()
        if (this.socket) {
            this.socket.close()
        }
    }
}
