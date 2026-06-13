# Adapted from statementsparser by Harsh Lalakiya
# https://github.com/iharshlalakiya/statementparser
# MIT License

from .constants import CATEGORY_KEYWORDS, PAYMENT_METHOD_PATTERNS


def detect_payment_method(narration: str) -> str:
    """Detect payment method from narration string using keyword patterns.

    Returns the matched payment method name, or "Other" if no pattern matches.
    Checks are ordered so more specific patterns win over generic ones.
    """
    lower = narration.lower()
    for method, patterns in PAYMENT_METHOD_PATTERNS.items():
        for pattern in patterns:
            if pattern in lower:
                return method
    return "Other"


def categorize_transaction(
    narration: str,
    merchant: str | None,
    payment_method: str,
) -> str:
    """Assign a category to a transaction using scoring-based keyword matching.

    Combines narration and merchant into a single search string, then scores
    each category by counting how many of its keywords appear. Returns the
    category with the highest score, or "Other" if no keywords match.

    Short-circuits on unambiguous payment methods (Salary, ATM, EMI).
    """
    # Short-circuit on unambiguous payment methods
    if payment_method == "Salary":
        return "Salary"
    if payment_method == "ATM":
        return "Other"  # categorized separately in UI as cash
    if payment_method == "EMI":
        return "Finance"

    search = f"{narration} {merchant or ''}".lower()

    best_category = "Other"
    best_score = 0

    for category, keywords in CATEGORY_KEYWORDS.items():
        if category == "Other":
            continue
        score = sum(1 for kw in keywords if kw in search)
        if score > best_score:
            best_score = score
            best_category = category
        
    # If no keywords matched and payment is UPI, default to Transfer
    # UPI with no merchant keywords = person-to-person transfer
    if best_score == 0 and payment_method == "UPI":
        return "Transfer"

    return best_category
