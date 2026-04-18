import { useCallback, useEffect, useState } from 'react'
import type { ApiClient } from '@/api/client'

export type MachineClaudeModelOption = { id: string; label: string; contextWindow?: number }

type SavePayload = {
    models: MachineClaudeModelOption[]
    defaultContextWindow?: number | null
}

export function useMachineClaudeOptions(
    api: ApiClient,
    machineId: string | null | undefined
): {
    models: MachineClaudeModelOption[] | null
    defaultContextWindow: number | null
    loading: boolean
    refresh: () => Promise<void>
    save: (payload: SavePayload) => Promise<void>
} {
    const [models, setModels] = useState<MachineClaudeModelOption[] | null>(null)
    const [defaultContextWindow, setDefaultContextWindow] = useState<number | null>(null)
    const [loading, setLoading] = useState(false)

    const fetchOnce = useCallback(async (signal?: { cancelled: boolean }) => {
        if (!machineId) {
            setModels(null)
            setDefaultContextWindow(null)
            setLoading(false)
            return
        }
        setLoading(true)
        try {
            const result = await api.getMachineClaudeOptions(machineId)
            if (signal?.cancelled) return
            setModels(result.models ?? null)
            setDefaultContextWindow(
                typeof (result as { defaultContextWindow?: unknown }).defaultContextWindow === 'number'
                    ? ((result as { defaultContextWindow: number }).defaultContextWindow)
                    : null
            )
        } catch {
            if (signal?.cancelled) return
            setModels(null)
            setDefaultContextWindow(null)
        } finally {
            if (!signal?.cancelled) setLoading(false)
        }
    }, [api, machineId])

    useEffect(() => {
        const signal = { cancelled: false }
        void fetchOnce(signal)
        return () => {
            signal.cancelled = true
        }
    }, [fetchOnce])

    const refresh = useCallback(async () => {
        await fetchOnce()
    }, [fetchOnce])

    const save = useCallback(async (payload: SavePayload) => {
        if (!machineId) {
            throw new Error('No machine selected')
        }
        const def = typeof payload.defaultContextWindow === 'number' && payload.defaultContextWindow > 0
            ? payload.defaultContextWindow
            : undefined
        const result = await api.setMachineClaudeOptions(machineId, payload.models, def)
        setModels(result.models ?? null)
        setDefaultContextWindow(
            typeof result.defaultContextWindow === 'number' ? result.defaultContextWindow : null
        )
    }, [api, machineId])

    return { models, defaultContextWindow, loading, refresh, save }
}
