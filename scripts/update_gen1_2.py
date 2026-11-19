with open('scripts/contract_generators/gen_part1_2.py', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace TlsConfig definition
old_tls = """  /** 结构化 TLS 配置 */
  export interface TlsConfig {
    enabled: boolean;
    reject_unauthorized?: boolean; // 默认 true (严格验证CA)
    ca_cert?: string;              // 自定义 PEM 格式 CA 证书文本
    server_name?: string;          // TLS SNI 主机名覆盖
  }"""

new_tls = """  /** 结构化 TLS 配置 (强安全基线：严格验真且身份与 host 强制绑定) */
  export interface TlsConfig {
    enabled: boolean;
    ca_cert?: string | null;       // 自定义 PEM 格式 CA 证书文本；为 null 或缺省时使用系统标准根 CA
  }"""

text = text.replace(old_tls, new_tls)

with open('scripts/contract_generators/gen_part1_2.py', 'w', encoding='utf-8') as f:
    f.write(text)

print('Updated gen_part1_2.py')
