# Deploy — Sentinel ERC-8004 registries (Mantle Sepolia)

Status: **DEPLOYED & live on Mantle Sepolia (chain 5003).** 2026-05-29.

## Live addresses (Mantle Sepolia, chain 5003)
| Contract | Address |
|---|---|
| **IdentityRegistry** | `0x8F18f53a7ED086FFe409933668b2F3c48d26CbF4` |
| **ValidationRegistry** | `0x6925CDFb19606C165d1ce4bCA16895a9a9Ac3507` |
| **Sentinel agentId** | `1` (domain `sentinel.audit`) |
| **Sentinel / deployer** | `0x9703C68D01923916D9d9B9f1B824CbE4c8cd501e` |

Explorer: https://explorer.sepolia.mantle.xyz/address/0x8F18f53a7ED086FFe409933668b2F3c48d26CbF4
Deploy tx batch: `broadcast/Deploy.s.sol/5003/run-latest.json`.
On-chain verified: `getAgent(1)` returns agentId 1 / address 0x9703… / domain "sentinel.audit"; `agentCount() == 1`.

## What's deployed
- `IdentityRegistry.sol`, `ValidationRegistry.sol` — 7/7 Foundry tests pass; codesize nonzero on-chain.
- `script/Deploy.s.sol` — deployed both + registered the Sentinel agent in one broadcast.

## How it was funded (gas blocker resolved)
The deployer started at 0 MNT and every no-auth faucet was walled (QuickNode needs mainnet ETH or a
tweet; official Mantle faucet needs X-auth; thirdweb is wallet-connect gated). Resolved via **HackQuest
faucet (`hackquest.io/faucets/5003`, 4 MNT/day)**, authenticated with the **`kite-builds` GitHub
identity** (GitHub OAuth — tolerates automated login, unlike Google). Faucet tx:
`0xd632c51cd28ec5146010544dd4924ba1663f4b8a6bc52c80498dc78c528d18d6`. Deploy cost ~0.089 MNT;
~3.86 MNT remains for on-chain audit attestations.

## Reproduce / redeploy
```
cd kite-ops/sentinel
export PATH="$HOME/.foundry/bin:$PATH"
export PRIVATE_KEY=$(cast wallet private-key --mnemonic "$(node -e "console.log(require('/Users/botbot/mac-control/.metamask_wallet.json').seed_phrase)")")
forge script contracts/script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.sepolia.mantle.xyz --broadcast --legacy
```
