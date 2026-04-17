import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { MachineClaudeModelOption } from '@/hooks/useMachineClaudeOptions'

type DraftRow = { id: string; label: string; key: string }

type Props = {
    isOpen: boolean
    onClose: () => void
    initialModels: MachineClaudeModelOption[] | null
    onSave: (models: MachineClaudeModelOption[]) => Promise<unknown>
}

const DEFAULT_ROWS: MachineClaudeModelOption[] = [
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'sonnet[1m]', label: 'Sonnet 1M' },
    { id: 'opus', label: 'Opus' },
    { id: 'opus[1m]', label: 'Opus 1M' }
]

let rowKeyCounter = 0
const nextKey = () => `row-${++rowKeyCounter}`

function toDraft(models: MachineClaudeModelOption[]): DraftRow[] {
    return models.map((m) => ({ id: m.id, label: m.label, key: nextKey() }))
}

export function EditMachineClaudeModelsDialog(props: Props) {
    const { isOpen, onClose, initialModels, onSave } = props
    const seed = useMemo(
        () => (initialModels && initialModels.length > 0 ? initialModels : DEFAULT_ROWS),
        [initialModels]
    )
    const [rows, setRows] = useState<DraftRow[]>(() => toDraft(seed))
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (isOpen) {
            setRows(toDraft(seed))
            setError(null)
        }
    }, [isOpen, seed])

    const updateRow = (key: string, patch: Partial<Pick<DraftRow, 'id' | 'label'>>) => {
        setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    }

    const addRow = () => {
        setRows((prev) => [...prev, { id: '', label: '', key: nextKey() }])
    }

    const removeRow = (key: string) => {
        setRows((prev) => prev.filter((r) => r.key !== key))
    }

    const moveRow = (key: string, direction: -1 | 1) => {
        setRows((prev) => {
            const idx = prev.findIndex((r) => r.key === key)
            if (idx < 0) return prev
            const nextIdx = idx + direction
            if (nextIdx < 0 || nextIdx >= prev.length) return prev
            const copy = [...prev]
            ;[copy[idx], copy[nextIdx]] = [copy[nextIdx], copy[idx]]
            return copy
        })
    }

    const handleSave = async () => {
        const cleaned: MachineClaudeModelOption[] = []
        const seen = new Set<string>()
        for (const row of rows) {
            const id = row.id.trim()
            const label = row.label.trim()
            if (!id) continue
            if (seen.has(id)) {
                setError(`Duplicate model id: ${id}`)
                return
            }
            seen.add(id)
            cleaned.push({ id, label: label || id })
        }
        setError(null)
        setSaving(true)
        try {
            await onSave(cleaned)
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !saving && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Edit Claude models</DialogTitle>
                </DialogHeader>
                <div className="mt-2 text-xs text-[var(--app-hint)]">
                    Each entry is passed directly to <code>claude --model</code>. Use aliases like <code>sonnet</code> / <code>opus</code> / <code>haiku</code>, 1M variants like <code>opus[1m]</code>, or full model IDs like <code>claude-opus-4-7</code>.
                </div>
                <div className="mt-3 flex items-center gap-2 px-0.5 text-xs font-semibold text-[var(--app-hint)]">
                    <div className="flex-1 min-w-0">Model name</div>
                    <div className="flex-1 min-w-0">Label</div>
                    <div className="w-[74px]" aria-hidden />
                </div>
                <div className="mt-1 flex flex-col gap-2 max-h-[50vh] overflow-y-auto py-1 pr-1">
                    {rows.length === 0 ? (
                        <div className="text-sm text-[var(--app-hint)] py-4 text-center">
                            No models configured. Add one below or save empty to use built-in defaults.
                        </div>
                    ) : null}
                    {rows.map((row, idx) => (
                        <div key={row.key} className="flex items-center gap-2">
                            <input
                                type="text"
                                value={row.id}
                                onChange={(e) => updateRow(row.key, { id: e.target.value })}
                                placeholder="model id (e.g. sonnet)"
                                className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-button)]"
                                disabled={saving}
                            />
                            <input
                                type="text"
                                value={row.label}
                                onChange={(e) => updateRow(row.key, { label: e.target.value })}
                                placeholder="label"
                                className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-button)]"
                                disabled={saving}
                            />
                            <div className="flex gap-0.5">
                                <button
                                    type="button"
                                    onClick={() => moveRow(row.key, -1)}
                                    disabled={saving || idx === 0}
                                    className="px-1.5 py-1 text-xs rounded hover:bg-[var(--app-secondary-bg)] disabled:opacity-30"
                                    aria-label="Move up"
                                >
                                    ↑
                                </button>
                                <button
                                    type="button"
                                    onClick={() => moveRow(row.key, 1)}
                                    disabled={saving || idx === rows.length - 1}
                                    className="px-1.5 py-1 text-xs rounded hover:bg-[var(--app-secondary-bg)] disabled:opacity-30"
                                    aria-label="Move down"
                                >
                                    ↓
                                </button>
                                <button
                                    type="button"
                                    onClick={() => removeRow(row.key)}
                                    disabled={saving}
                                    className="px-1.5 py-1 text-xs rounded hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 disabled:opacity-30"
                                    aria-label="Remove"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-3">
                    <Button type="button" variant="secondary" onClick={addRow} disabled={saving}>
                        + Add model
                    </Button>
                </div>
                {error ? (
                    <div className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        {error}
                    </div>
                ) : null}
                <div className="mt-4 flex gap-2 justify-end">
                    <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : 'Save'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
