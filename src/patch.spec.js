/* eslint-env mocha */

import expect from 'must'

import patch from './patch'

// ===================================================================

describe('patch', () => {
  it('can patch arrays', () => {
    expect(patch(
      [ 'foo', 'bar', 'quuz' ],
      { 0: null, '-': 'quuz', '+': [ 'baz' ] }
    )).to.eql(
      [ 'bar', 'baz' ]
    )
  })

  it('can patch objects', () => {
    expect(patch(
      { foo: 1, bar: 2 },
      { foo: null, bar: 3, baz: 4 }
    )).to.eql(
      { bar: 3, baz: 4 }
    )
  })
})
