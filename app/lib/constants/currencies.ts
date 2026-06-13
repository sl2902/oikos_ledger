// Supported currencies
// Only INR is supported in this version
// Multi-currency support is planned for a future iteration

export const SUPPORTED_CURRENCIES = [
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
] as const

export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number]["code"]

export const DEFAULT_CURRENCY: CurrencyCode = "INR"
