import fs from 'fs'
import { expect } from 'vitest'
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import traverse from '@babel/traverse'

// Snapshot every binding's reference bookkeeping, reading scope as Babel has
// it cached — i.e. the state the visitor left behind. Babel does not re-crawl
// on inspection, so a missing or mis-scoped crawl() surfaces here as a stale
// reference count even when the generated text is unchanged. Bindings are
// sorted per scope for a stable, order-independent comparison.
function referenceState(ast) {
  const state = []
  traverse(ast, {
    Scopable(path) {
      const { bindings } = path.scope
      for (const name of Object.keys(bindings).sort()) {
        const binding = bindings[name]
        state.push({
          name,
          references: binding.references,
          constant: binding.constant,
          violations: binding.constantViolations.length,
        })
      }
    },
  })
  return state
}

export function getVisitorResult(visitor, fix, input) {
  const sourceCode = fs.readFileSync(input + '.js', { encoding: 'utf-8' })
  const ast = parse(sourceCode)
  traverse(ast, visitor)
  if (fix) {
    const cmpCode = fs.readFileSync(input + '.fix.js', { encoding: 'utf-8' })
    expect(generate(ast).code).toBe(cmpCode)
    // Reference integrity (fix cases only): the transformed AST's scope must
    // match a fresh parse of the expected output. A missing or mis-scoped
    // crawl() leaves stale reference counts that this catches even though the
    // generated text is identical. No-op (fix === false) cases don't mutate
    // the tree, so the check would be redundant there.
    expect(referenceState(ast)).toEqual(referenceState(parse(cmpCode)))
  } else {
    expect(generate(ast).code).toBe(sourceCode)
  }
}

export function getPluginResult(plugin, fix, input) {
  const sourceCode = fs.readFileSync(input + '.js', { encoding: 'utf-8' })
  const out = plugin(sourceCode)
  if (fix) {
    const cmpCode = fs.readFileSync(input + '.fix.js', { encoding: 'utf-8' })
    expect(out).toBe(cmpCode)
  } else {
    expect(out).toBe(sourceCode)
  }
}
