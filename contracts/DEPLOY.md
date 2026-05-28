# Deploy — Sentinel ERC-8004 registries (Mantle Sepolia)

Status: **contracts done, gas-blocked.** Engineering complete; only testnet MNT is missing.

## What's ready
- `IdentityRegistry.sol`, `ValidationRegistry.sol` — compiled, 7/7 Foundry tests pass.
- `script/Deploy.s.sol` — deploys both + registers Sentinel agent in one broadcast.

## Deployer
- Address: `0x9703C68D01923916D9d9B9f1B824CbE4c8cd501e` (Erik Nordvik EVM, from MetaMask mnemonic).
- Balance on Mantle Sepolia: **0 MNT** → cannot deploy until funded.

## Gas blocker (2026-05-29)
Every no-auth faucet is walled:
- QuickNode (`faucet.quicknode.com/mantle/sepolia`): requires 0.001 mainnet ETH (we hold 0) OR a tweet.
- Official Mantle faucet: requires X/Twitter auth.
- thirdweb: 0.01 MNT, wallet-connect gated.
- **HackQuest (`hackquest.io/faucets/5003`): 4 MNT/day — best yield, but requires a HackQuest account (GitHub OAuth available).**

Recommended completion path: log into HackQuest with the kite GitHub identity, paste the deployer
address, claim 4 MNT (more than enough — Mantle testnet gas is tiny). Alternative: pk910 Sepolia
PoW faucet → Mantle bridge (no account, but ~45 min multi-step).

## One-command deploy once funded
```
cd kite-ops/sentinel
export PRIVATE_KEY=$(cast wallet private-key --mnemonic "$(node -e "console.log(require('/Users/botbot/mac-control/.metamask_wallet.json').seed_phrase)")")
forge script contracts/script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.sepolia.mantle.xyz --broadcast --legacy
```
Then record the printed IdentityRegistry / ValidationRegistry addresses + agentId here.
