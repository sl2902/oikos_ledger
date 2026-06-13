"""Seed the categories table with a standard personal finance category hierarchy.

Run once after create_tables.py. Safe to re-run — skips existing categories.

Usage:
    python scripts/seed_categories.py
"""

from ingestion.config import settings
from ingestion.models import Category
from sqlmodel import Session, create_engine, select

# Categories are managed by developers, not users.
# To add new categories: add them to this script and rerun.
# Script is idempotent — existing categories are skipped.
# User-defined categories are planned for a future iteration.
# LLM normalization falls back to "Other > Custom" for unknown categories.
CATEGORIES: dict[str, list[str]] = {
    "Food": ["Groceries", "Dining Out", "Food Delivery", "Coffee"],
    "Transport": ["Fuel", "Public Transport", "Ride Share", "Parking"],
    "Housing": ["Rent", "Utilities", "Internet", "Maintenance"],
    "Health": ["Pharmacy", "Doctor", "Insurance", "Gym"],
    "Shopping": ["Clothing", "Electronics", "Home", "Personal Care"],
    "Entertainment": ["Streaming", "Movies", "Events", "Hobbies"],
    "Finance": ["EMI", "Credit Card Payment", "Investment", "Fees"],
    "Travel": ["Flights", "Hotels", "Activities"],
    "Education": ["Courses", "Books", "Subscriptions"],
    "Other": ["Uncategorized"],
}


def main() -> None:
    engine = create_engine(settings.database_url_direct)

    with Session(engine) as session:
        for parent_name, subcategory_names in CATEGORIES.items():
            existing_parent = session.exec(
                select(Category).where(
                    Category.name == parent_name,
                    Category.parent_id == None,  # noqa: E711
                )
            ).first()

            if existing_parent:
                print(f"  [skip] {parent_name}")
                parent = existing_parent
            else:
                parent = Category(name=parent_name)
                session.add(parent)
                session.flush()  # populate parent.id before inserting children
                print(f"  [add]  {parent_name}")

            for sub_name in subcategory_names:
                existing_sub = session.exec(
                    select(Category).where(
                        Category.name == sub_name,
                        Category.parent_id == parent.id,
                    )
                ).first()

                if existing_sub:
                    print(f"    [skip] {sub_name}")
                else:
                    session.add(Category(name=sub_name, parent_id=parent.id))
                    print(f"    [add]  {sub_name}")

        session.commit()

    print("\nDone.")


if __name__ == "__main__":
    main()
