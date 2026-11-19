with open('scripts/contract_generators/gen_part1_2.py', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace('v1.3.0', 'v1.4.0')
text = text.replace('v1.2.0', 'v1.4.0')

with open('scripts/contract_generators/gen_part1_2.py', 'w', encoding='utf-8') as f:
    f.write(text)

print("Bumped version to v1.4.0 in gen_part1_2.py")
