// Supported Indian banks
// Source of truth for bank names and domains used across the application
// Logos are sourced via Google's favicon API using the domain field
// When ingestion pipeline requires bank-specific parser routing,
// this list will be migrated to a banks reference table in Aurora

export const SUPPORTED_BANKS = [
  { name: "Axis Bank", domain: "axisbank.com" },
  { name: "HDFC Bank", domain: "hdfcbank.com" },
  { name: "ICICI Bank", domain: "icicibank.com" },
  { name: "State Bank of India", domain: "sbi.co.in" },
] as const

export type SupportedBank = typeof SUPPORTED_BANKS[number]
export type SupportedBankName = SupportedBank["name"]

export function getBankDomain(bankName: SupportedBankName): string {
  const bank = SUPPORTED_BANKS.find((b) => b.name === bankName)
  return bank?.domain ?? ""
}
