import { CLAUDE_MODEL_PRESETS, getClaudeModelLabel } from '@hapi/protocol'

export type ClaudeComposerModelOption = {
    value: string | null
    label: string
}

export type ClaudeComposerModelOverride = {
    id: string
    label: string
}

function normalizeClaudeComposerModel(model?: string | null): string | null {
    const trimmedModel = model?.trim()
    if (!trimmedModel || trimmedModel === 'auto' || trimmedModel === 'default') {
        return null
    }

    return trimmedModel
}

export function getClaudeComposerModelOptions(
    currentModel?: string | null,
    overrideModels?: ClaudeComposerModelOverride[] | null
): ClaudeComposerModelOption[] {
    const normalizedCurrentModel = normalizeClaudeComposerModel(currentModel)
    const options: ClaudeComposerModelOption[] = [
        { value: null, label: 'Auto' }
    ]

    // Machine-level override list takes precedence over built-in presets.
    // Empty array is treated as "not configured" — fall through to presets.
    const useOverride = Array.isArray(overrideModels) && overrideModels.length > 0
    const baseIds = useOverride
        ? overrideModels!.map((m) => m.id)
        : (CLAUDE_MODEL_PRESETS as readonly string[])

    if (normalizedCurrentModel && !baseIds.includes(normalizedCurrentModel)) {
        options.push({
            value: normalizedCurrentModel,
            label: getClaudeModelLabel(normalizedCurrentModel) ?? normalizedCurrentModel
        })
    }

    if (useOverride) {
        options.push(...overrideModels!.map((m) => ({
            value: m.id,
            label: m.label
        })))
    } else {
        options.push(...CLAUDE_MODEL_PRESETS.map((model) => ({
            value: model,
            label: getClaudeModelLabel(model) ?? model
        })))
    }

    return options
}

export function getNextClaudeComposerModel(
    currentModel?: string | null,
    overrideModels?: ClaudeComposerModelOverride[] | null
): string | null {
    const normalizedCurrentModel = normalizeClaudeComposerModel(currentModel)
    const options = getClaudeComposerModelOptions(normalizedCurrentModel, overrideModels)
    const currentIndex = options.findIndex((option) => option.value === normalizedCurrentModel)

    if (currentIndex === -1) {
        return options[0]?.value ?? null
    }

    return options[(currentIndex + 1) % options.length]?.value ?? null
}
