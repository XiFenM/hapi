import { describe, expect, it } from 'vitest'
import { getClaudeComposerModelOptions, getNextClaudeComposerModel } from './claudeModelOptions'

describe('getClaudeComposerModelOptions', () => {
    it('includes the active non-preset Claude model in the options list', () => {
        expect(getClaudeComposerModelOptions('claude-opus-4-1-20250805')).toEqual([
            { value: null, label: 'Auto' },
            { value: 'claude-opus-4-1-20250805', label: 'claude-opus-4-1-20250805' },
            { value: 'sonnet', label: 'Sonnet' },
            { value: 'sonnet[1m]', label: 'Sonnet 1M' },
            { value: 'opus', label: 'Opus' },
            { value: 'opus[1m]', label: 'Opus 1M' },
        ])
    })

    it('does not duplicate preset Claude models', () => {
        expect(getClaudeComposerModelOptions('opus')).toEqual([
            { value: null, label: 'Auto' },
            { value: 'sonnet', label: 'Sonnet' },
            { value: 'sonnet[1m]', label: 'Sonnet 1M' },
            { value: 'opus', label: 'Opus' },
            { value: 'opus[1m]', label: 'Opus 1M' },
        ])
    })
})

describe('getNextClaudeComposerModel', () => {
    it('cycles from a non-preset Claude model to the next selectable model instead of auto', () => {
        expect(getNextClaudeComposerModel('claude-opus-4-1-20250805')).toBe('sonnet')
    })
})

describe('getClaudeComposerModelOptions with machine override', () => {
    const override = [
        { id: 'haiku', label: 'Haiku' },
        { id: 'claude-sonnet-4-7', label: 'Sonnet 4.7' },
    ]

    it('uses the override list instead of built-in presets when provided', () => {
        expect(getClaudeComposerModelOptions(null, override)).toEqual([
            { value: null, label: 'Auto' },
            { value: 'haiku', label: 'Haiku' },
            { value: 'claude-sonnet-4-7', label: 'Sonnet 4.7' },
        ])
    })

    it('prepends the current model when it is not in the override list', () => {
        const options = getClaudeComposerModelOptions('opus', override)
        expect(options[0]).toEqual({ value: null, label: 'Auto' })
        expect(options[1]).toEqual({ value: 'opus', label: 'Opus' })
        expect(options.slice(2)).toEqual([
            { value: 'haiku', label: 'Haiku' },
            { value: 'claude-sonnet-4-7', label: 'Sonnet 4.7' },
        ])
    })

    it('falls back to built-in presets when override is empty', () => {
        expect(getClaudeComposerModelOptions(null, [])).toEqual([
            { value: null, label: 'Auto' },
            { value: 'sonnet', label: 'Sonnet' },
            { value: 'sonnet[1m]', label: 'Sonnet 1M' },
            { value: 'opus', label: 'Opus' },
            { value: 'opus[1m]', label: 'Opus 1M' },
        ])
    })
})
