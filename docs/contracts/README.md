# 开发准入契约产物

这些文件服务于 RD-04/05/06 的文档联调基线，不是已经实现的共享 npm 包、运行时校验器或 HTTP 服务。

- `readiness.types.ts`：从接口契约请求字段表提取8组请求形状、规范化删除查询类型，以及前端 ProfileReadDTO。数字范围、枚举值、跨字段/信任边界约束仍须由原接口章节的运行时 Schema 实现；类型文件不能替代输入校验。USER 写入类型使用规范 revision 字段，version兼容入口的归一化/同传相等规则由服务端负责。
- `readiness.fixtures.json`：从真实契约示例提取的 Profile GET 响应和请求示例；示例中的密码、密钥是原文中的虚构占位值。
- `request-fields.json`：保留字段名、必填性、类型和原文约束，便于核对生成类型与运行时 Schema 的实现。
- `endpoint-trace.json` / `ENDPOINT_TRACE.md`：全部47项方法+路径的契约、Schema标识、Controller/Service/Repository分工、前端入口与验收计划。计划不等于已经通过的 HTTP 测试。

## 再生成

在仓库根目录执行：

```powershell
node scripts/combine_arch.js
node scripts/combine_be_spec.js
node scripts/combine_fe_spec.js
node scripts/combine_contract.js
python scripts/generate_readiness_contracts.py
python scripts/generate_readiness_contracts.py --check
```

四份合成规范以 `scripts/arch_parts`、`be_parts`、`fe_parts`、`contract_parts` 的 Markdown 分片为编辑源；数据库设计和SQL直接维护。
`contract_generators/gen_part*.py` 及 `generate_frontend_spec.py` 已改为消费当前分片的兼容入口，不再用历史嵌入模板覆盖已评审修订。
其他 `apply_*`、`update_*`、`bump_*` 等历史一次性修补脚本不是当前构建入口，不应重新按目录顺序全部执行。

## 边界

Profile 表单显式将读字段 username 映射为写字段 user；禁止展开整个读响应提交，也不回填密码、私钥或只读字段。
采用 PUT增量合并时，改动主机、身份、SSH/TLS信任边界必须重新输入对应凭据；这些条件语义并不能由“字段可选”的TypeScript类型单独保证。
运行时请求/响应Schema、真实Repository、HTTP Mock服务与浏览器E2E属于首个垂直切片实施工作，未由本次文档修订交付。
