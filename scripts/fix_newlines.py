import re

with open('scripts/contract_generators/gen_part7_8.py', 'r', encoding='utf-8') as f:
    text = f.read()

text = re.sub(
    r'"ssh_private_key":\s*"-----BEGIN OPENSSH PRIVATE KEY-----[^\n]*\n\.\.\."',
    r'"ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\\n..."',
    text
)
text = re.sub(
    r'"ca_cert":\s*"-----BEGIN CERTIFICATE-----[^\n]*\n\.\.\."',
    r'"ca_cert": "-----BEGIN CERTIFICATE-----\\n..."',
    text
)

with open('scripts/contract_generators/gen_part7_8.py', 'w', encoding='utf-8') as f:
    f.write(text)

with open('scripts/contract_parts/part8_apis_profiles_and_roles_acls.md', 'r', encoding='utf-8') as f:
    p8 = f.read()

p8 = re.sub(
    r'"ssh_private_key":\s*"-----BEGIN OPENSSH PRIVATE KEY-----[^\n]*\n\.\.\."',
    r'"ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\\n..."',
    p8
)
p8 = re.sub(
    r'"ca_cert":\s*"-----BEGIN CERTIFICATE-----[^\n]*\n\.\.\."',
    r'"ca_cert": "-----BEGIN CERTIFICATE-----\\n..."',
    p8
)

with open('scripts/contract_parts/part8_apis_profiles_and_roles_acls.md', 'w', encoding='utf-8') as f:
    f.write(p8)

print('Escaped newlines fixed')
