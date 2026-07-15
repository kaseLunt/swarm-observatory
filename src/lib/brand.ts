declare const brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [brand]: B }
export type Tick = Brand<number, 'Tick'>
export type Seq = Brand<number, 'Seq'>
export type EventKindId = Brand<number, 'EventKindId'>
const nonNegInt = (n: number, what: string): number => {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what} must be a non-negative integer, got ${n}`)
  return n
}
export const asTick = (n: number): Tick => nonNegInt(n, 'Tick') as Tick
export const asSeq = (n: number): Seq => nonNegInt(n, 'Seq') as Seq
export const asKind = (n: number): EventKindId => nonNegInt(n, 'EventKindId') as EventKindId
