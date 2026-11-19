with open('scripts/contract_generators/gen_part5_6.py', 'r', encoding='utf-8') as f:
    text = f.read()

# Update approval update statement in 6.2.2
old_cas = """  ```sql
  UPDATE sys_user_approvals 
  SET action = 'APPROVE', operator_id = ? 
  WHERE id = ? AND action = 'PENDING';
  ```"""

new_cas = """  ```sql
  UPDATE sys_user_approvals 
  SET action = 'APPROVE', operator_id = ? 
  WHERE id = ? AND action IN ('SUBMIT', 'RESUBMIT');
  ```"""

text = text.replace(old_cas, new_cas)

# Update approval explanation in 6.2.2
old_exp = "若影响行数为 0，说明该工单已被其他管理员审批或撤销，立即回滚并返回 `409 ERR_APPROVAL_STATE_CONFLICT`。"
new_exp = (
    "同时原子更新用户状态 `UPDATE sys_users SET status = 'ACTIVE', version = version + 1 WHERE id = targetUserId AND status = 'PENDING';`。\n"
    "若工单或用户更新的影响行数为 0，说明该工单已被其他管理员审批处理或状态已发生变动，事务立即回滚并返回 `409 ERR_APPROVAL_STATE_CONFLICT`。"
)
text = text.replace(old_exp, new_exp)

# Update reject in 6.2.3
old_rej = "- **原子状态检查**：同事务校验工单为 `PENDING` 且用户为 `PENDING`，被抢先审批时返回 `409 ERR_APPROVAL_STATE_CONFLICT`。"
new_rej = """- **原子状态检查与条件更新**：
  服务端在事务内原子更新：
  ```sql
  UPDATE sys_user_approvals 
  SET action = 'REJECT', reason = ?, operator_id = ? 
  WHERE id = ? AND action IN ('SUBMIT', 'RESUBMIT');
  ```
  同时原子更新用户状态为 `REJECTED`。若影响行数为 0，说明工单已被抢审，返回 `409 ERR_APPROVAL_STATE_CONFLICT`。"""
text = text.replace(old_rej, new_rej)

with open('scripts/contract_generators/gen_part5_6.py', 'w', encoding='utf-8') as f:
    f.write(text)

print('Updated gen_part5_6.py')
