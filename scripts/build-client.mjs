#!/usr/bin/env node
// ============================================================================
// dsh-fuse · scripts/build-client.mjs
//
// 把【单一事实来源】spec-validator.mjs 的校验器代码块注入 client.js 的
// `#region spec-validator (generated)` 区间，让浏览器半区与宿主半区共用同一套
// 规格校验规则（页面类型 / 组件白名单 / 容器递归 / tabs 递归 / 预算 60 / 深度 8）。
//
// client.js 必须保持「浏览器可直接加载的自包含单文件」（经 __ModuleLoader__ 加载，
// 不能 import 仓库里的相对文件），所以这里不做打包、不引入任何依赖，只做
// 「逐字节提取 + 统一缩进」的文本注入——生成区间的规则文本与 spec-validator.mjs
// 完全相同，两侧不可能各写一份。
//
// 用法：
//   node scripts/build-client.mjs            # 生成/更新 client.js（幂等）
//   node scripts/build-client.mjs --check    # 只校验生成结果与 client.js 一致
//
// 退出码：0 = 一致/已更新；1 = 缺少标记 / 区间非法 / --check 发现漂移
//
// 漂移防线（CI + 单测）：
//   npm run build:client  →  写回 client.js
//   npm test              →  用例内跑 --check：只改一边立刻失败
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SPEC_VALIDATOR_HEADER,
  SPEC_VALIDATOR_FOOTER,
  indentSpecValidatorRegion,
  loadSpecValidatorRegion,
  specValidatorRegionSource,
} from '../spec-validator.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..')
export const VALIDATOR_FILE = path.join(REPO_ROOT, 'spec-validator.mjs')
export const CLIENT_FILE = path.join(REPO_ROOT, 'client.js')

/** 默认缩进：client.js 的闭包层级（4 空格）；生成时按现有内容探测并保持 */
export const DEFAULT_INDENT = '    '

const countOccurrences = (text, needle) => text.split(needle).length - 1

/** 探测生成区间的缩进（取首行非空行前导空白；空区间回退默认值） */
export function detectRegionIndent(clientSource) {
  const begin = clientSource.indexOf(SPEC_VALIDATOR_HEADER)
  const end = clientSource.indexOf(SPEC_VALIDATOR_FOOTER)
  if (begin < 0 || end < begin) return DEFAULT_INDENT
  const body = clientSource.slice(clientSource.indexOf('\n', begin) + 1, end)
  for (const line of body.split('\n')) {
    const m = /^([ \t]*)\S/.exec(line)
    if (m) return m[1] || DEFAULT_INDENT
  }
  return DEFAULT_INDENT
}

/**
 * 用 spec-validator.mjs 的 REGION 源码替换 client.js 的生成区间。
 * 纯函数：不读写文件，便于测试与 --check 复用。
 * @returns {{ source: string, changed: boolean, regionLines: number, indent: string }}
 */
export function injectGeneratedRegion(clientSource, regionSource = specValidatorRegionSource()) {
  const beginHits = countOccurrences(clientSource, SPEC_VALIDATOR_HEADER)
  const endHits = countOccurrences(clientSource, SPEC_VALIDATOR_FOOTER)
  if (beginHits !== 1) throw new Error(`client.js 必须恰好有 1 处 "${SPEC_VALIDATOR_HEADER}"，实际 ${beginHits} 处`)
  if (endHits !== 1) throw new Error(`client.js 必须恰好有 1 处 "${SPEC_VALIDATOR_FOOTER}"，实际 ${endHits} 处`)
  const begin = clientSource.indexOf(SPEC_VALIDATOR_HEADER)
  const end = clientSource.indexOf(SPEC_VALIDATOR_FOOTER)
  if (end < begin) throw new Error('生成区间的开始标记出现在结束标记之后')

  const indent = detectRegionIndent(clientSource)
  const region = indentSpecValidatorRegion(regionSource.replace(/\n+$/, ''), indent)
  const head = clientSource.slice(0, begin)
  const tail = clientSource.slice(clientSource.indexOf('\n', end) + 1)
  const source = [
    head + SPEC_VALIDATOR_HEADER,
    '// 来源：spec-validator.mjs（单一事实来源）；本区间由 npm run build:client 生成，手改无效',
    region,
    SPEC_VALIDATOR_FOOTER,
    tail,
  ].join('\n')
  return {
    source,
    changed: source !== clientSource,
    regionLines: region.split('\n').length,
    indent,
  }
}

/** 读磁盘 → 生成 → 返回 { source, changed, ... }（不写文件） */
export function buildClientSource({ clientSource = null } = {}) {
  const current = clientSource ?? fs.readFileSync(CLIENT_FILE, 'utf8')
  return injectGeneratedRegion(current, specValidatorRegionSource())
}

/** REGION 自检：提取出来的代码块必须能被干净上下文直接执行 */
export function verifyRegionRunnable() {
  const region = specValidatorRegionSource()
  const exported = loadSpecValidatorRegion(region)
  if (exported.FUSE_MAX_NODES !== 60 || exported.FUSE_MAX_DEPTH !== 8) {
    throw new Error(`REGION 预算常量异常：MAX_NODES=${exported.FUSE_MAX_NODES} / MAX_DEPTH=${exported.FUSE_MAX_DEPTH}`)
  }
  return exported
}

function main() {
  const check = process.argv.includes('--check')
  const quiet = process.argv.includes('--quiet')
  const log = (...args) => { if (!quiet) console.log(...args) }

  if (!fs.existsSync(CLIENT_FILE)) {
    console.error(`FAIL: 未找到 ${path.relative(REPO_ROOT, CLIENT_FILE)}`)
    process.exit(1)
  }
  try {
    verifyRegionRunnable()
  } catch (err) {
    console.error(`FAIL: spec-validator.mjs 的 REGION 区间自检失败 —— ${err.message}`)
    process.exit(1)
  }

  const current = fs.readFileSync(CLIENT_FILE, 'utf8')
  let result
  try {
    result = injectGeneratedRegion(current, specValidatorRegionSource())
  } catch (err) {
    console.error(`FAIL: ${err.message}`)
    process.exit(1)
  }

  if (check) {
    if (result.changed) {
      const curLines = current.split('\n')
      const genLines = result.source.split('\n')
      let at = 0
      while (at < curLines.length && at < genLines.length && curLines[at] === genLines[at]) at++
      console.error('FAIL: client.js 的 spec-validator 生成区间已过期（提交的 client.js 与 spec-validator.mjs 不一致）')
      console.error(`  首个差异行：第 ${at + 1} 行`)
      console.error(`  仓库 client.js ：${(curLines[at] ?? '<EOF>').trim().slice(0, 120)}`)
      console.error(`  重新生成结果 ：${(genLines[at] ?? '<EOF>').trim().slice(0, 120)}`)
      console.error('  修复：npm run build:client（只改 spec-validator.mjs，别手改生成区间）')
      process.exit(1)
    }
    log(`ok   client.js 的 spec-validator 生成区间与 spec-validator.mjs 一致（${result.regionLines} 行）`)
    return
  }

  if (!result.changed) {
    log(`ok   client.js 已是最新（生成区间 ${result.regionLines} 行，缩进 ${result.indent.length} 空格）`)
    return
  }
  fs.writeFileSync(CLIENT_FILE, result.source, 'utf8')
  log(`ok   已注入 spec-validator 生成区间（${result.regionLines} 行，缩进 ${result.indent.length} 空格）→ ${path.relative(REPO_ROOT, CLIENT_FILE)}`)
}

// 仅在直接执行时跑 main（被测试 import 时不执行）
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invoked === fileURLToPath(import.meta.url)) main()
