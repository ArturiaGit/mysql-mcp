with open('scripts/contract_generators/gen_part1_2.py', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace('v1.4.0', 'v1.5.0')
text = text.replace(
    '4. **用户限流删除重建与并发 ABA 彻底根治 (P2 #4)**：\n   - `DELETE /api/v1/rate-limits/users/:id` 强制要求携带当前版本号（CAS 删除）；元数据库采用自增主键与代际标识，重置后新建强制递增修订代际，杜绝版本号 ABA 覆盖；',
    '4. **用户限流删除重建与并发 ABA 彻底根治 (P2 #4)**：\n   - 废除基于易失业务表计算 MAX(revision) 的脆弱逻辑，确立元数据库独立的**持久化代际计数器 (`sys_rate_limit_revisions`)**，绝不随业务行删除而重置；\n   - 恢复继承仅删除业务行，当下一次重新自定义时，持久化计数器原子自增分配新代际（如从 1 变为 2）；结合 `DELETE ?revision=N`，彻底免疫旧版本 1 在删除重建后的 ABA 静默覆盖与误删；'
)

with open('scripts/contract_generators/gen_part1_2.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Bumped version to v1.5.0 in gen_part1_2.py")
