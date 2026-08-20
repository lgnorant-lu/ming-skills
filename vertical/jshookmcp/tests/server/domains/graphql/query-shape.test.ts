import { describe, expect, it } from 'vitest';

import { analyzeQueryShape } from '@server/domains/graphql/handlers/query-shape';

describe('analyzeQueryShape', () => {
  // ── operation type / name ───────────────────────────────────────────

  it('detects a named query', () => {
    const shape = analyzeQueryShape('query GetUser { user { name } }');
    expect(shape.operationType).toBe('query');
    expect(shape.operationName).toBe('GetUser');
  });

  it('detects a mutation', () => {
    const shape = analyzeQueryShape('mutation CreateUser { createUser { id } }');
    expect(shape.operationType).toBe('mutation');
    expect(shape.operationName).toBe('CreateUser');
  });

  it('detects a subscription', () => {
    const shape = analyzeQueryShape('subscription OnMsg { newMessage { id } }');
    expect(shape.operationType).toBe('subscription');
  });

  it('treats a shorthand `{ ... }` document as an anonymous query', () => {
    const shape = analyzeQueryShape('{ hero { name } }');
    expect(shape.operationType).toBe('query');
    expect(shape.operationName).toBeNull();
  });

  it('marks non-graphql input as unknown', () => {
    const shape = analyzeQueryShape('not a graphql document');
    expect(shape.operationType).toBe('unknown');
    expect(shape.totalFields).toBe(0);
    expect(shape.depth).toBe(0);
  });

  // ── depth / breadth ─────────────────────────────────────────────────

  it('reports depth and per-level breadth for a simple query', () => {
    const shape = analyzeQueryShape('query { user { name } }');
    expect(shape.breadthByLevel).toEqual([1, 1]);
    expect(shape.depth).toBe(2);
    expect(shape.maxBreadth).toBe(1);
    expect(shape.totalFields).toBe(2);
  });

  it('counts sibling fields as breadth at the same level', () => {
    const shape = analyzeQueryShape('query { user { name email age } }');
    expect(shape.breadthByLevel).toEqual([1, 3]);
    expect(shape.depth).toBe(2);
    expect(shape.maxBreadth).toBe(3);
    expect(shape.totalFields).toBe(4);
  });

  it('tracks deep nesting', () => {
    const shape = analyzeQueryShape('query { user { friends { name { first } } } }');
    expect(shape.depth).toBe(4);
    expect(shape.breadthByLevel).toEqual([1, 1, 1, 1]);
  });

  it('weights cost by depth (deeper fields cost more)', () => {
    const shallow = analyzeQueryShape('query { a b c }');
    const deep = analyzeQueryShape('query { a { b { c } } }');
    expect(deep.costScore).toBeGreaterThan(shallow.costScore);
  });

  // ── args / aliases / directives do not distort shape ───────────────

  it('ignores braces inside argument lists', () => {
    // object-literal input value inside args must not inflate depth
    const shape = analyzeQueryShape(
      'mutation { createUser(input: { name: "x", tags: ["a", "b"] }) { id } }',
    );
    expect(shape.breadthByLevel).toEqual([1, 1]);
    expect(shape.depth).toBe(2);
  });

  it('counts an aliased field once', () => {
    const shape = analyzeQueryShape('query { myName: name }');
    expect(shape.totalFields).toBe(1);
    expect(shape.breadthByLevel).toEqual([1]);
  });

  it('skips directive argument lists', () => {
    const shape = analyzeQueryShape('query { field @skip(if: true) }');
    expect(shape.totalFields).toBe(1);
  });

  it('strips string literals containing braces and hashes', () => {
    const shape = analyzeQueryShape('query { echo(msg: "#{fake} {trap}") { ok } }');
    // the `#{fake} {trap}` is inside a string literal — must not count
    expect(shape.breadthByLevel).toEqual([1, 1]);
    expect(shape.totalFields).toBe(2);
  });

  it('strips # line comments', () => {
    const shape = analyzeQueryShape('query {\n  # comment { not_a_field }\n  real\n}');
    expect(shape.totalFields).toBe(1);
    expect(shape.breadthByLevel).toEqual([1]);
  });

  // ── fragments ───────────────────────────────────────────────────────

  it('counts fragment spreads and definitions without inflating operation breadth', () => {
    const shape = analyzeQueryShape(
      'query { user { ...UserFields } }\nfragment UserFields on User { name email }',
    );
    expect(shape.operationType).toBe('query');
    expect(shape.fragments.definitions).toBe(1);
    expect(shape.fragments.spreads).toBe(1);
    // operation breadth: user (1) at level 0; spread is not a field
    expect(shape.breadthByLevel).toEqual([1]);
    expect(shape.totalFields).toBe(1);
  });

  it('counts inline fragments', () => {
    const shape = analyzeQueryShape('query { thing { ... on User { name } ... on Bot { id } } }');
    expect(shape.fragments.inline).toBe(2);
  });

  it('detects a cyclic fragment spread graph', () => {
    const shape = analyzeQueryShape(
      ['query { a { ...A } }', 'fragment A on T { x ...B }', 'fragment B on T { y ...A }'].join(
        '\n',
      ),
    );
    expect(shape.hasCycle).toBe(true);
  });

  it('treats acyclic fragment spreads as non-cyclic', () => {
    const shape = analyzeQueryShape(
      [
        'query { user { ...A } }',
        'fragment A on User { name ...B }',
        'fragment B on User { email }',
      ].join('\n'),
    );
    expect(shape.hasCycle).toBe(false);
  });

  it('handles variable definitions in the operation signature', () => {
    const shape = analyzeQueryShape('query Get($id: ID!) { user(id: $id) { name } }');
    expect(shape.operationName).toBe('Get');
    expect(shape.breadthByLevel).toEqual([1, 1]);
  });

  it('is defensive against empty input', () => {
    const shape = analyzeQueryShape('');
    expect(shape.operationType).toBe('unknown');
    expect(shape.totalFields).toBe(0);
    expect(shape.hasCycle).toBe(false);
  });
});
