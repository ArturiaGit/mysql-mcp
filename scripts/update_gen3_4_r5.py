with open('scripts/contract_generators/gen_part3_4.py', 'r', encoding='utf-8') as f:
    text = f.read()

# Update 42/43 to 44
text = text.replace("全系统 42 项核心错误码", "全系统 44 项核心错误码")
text = text.replace("全系统 43 项核心错误码", "全系统 44 项核心错误码")

# Add ERR_INVALID_STATUS_TRANSITION to table if not present
if "ERR_INVALID_STATUS_TRANSITION" not in text:
    old_line = "| `ERR_APPROVAL_STATE_CONFLICT`| 409 | 审批中心 | 工单已被其他管理员审批或账号已非待审状态 | 该审批工单状态已发生变更或已被处理。 | 该工单已被其他管理员抢先审批或撤销，请刷新待审列表。 | 无 |"
    new_line = (
        old_line + "\n"
        "| `ERR_INVALID_STATUS_TRANSITION` | 400 | 用户管理 | 尝试对待审(PENDING)或驳回(REJECTED)账号直接执行启停流转 | 非法账号状态流转。 | 待审或已驳回账号必须通过审批工单流程流转，禁止直接通过启停接口变更状态。 | `details.current_status` |"
    )
    text = text.replace(old_line, new_line)

with open('scripts/contract_generators/gen_part3_4.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated gen_part3_4.py")
