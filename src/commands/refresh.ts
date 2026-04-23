import { collect } from './collect.js'
import { aggregate } from './aggregate.js'
import { generate } from './generate.js'

export async function refresh(flags: Record<string, string | boolean>): Promise<void> {
  await collect(flags)
  await aggregate(flags)
  await generate(flags)
}
