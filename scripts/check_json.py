import re
import json

with open('docs/API_CONTRACT_SPEC.md', 'r', encoding='utf-8') as f:
    text = f.read()

blocks = re.findall(r'```json\r?\n([\s\S]+?)```', text)
print(f'Total JSON blocks: {len(blocks)}')
invalid = 0
for i, b in enumerate(blocks):
    try:
        json.loads(b)
    except Exception as e:
        invalid += 1
        print(f'Block {i+1} invalid: {e}')

print(f'Invalid count: {invalid}')
