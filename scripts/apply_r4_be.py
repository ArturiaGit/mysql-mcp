with open('scripts/be_parts/part5_control_plane_security.md', 'r', encoding='utf-8') as f:
    text = f.read()

# Update L3 check to explicitly check method === 'GET' for password-policy
old_l3_block = """  if (currentUser.must_change_password || is_password_expired) {
    if (!MUST_CHANGE_PWD_ALLOWED_PATHS.has(routePath)) {
      throw new AppError({
        code: 'ERR_MUST_CHANGE_PASSWORD',
        statusCode: 403,
        message: '首次登录必须先完成密码修改后方可执行其他操作。',
      });
    }
    return;
  }"""

new_l3_block = """  if (currentUser.must_change_password || is_password_expired) {
    const isExempted = MUST_CHANGE_PWD_ALLOWED_PATHS.has(routePath) ||
      (req.method === 'GET' && routePath === '/api/v1/auth/password-policy');

    if (!isExempted) {
      throw new AppError({
        code: 'ERR_MUST_CHANGE_PASSWORD',
        statusCode: 403,
        message: is_password_expired ? '密码已超过有效期限，请修改密码后继续使用。' : '首次登录或密码已被重置，请修改密码后继续使用。',
        actionGuidance: '密码安全策略拦截中，请在改密对话框中设置符合复杂度要求的新密码。',
      });
    }
    return;
  }"""

text = text.replace(old_l3_block, new_l3_block)

with open('scripts/be_parts/part5_control_plane_security.md', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated be_parts/part5_control_plane_security.md")
