with open("reports/eval_v3_20261102_222837.md", "r") as f:
    text = f.read()

# Replace empty parenthesis in checklist
text = text.replace(
    "Trailing history statistics (, , , ) are calculated exclusively from strictly earlier chronological posts (prior time).",
    "Trailing history statistics (`prev_10_mean`, `prev_10_std`, `prev_3_mean`, `days_since_prev`) are calculated exclusively from strictly earlier chronological posts."
)
text = text.replace(
    "Posts with fewer than 3 prior observations fall back to follower-bucket mean with .",
    "Posts with fewer than 3 prior observations fall back to follower-bucket mean with `has_history = 0`."
)

with open("reports/eval_v3_20261102_222837.md", "w") as f:
    f.write(text)
print("Report formatted successfully!")
