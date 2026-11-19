with open('scripts/contract_generators/gen_part1_2.py', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace('v1.1.0', 'v1.2.0')
text = text.replace('深度收口修订基线', '三轮复审终验收口基线 (Third-Round Review Final Closed Baseline)')

with open('scripts/contract_generators/gen_part1_2.py', 'w', encoding='utf-8') as f:
    f.write(text)

print('Updated gen_part1_2.py to v1.2.0')
