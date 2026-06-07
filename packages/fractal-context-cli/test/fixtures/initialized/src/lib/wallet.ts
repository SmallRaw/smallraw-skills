// INPUT: Account balance records
// OUTPUT: Spendable balance number
// POS: Wallet domain calculation helper

export function spendableBalance(balance: number, locked: number) {
  return balance - locked;
}
