import { useCallback, useEffect, useState } from 'react'
import type { ApiClient } from '@/api/client'

export type MachineClaudeModelOption = { id: string; label: string }

export function useMachineClaudeOptions(
    api: ApiClient,
    machineId: string | null | undefined
): {
    models: MachineClaudeModelOption[] | null
    loading: boolean
    refresh: () => Promise<void>
    save: (models: MachineClaudeModelOption[]) => Promise<MachineClaudeModelOption[]>
} {
    const [models, setModels] = useState<MachineClaudeModelOption[] | null>(null)
    const [loading, setLoading] = useState(false)

    const fetchOnce = useCallback(async (signal?: { cancelled: boolean }) => {
        if (!machineId) {
            setModels(null)
            setLoading(false)
            return
        }
        setLoading(true)
        try {
            const result = await api.getMachineClaudeOptions(machineId)
            if (signal?.cancelled) return
            setModels(result.models ?? null)
        } catch {
            if (signal?.cancelled) return
            setModels(null)
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

    const save = useCallback(async (next: MachineClaudeModelOption[]) => {
        if (!machineId) {
            throw new Error('No machine selected')
        }
        const result = await api.setMachineClaudeOptions(machineId, next)
        setModels(result.models ?? null)
        return result.models ?? []
    }, [api, machineId])

    return { models, loading, refresh, save }
}
