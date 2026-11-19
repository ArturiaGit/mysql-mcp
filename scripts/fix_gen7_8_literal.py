with open('scripts/contract_generators/gen_part7_8.py', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace(
    '"ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\\n...",',
    '"ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\\\\n...",'
)
text = text.replace(
    '"ca_cert": "-----BEGIN CERTIFICATE-----\\n..."',
    '"ca_cert": "-----BEGIN CERTIFICATE-----\\\\n..."'
)

with open('scripts/contract_generators/gen_part7_8.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("gen_part7_8.py updated with \\\\n")
