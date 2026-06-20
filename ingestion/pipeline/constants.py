# Adapted from statementsparser by Harsh Lalakiya
# https://github.com/iharshlalakiya/statementparser
# MIT License

DATE_FORMATS: dict[str, list[str]] = {
    "HDFC": ["%d/%m/%y", "%d/%m/%Y", "%d-%m-%Y"],
    "SBI": ["%d/%m/%Y", "%d-%m-%Y", "%d %b %Y"],
    "ICICI": ["%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y"],
    "Axis": ["%d-%m-%Y", "%d/%m/%Y"],
    "DEFAULT": ["%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d %b %Y", "%d-%b-%Y", "%Y-%m-%d"],
}

AMOUNT_STRIP_CHARS = " ,₹Rs.INR\xa0\t"

# UPI VPA suffix → app name
VPA_APP_MAPPING: dict[str, str] = {
    "paytm": "Paytm",
    "ptyes": "Paytm",
    "pthdfc": "Paytm",
    "ptaxis": "Paytm",
    "ptsbi": "Paytm",
    "pty": "Paytm",
    "oksbi": "Google Pay",
    "okicici": "Google Pay",
    "okhdfcbank": "Google Pay",
    "okaxis": "Google Pay",
    "ok": "Google Pay",
    "ybl": "PhonePe",
    "ibl": "PhonePe",
    "axl": "PhonePe",
    "phonepe": "PhonePe",
    "pingpay": "Samsung Pay",
    "apl": "Amazon Pay",
    "amazon": "Amazon Pay",
    "amazonpay": "Amazon Pay",
    "rapl": "Amazon Pay",
    "freecharge": "FreeCharge",
    "fc": "FreeCharge",
    "timecosmos": "CRED",
    "kredpay": "CRED",
    "cred": "CRED",
    "kmbl": "Kotak",
    "kotak": "Kotak",
    "hdfcbankjd": "HDFC",
    "rblbank": "RBL Bank",
    "aubank": "AU Small Finance",
    "barodampay": "Bank of Baroda",
    "boi": "Bank of India",
    "cbin": "Central Bank",
    "idbi": "IDBI Bank",
    "idfc": "IDFC First",
    "idfcbank": "IDFC First",
    "icici": "ICICI Bank",
    "indus": "IndusInd Bank",
    "sbi": "State Bank of India",
    "yesbank": "Yes Bank",
    "yesbankltd": "Yes Bank",
    "jupiteraxis": "Jupiter",
    "fi": "Fi Money",
    "slice": "Slice",
    "navi": "Navi",
    "nipl": "Navi",
    "upi": "BHIM",
}

# IFSC prefix → bank name
IFSC_BANK_MAPPING: dict[str, str] = {
    "HDFC": "HDFC Bank",
    "SBIN": "State Bank of India",
    "ICIC": "ICICI Bank",
    "UTIB": "Axis Bank",
    "KKBK": "Kotak Mahindra Bank",
    "YESB": "Yes Bank",
    "INDB": "IndusInd Bank",
    "PUNB": "Punjab National Bank",
    "BARB": "Bank of Baroda",
    "IDFB": "IDFC First Bank",
    "FDRL": "Federal Bank",
    "CNRB": "Canara Bank",
    "UBIN": "Union Bank of India",
    "BKID": "Bank of India",
    "ANDB": "Andhra Bank",
    "ALLA": "Allahabad Bank",
    "ORBC": "Oriental Bank of Commerce",
    "SIBL": "South Indian Bank",
    "JKBK": "Jammu Kashmir Bank",
    "CBIN": "Central Bank of India",
    "IDIB": "Indian Bank",
    "IOBA": "Indian Overseas Bank",
    "MAHB": "Bank of Maharashtra",
    "DCBL": "DCB Bank",
    "AUBL": "AU Small Finance Bank",
    "RATN": "RBL Bank",
    "SCBL": "Standard Chartered",
    "HSBC": "HSBC Bank",
    "CITI": "Citibank",
    "DEUT": "Deutsche Bank",
    "PYTM": "Paytm Payments Bank",
    "AIRP": "Airtel Payments Bank",
}

PAYMENT_METHOD_PATTERNS: dict[str, list[str]] = {
    "UPI": ["upi-", "/upi/", "upi/", "upi send", "upi recv", "gpay", "phonepe", "bhim upi"],
    "NEFT": ["neft/", "/neft", "neft-"],
    "IMPS": ["imps/", "/imps", "imps-"],
    "RTGS": ["rtgs/", "/rtgs", "rtgs-"],
    "ATM": ["atm/", "atw/", "cash withdrawal", "cash adv", "atm wd"],
    "POS": ["/pos/", "pos/", "pos-"],
    "Bill Payment": ["billpay", "bill pay", "bill payment", "nach dr", "ecs dr", "direct debit", "ib billpay"],
    "Salary": ["sal cr", "salary cr", "payroll"],
    "Cheque": ["chq/", "cheque", "clg/", "clearing"],
    "Reversal": ["reversal", "rev/", "refund", "cashback"],
    "Transfer": ["neft", "imps", "mmt/", "sft/", "fund transfer"],
    "EMI": [" emi ", "emi/", "loan emi", "loan installment"],
    "Wallet": ["wallet", "prepaid load"],
}

# 11 canonical categories with Indian merchant keyword lists (scored by number of matches)
CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Food": [
        # Delivery & ordering
        "swiggy", "zomato", "uber eats", "ubereats", "dunzo food",
        "bigbasket", "blinkit", "zepto", "grofers", "jiomart food",
        # Restaurants & QSR
        "dominos", "pizza hut", "kfc", "mcdonalds", "mcdonald", "burger king",
        "subway", "haldirams", "barbeque nation", "wow momo",
        "restaurant", "cafe", "dhaba", "hotel restaurant", "diner",
        "starbucks", "barista", "costa coffee", "chaayos",
        "cafe coffee day", "ccd", "dunkin", "tea stall", "juice",
        "bakery", "sweet shop", "mithai",
        # Groceries & supermarkets
        "dmart", "d-mart", "big bazaar", "reliance fresh", "reliance smart",
        "more supermarket", "nature's basket", "lulu hypermarket", "spencers",
        "supermarket", "grocery", "kirana", "vegetables", "fruits",
        "wholesale", "metro cash",
        "milk", "dairy", "thota", "halli", "stor", "store",
        "mandi", "sabzi", "farm", "organic", "fresh mart",
        "provision", "vegetable", "sabziwala",
        # Generic
        "food", "biryani", "tiffin", "dabba", "meal",
    ],
    "Transport": [
        "uber", "ola", "rapido", "auto", "fastag", "toll", "fas tag",
        "metro card", "bus pass", "irctc train", "train ticket",
        "petrol", "fuel", "diesel", "hpcl", "iocl", "bpcl",
        "hp petrol", "indian oil", "bharat petroleum",
        "parking", "valet", "cab",
    ],
    "Travel": [
        "irctc", "makemytrip", "goibibo", "cleartrip", "yatra", "easemytrip",
        "oyo", "airbnb", "booking.com", "tripadvisor",
        "airport", "flight", "airline", "indigo", "air india",
        "spicejet", "vistara", "akasa", "air asia", "hotel", "resort",
        "holiday", "tour package",
    ],
    "Shopping": [
        "amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa",
        "mamaearth", "decathlon", "reliance digital", "croma", "vijay sales",
        "samsung", "apple", "mi store", "boat store",
        "shoppers stop", "lifestyle", "westside", "zara", "h&m",
        "shopping", "retail", "mall",
    ],
    "Entertainment": [
        "netflix", "amazon prime", "hotstar", "disney+", "zee5",
        "sonyliv", "alt balaji", "jiocinema", "aha",
        "bookmyshow", "pvr", "inox", "carnival cinemas",
        "gaming", "steam", "playstation", "xbox game", "youtube premium",
        "spotify", "gaana", "wynk", "jiosaavn",
    ],
    "Health": [
        "pharmacy", "medplus", "1mg", "netmeds", "apollo pharmacy",
        "fortis", "max hospital", "aiims", "hospital", "clinic", "doctor",
        "diagnostic", "pathlab", "dr lal", "metropolis",
        "medicine", "health", "medical", "thyrocare",
    ],
    "Education": [
        "udemy", "coursera", "byjus", "unacademy", "vedantu", "toppr",
        "school fees", "college fees", "tuition", "coaching",
        "books", "university", "education", "course",
        "exam fee", "cbse", "upsc", "gate",
    ],
    "Finance": [
        # Bank charges & card payments
        "credit card payment", "cc payment", "card payment",
        "bank charges", "processing fee", "late fee", "overdue",
        "interest charged", "annual fee", "locker charges",
        "neft charges", "imps charges", "sms charges",
        "billpay", "bill pay", "hdfcsi", "hdfc si", "standing instruction",
        "nach", "ecs", "credit card", "cc pay",
        # Investments
        "zerodha", "groww", "upstox", "coin by zerodha", "kuvera",
        "paytm money", "nps", "ppf", "epfo", "hdfcsec",
        "sip", "mutual fund", "mf redemption", "mf purchase",
        "fixed deposit", "fd", "recurring deposit", "rd",
        "stocks", "equity", "demat", "ipo", "hsl sec", "hsl",
        "securities", "shares", "net pi", "nsdl", "cdsl", "brokerage",
        # Insurance
        "lic premium", "lic of india", "max life", "hdfc life",
        "icici prudential", "sbi life", "bajaj allianz",
        "star health", "care health", "niva bupa",
        "vehicle insurance", "two wheeler insurance",
        "term insurance", "ulip",
        # Salary & income
        "salary", "sal cr", "payroll", "monthly salary",
        "stipend", "wages", "remuneration",
        "salary credit", "pay credit", "salary transfer",
        # ATM & cash
        "atm withdrawal", "atm cash", "cash withdrawal", "atm w/d",
        # Interest & charges
        "interest", "charges", "penal",
    ],
    "Housing": [
        "rent", "landlord", "house rent", "flat rent",
        "maintenance charge", "society maintenance", "apartment",
        "housing society", "home loan emi", "property tax",
        "electricity bill", "gas bill", "water bill",
    ],
    "Utilities": [
        # Communication (merged)
        "jio recharge", "airtel recharge", "vodafone recharge", "vi recharge",
        "bsnl recharge", "idea recharge",
        "broadband", "fibernet", "act fibernet", "hathway",
        "mobile recharge", "dth recharge", "tata sky", "dish tv",
        # Utilities
        "electricity", "bescom", "msedcl", "tpddl", "cesc",
        "gas cylinder", "indane", "hp gas", "bharat gas",
        "water bill", "jal board", "municipal",
        "piped gas", "adani gas", "mahanagar gas",
    ],
    "Other": [
        "transfer to", "transfer from", "neft transfer",
        "imps transfer", "fund transfer", "sent to",
        "received from", "mmt/", "sft/",
    ],
}

# Payment gateway prefixes — format: {ALPHANUM_CODE}/{PREFIX}{MERCHANT}
PAYMENT_GATEWAY_PREFIXES: dict[str, str] = {
    "RAZP": "Razorpay",
    "PAYU": "PayU",
    "CCAV": "CCAvenue",
    "INST": "Instamojo",
    "CASH": "Cashfree",
    "CSHFRE": "Cashfree",
    "BILL": "BillDesk",
    "ATOM": "Atom",
    "EAZZ": "EazyPay",
    "PAYTM": "Paytm",
}

# Deterministic subcategory assignment based on merchant name keywords
# Keys are subcategory names, values are lists of keywords to match
SUBCATEGORY_KEYWORDS: dict[str, list[str]] = {
    # Food
    "Food Delivery": ["swiggy", "zomato", "uber eats", "dunzo",
                      "blinkit", "zepto", "instamart"],
    "Dining Out": ["restaurant", "cafe", "dhaba", "bistro",
                   "kitchen", "foods", "eatery"],
    "Groceries": ["dmart", "big bazaar", "more supermarket",
                  "reliance fresh", "spencer", "nature basket"],
    # Transport
    "Ride Share": ["uber", "ola", "rapido", "meru", "blablacar"],
    "Fuel": ["petrol", "diesel", "hpcl", "iocl", "bpcl",
             "indian oil", "bharat petroleum", "hp petro"],
    "Public Transport": ["metro", "bmtc", "best bus", "irctc",
                         "railway", "ksrtc"],
    # Health
    "Pharmacy": ["pharmacy", "medical", "apollo", "medplus",
                 "netmeds", "1mg", "pharma", "drugstore"],
    "Doctor": ["clinic", "hospital", "doctor", "dr ", "healthcare",
               "diagnostics", "lab"],
    # Utilities
    "Electricity": ["bescom", "mseb", "tata power", "adani electricity",
                    "electricity", "power", "tneb", "cesc"],
    "Mobile Recharge": ["jio", "airtel", "vi ", "vodafone", "bsnl",
                        "idea", "recharge"],
    "Internet": ["broadband", "fiber", "act ", "hathway", "you broadband"],
    # Entertainment
    "Streaming": ["netflix", "hotstar", "amazon prime", "spotify",
                  "youtube", "zee5", "sonyliv", "disney"],
    "Movies": ["pvr", "inox", "cinepolis", "bookmyshow"],
    # Shopping
    "Online Shopping": ["amazon", "flipkart", "myntra", "ajio",
                        "nykaa", "meesho", "snapdeal"],
    "Personal Care": ["salon", "spa", "parlour", "beauty", "grooming"],
    # Finance
    "EMI": ["emi", "loan", "equated"],
    "Credit Card": ["credit card", "card payment", "cc pay"],
    "Investment": ["mutual fund", "sip", "zerodha", "groww", "hdfcsec",
                   "upstox", "stocks", "shares"],
}

# Maps subcategory to its parent category
SUBCATEGORY_CATEGORY_MAP: dict[str, str] = {
    "Food Delivery": "Food",
    "Dining Out": "Food",
    "Groceries": "Food",
    "Ride Share": "Transport",
    "Fuel": "Transport",
    "Public Transport": "Transport",
    "Pharmacy": "Health",
    "Doctor": "Health",
    "Electricity": "Utilities",
    "Mobile Recharge": "Utilities",
    "Internet": "Utilities",
    "Streaming": "Entertainment",
    "Movies": "Entertainment",
    "Online Shopping": "Shopping",
    "Personal Care": "Shopping",
    "EMI": "Finance",
    "Credit Card": "Finance",
    "Investment": "Finance",
}

# Bank header signatures for fallback CSV format detection
BANK_HEADER_SIGNATURES: dict[str, set[str]] = {
    "HDFC Bank": {"date", "narration", "debit amount", "credit amount", "chq/ref number"},
    "State Bank of India": {"txn date", "description", "withdrawal amt", "deposit amt"},
    "ICICI Bank": {"date", "particulars", "withdrawal amt (dr.)", "deposit amt (cr.)"},
    "Axis Bank": {"date", "particulars", "debit", "credit"},
}
