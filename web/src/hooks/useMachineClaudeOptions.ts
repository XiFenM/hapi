import { useEffect, useState } from 'react'
import type { ApiClient } from '@/api/client'

export type MachineClaudeModelOption = { id: string; label: string }

export function useMachineClaudeOptions(
    api: ApiClient,
    machineId: string | null | undefined
): {
    models: MachineClaudeModelOption[] | null
    loading: boolean
} {
    const [models, setModels] = useState<MachineClaudeModelOption[] | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        let cancelled = false

        if (!machineId) {
            setModels(null)
            setLoading(false)
            return () => {
                cancelled = true
            }
        }

        setLoading(true)
        void api.getMachineClaudeOptions(machineId)
            .then((result) => {
                if (cancelled) return
                setModels(result.models ?? null)
                setLoading(false)
            })
            .catch(() => {
                if (cancelled) return
                setModels(null)
                setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [api, machineId])

    return { models, loading }
}
