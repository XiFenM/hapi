import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentType } from './types'
import { CLAUDE_BUILT_IN_TOOL_GROUPS } from './claudeBuiltInTools'
import { useTranslation } from '@/lib/use-translation'

export function AllowedToolsSelector(props: {
    agent: AgentType
    selected: string[]
    isDisabled: boolean
    onChange: (next: string[]) => void
}) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement>(null)
    const selectedSet = useMemo(() => new Set(props.selected), [props.selected])

    useEffect(() => {
        if (!open) return
        const handlePointer = (event: MouseEvent) => {
            if (!rootRef.current) return
            if (event.target instanceof Node && rootRef.current.contains(event.target)) return
            setOpen(false)
        }
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', handlePointer)
        document.addEventListener('keydown', handleEscape)
        return () => {
            document.removeEventListener('mousedown', handlePointer)
            document.removeEventListener('keydown', handleEscape)
        }
    }, [open])

    // Only relevant for Claude — async / background sub-agents are a
    // Claude-Code-specific concept. Other agents handle permissions
    // differently or not at all. Render nothing after hooks have run so
    // hook order stays stable across agent switches.
    if (props.agent !== 'claude') {
        return null
    }

    const toggleTool = (name: string) => {
        if (selectedSet.has(name)) {
            props.onChange(props.selected.filter((t) => t !== name))
        } else {
            props.onChange([...props.selected, name])
        }
    }

    const clearAll = () => props.onChange([])

    const summary = props.selected.length === 0
        ? t('newSession.allowedTools.placeholder')
        : t('newSession.allowedTools.summary', { count: props.selected.length })

    return (
        <div ref={rootRef} className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.allowedTools')}
            </label>
            <span className="text-xs text-[var(--app-hint)]">
                {t('newSession.allowedTools.desc')}
            </span>
            <div className="relative">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    disabled={props.isDisabled}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                >
                    <span className={props.selected.length === 0 ? 'text-[var(--app-hint)]' : ''}>
                        {summary}
                    </span>
                    <span className="text-[var(--app-hint)]">▾</span>
                </button>
                {open && (
                    <div
                        className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] shadow-lg"
                        role="listbox"
                    >
                        {CLAUDE_BUILT_IN_TOOL_GROUPS.map((group) => (
                            <div key={group.label} className="py-1">
                                <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                    {group.label}
                                </div>
                                {group.tools.map((tool) => {
                                    const checked = selectedSet.has(tool.name)
                                    return (
                                        <label
                                            key={tool.name}
                                            className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--app-divider)]"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleTool(tool.name)}
                                                className="mt-0.5 h-4 w-4"
                                            />
                                            <span className="flex flex-col">
                                                <span className="text-sm text-[var(--app-text)]">{tool.name}</span>
                                                <span className="text-xs text-[var(--app-hint)]">{tool.description}</span>
                                            </span>
                                        </label>
                                    )
                                })}
                            </div>
                        ))}
                        {props.selected.length > 0 && (
                            <button
                                type="button"
                                onClick={clearAll}
                                className="w-full px-3 py-2 text-xs text-left text-[var(--app-link)] border-t border-[var(--app-divider)] hover:bg-[var(--app-divider)]"
                            >
                                {t('newSession.allowedTools.clear')}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
