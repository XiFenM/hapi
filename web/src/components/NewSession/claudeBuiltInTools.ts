// Canonical list of Claude Code built-in tools that can be pre-approved
// for a session via `--allowedTools`. Keep in sync with the upstream
// Claude Code CLI (`claude --tools`).
//
// When you upgrade Claude Code and a new built-in tool appears (or an
// existing one is renamed/removed), update this list — the multi-select
// on the Create Session screen reads from here.
export type BuiltInToolGroup = {
    label: string
    tools: Array<{
        name: string
        description: string
    }>
}

export const CLAUDE_BUILT_IN_TOOL_GROUPS: BuiltInToolGroup[] = [
    {
        label: 'Filesystem',
        tools: [
            { name: 'Read', description: 'Read files from disk' },
            { name: 'Write', description: 'Create / overwrite files' },
            { name: 'Edit', description: 'In-place edits to files' },
            { name: 'NotebookEdit', description: 'Edit Jupyter notebook cells' },
            { name: 'MultiEdit', description: 'Batched edits across files (legacy)' }
        ]
    },
    {
        label: 'Search',
        tools: [
            { name: 'Glob', description: 'Find files by glob pattern' },
            { name: 'Grep', description: 'Search file contents (ripgrep)' }
        ]
    },
    {
        label: 'Shell',
        tools: [
            { name: 'Bash', description: 'Run shell commands' },
            { name: 'BashOutput', description: 'Read output of a background shell' },
            { name: 'KillShell', description: 'Terminate a background shell' }
        ]
    },
    {
        label: 'Web',
        tools: [
            { name: 'WebFetch', description: 'Fetch and read a single URL' },
            { name: 'WebSearch', description: 'Search the web for queries' }
        ]
    },
    {
        label: 'Agent & workflow',
        tools: [
            { name: 'Task', description: 'Launch a sub-agent (Agent tool)' },
            { name: 'TodoWrite', description: 'Track multi-step task progress' },
            { name: 'ExitPlanMode', description: 'Exit plan mode after approval' },
            { name: 'AskUserQuestion', description: 'Prompt the user with choices' },
            { name: 'SlashCommand', description: 'Invoke a slash command' },
            { name: 'ToolSearch', description: 'Search for / load deferred tools' },
            { name: 'Skill', description: 'Invoke a registered skill' }
        ]
    }
]

export const CLAUDE_BUILT_IN_TOOL_NAMES: string[] = CLAUDE_BUILT_IN_TOOL_GROUPS
    .flatMap((group) => group.tools.map((tool) => tool.name))
