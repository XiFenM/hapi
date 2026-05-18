export interface SpawnSessionOptions {
    machineId?: string
    directory: string
    sessionId?: string
    resumeSessionId?: string
    approvedNewDirectoryCreation?: boolean
    agent?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'
    model?: string
    effort?: string
    modelReasoningEffort?: string
    yolo?: boolean
    permissionMode?: string
    token?: string
    sessionType?: 'simple' | 'worktree'
    worktreeName?: string
    // Tools pre-approved for this session via `--allowedTools`. Useful for
    // letting async/background sub-agents reach tools like WebFetch and
    // WebSearch — those run in a context where permission prompts can't
    // be surfaced, so they have to be granted up front. Only meaningful
    // for `agent: 'claude'`.
    allowedTools?: string[]
}

export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string }
