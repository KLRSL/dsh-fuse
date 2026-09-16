// ============================================================================
// dsh-fuse · 校验器单一事实来源（spec-validator.mjs）专项测试
//
// 背景：规格校验规则曾同时存在于宿主 index.mjs 与浏览器半区 client.js，靠人工
// 「同期维护」，出现过「宿主放行、前端拒绝」的判定分裂。现规则只写在
// spec-validator.mjs：宿主 import 它，client.js 的 `#region spec-validator (generated)`
// 由 scripts/build-client.mjs 逐字节注入。本文件是这条不变式的守卫：
//   1. 仓库里的 client.js 与 spec-validator.mjs 不得漂移（只改一边就失败）；
//   2. 被注入的区间必须自包含、可在干净上下文直接执行（浏览器可直接跑）；
//   3. 宿主与生成区间的词汇表/预算逐项同构；
//   4. 两侧校验器对同一批规格的 accept/reject 判定完全一致（差分对拍零分歧）。
// ============================================================================
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  validateFuseSpec as hostValidate,
  FUSE_PAGE_KINDS as HOST_PAGE_KINDS,
  FUSE_COMPONENT_TYPES as HOST_COMPONENT_TYPES,
  themeNamesFromConfig,
} from '../index.mjs'
import {
  specValidatorRegionSource,
  loadSpecValidatorRegion,
  compareSpecValidators,
  specValidatorDiffCases,
  FUSE_COMPONENT_TYPES_FLAT,
} from '../spec-validator.mjs'
import { buildClientSource, verifyRegionRunnable } from '../scripts/build-client.mjs'

/** 宿主已知主题名（从 config/theme.json 读，与宿主校验器同一份来源） */
const THEME_NAMES = themeNamesFromConfig(
  JSON.parse(fs.readFileSync(new URL('../config/theme.json', import.meta.url), 'utf8')),
)

test('client.js 的生成区间与 spec-validator.mjs 一致（只改一边即失败）', () => {
  const { changed, regionLines, indent } = buildClientSource()
  assert.equal(changed, false, 'client.js 的生成区间已过期：跑 npm run build:client 重新生成')
  assert.ok(regionLines > 50, `生成区间过短（${regionLines} 行），疑似标记或提取逻辑坏了`)
  assert.equal(indent, '    ', '生成区间缩进应保持在 client.js 闭包的 4 空格层级')
})

test('生成区间自包含、可在干净上下文执行（浏览器可直接跑）', () => {
  const exported = verifyRegionRunnable()
  assert.equal(exported.FUSE_MAX_NODES, 60)
  assert.equal(exported.FUSE_MAX_DEPTH, 8)
  assert.equal(typeof exported.validateFuseSpec, 'function')
  assert.equal(typeof exported.themeNamesFromConfig, 'function')
})

test('宿主与生成区间的词汇表/预算逐项同构', () => {
  const region = loadSpecValidatorRegion(specValidatorRegionSource())
  assert.deepEqual([...region.FUSE_PAGE_KINDS], [...HOST_PAGE_KINDS])
  assert.deepEqual([...region.FUSE_COMPONENT_TYPES], [...HOST_COMPONENT_TYPES])
  // 单一事实来源内部：分组词汇拍平后必须等于 REGION 里的白名单（防两处手写漂移）
  assert.deepEqual([...FUSE_COMPONENT_TYPES_FLAT], [...HOST_COMPONENT_TYPES])
  assert.equal(region.FUSE_MAX_NODES, 60)
  assert.equal(region.FUSE_MAX_DEPTH, 8)
})

test('宿主与前端校验器对同一批规格判定完全一致（差分对拍零分歧）', () => {
  const region = loadSpecValidatorRegion(specValidatorRegionSource())
  const cases = specValidatorDiffCases().map(([name, spec]) => ({ name, spec }))
  const { ok, total, diffs } = compareSpecValidators(
    hostValidate,
    region.validateFuseSpec,
    cases,
    { themeNames: THEME_NAMES },
  )
  assert.ok(total >= 20, `对拍样本过少（${total}）`)
  assert.equal(ok, true, `宿主与前端判定分歧 ${diffs.length} 处：${JSON.stringify(diffs, null, 2)}`)
})

test('主题名解析口径一致（宿主与前端读同一份 config 载荷）', () => {
  const payload = { themes: { default: {}, apple: {}, dark: {} } }
  assert.deepEqual(themeNamesFromConfig(payload), ['default', 'apple', 'dark'])
  assert.deepEqual(themeNamesFromConfig(null), [])
  assert.deepEqual(themeNamesFromConfig({ themes: 'nope' }), [])
  assert.deepEqual([...THEME_NAMES], Object.keys(JSON.parse(fs.readFileSync(new URL('../config/theme.json', import.meta.url), 'utf8')).themes))
})
