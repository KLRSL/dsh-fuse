// 串联入口：每个用例独立进程跑（避免 jsdom 与编排共进程时互相等）
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(new URL('./run.mjs', import.meta.url))
const CASES = ['词汇表同步', '宿主集成', '合法渲染', '流式骨架屏', '流式结束升级错误卡', '非法规格错误卡', '令牌对比度']

let failed = 0
for (const name of CASES) {
  try {
    process.stdout.write(execFileSync(process.execPath, [SELF], {
      env: { ...process.env, FUSE_TEST_CASE: name },
      encoding: 'utf8',
    }))
  } catch (err) {
    failed++
    process.stdout.write(String(err.stdout ?? ''))
    process.stderr.write(`✖ ${name}\n${String(err.stderr ?? '')}`)
  }
}
console.log(failed === 0 ? `\nPASS ${CASES.length} 项` : `\nFAIL ${failed}/${CASES.length}`)
process.exit(failed === 0 ? 0 : 1)
