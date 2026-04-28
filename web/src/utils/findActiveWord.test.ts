import { describe, it, expect } from 'vitest'
import { findActiveWord } from './findActiveWord'

const at = (text: string, pos: number) => findActiveWord(text, { start: pos, end: pos })

describe('findActiveWord', () => {
    describe('slash commands', () => {
        it('returns active word while typing the command name', () => {
            const t = '/bmad-rev'
            expect(at(t, t.length)?.activeWord).toBe('/bmad-rev')
        })

        it('returns the full word when cursor is mid-name', () => {
            const t = '/bmad-review'
            expect(at(t, 5)?.activeWord).toBe('/bmad')
            expect(at(t, 5)?.word).toBe('/bmad-review')
        })

        it('returns undefined once a space follows the command name (cursor in args)', () => {
            const t = '/bmad-review-adversarial-general 请帮我检查刚创建的 story'
            expect(at(t, t.length)).toBeUndefined()
        })

        it('returns undefined for command followed by single arg char', () => {
            const t = '/foo a'
            expect(at(t, t.length)).toBeUndefined()
        })

        it('still detects a fresh slash command after another command + args', () => {
            const t = '/old args /new'
            expect(at(t, t.length)?.activeWord).toBe('/new')
        })
    })

    describe('skill ($) prefix', () => {
        it('hides suggestions once a space appears after skill name', () => {
            const t = '$skill arg'
            expect(at(t, t.length, )).toBeUndefined()
        })
    })

    describe('@ mentions / file paths (legacy: spaces allowed)', () => {
        it('keeps treating "@user name" as one active word', () => {
            const t = '@user name'
            const w = at(t, t.length)
            expect(w?.activeWord).toBe('@user name')
        })

        it('keeps @ + path with slash (no spaces) as one word', () => {
            const t = '@src/utils/findActiveWord'
            expect(at(t, t.length)?.activeWord).toBe('@src/utils/findActiveWord')
        })
    })

    describe('boundary cases', () => {
        it('returns undefined when active word ends with a space', () => {
            const t = '/foo '
            expect(at(t, t.length)).toBeUndefined()
        })

        it('returns single prefix to trigger suggestions immediately', () => {
            const t = '/'
            expect(at(t, 1)?.activeWord).toBe('/')
        })
    })
})
