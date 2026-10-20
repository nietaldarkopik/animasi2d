import { describe, expect, it } from 'vitest'
import { characterTree } from './components/CharacterLibraryDialog'
import type { Layer } from './types'

const L = (id: string, parentId: string | null = null) => ({ id, parentId }) as Layer

describe('characterTree', () => {
  const layers = [L('x'), L('root'), L('arm', 'root'), L('hand', 'arm'), L('leg', 'root')]
  it('starts from the root of the selection and includes every descendant', () => {
    expect(characterTree(layers, 'hand').sort()).toEqual(['arm', 'hand', 'leg', 'root'])
  })
  it('a lone layer is its own tree', () => expect(characterTree(layers, 'x')).toEqual(['x']))
  it('unknown selection yields nothing', () => expect(characterTree(layers, 'nope')).toEqual([]))
})
