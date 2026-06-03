# Sentinel — an autonomous audit agent for Mantle

**The Turing Test Hackathon 2026 · Track: AI DevTools**

**▶ Try it live (no install):** **https://sentinel-audit.surge.sh** — paste any
Solidity contract and run the exact 14-detector audit engine in your browser.

Sentinel is an AI agent that audits Solidity smart contracts for security bugs
and Mantle/L2-specific gas waste — and it is itself an on-chain economic actor:
it holds an **ERC-8004 agent identity** and charges **per audit via x402**
micropayments. Point it at a contract, it pays-walls the audit behind a
stablecoin micropayment, returns a structured report, and records the audit on
Mantle so the agent builds a verifiable on-chain track record.

> Plain version: it's a robot security reviewer for blockchain code. You hand it
> a contract, it finds the dangerous mistakes and the parts that waste money to
> run, and it takes a tiny automatic payment for the job — no invoices, no
> accounts, just code paying code.

## Why this fits the "AI Awakening" theme

The hackathon benchmarks autonomous agents that *act* on-chain. Most agents
spend money (they call paid APIs). Sentinel **earns** it: a self-supporting
agent that sells a real service (audits), gets paid trustlessly (x402), and
accrues reputation under a portable identity (ERC-8004). That is an agent with
an actual economy around it, not a chatbot with a wallet bolted on.

## Status (honest)

| Layer | State |
|---|---|
| **Audit engine** (14 detectors, AST-based, never crashes on bad input) | ✅ working, tested |
| **CLI** (`sentinel Contract.sol [--json]`, CI-usable exit codes) | ✅ working |
| **ERC-8004 Identity + Validation registries** (Foundry, 7 tests) | ✅ working, tested |
| **x402 pay-per-audit HTTP gateway** (402 challenge → verify → settle) | ✅ working, tested |
| **On-chain audit attestations** (report hash + risk score per paid audit) | ✅ working, tested |
| **End-to-end loop proven on a live EVM** (Anvil, 4 e2e tests) | ✅ working, tested |
| **Registries deployed to Mantle Sepolia** (see `contracts/DEPLOY.md`) | ✅ live on-chain |
| Demo video + DoraHacks BUIDL submission | ⏳ next |

**Live on Mantle Sepolia (chain 5003):** IdentityRegistry `0x8F18f53a7ED086FFe409933668b2F3c48d26CbF4` ·
ValidationRegistry `0x6925CDFb19606C165d1ce4bCA16895a9a9Ac3507` · Sentinel agentId `1` (`sentinel.audit`).
[View on explorer](https://explorer.sepolia.mantle.xyz/address/0x8F18f53a7ED086FFe409933668b2F3c48d26CbF4).

The whole earning loop — *buyer pays via x402 → agent audits → report anchored
on-chain → USDC settles* — runs and is asserted end-to-end against a real EVM.
`npx tsx scripts/demo.ts` plays it start to finish (this is the demo-video script).

## The audit engine (live now)

AST analysis via `@solidity-parser/parser`. Every detector is sandboxed: one
failing detector can never abort the audit, and malformed Solidity returns a
clean parser error instead of crashing. Findings are sorted by severity and the
contract gets a 0–100 security score.

### Detectors

Security:
- **SEC-001** authorization via `tx.origin`
- **SEC-002** unchecked return of low-level `.call`/`.send`
- **SEC-003** use of `selfdestruct`
- **SEC-004** `delegatecall` to a runtime-controlled target
- **SEC-005** block properties used as randomness/critical source
- **SEC-006** externally callable state-changing function with no access control
- **SEC-007** reentrancy (state written after an external call, no guard)

Gas:
- **GAS-001** `require()` with revert string → custom errors
- **GAS-002** array `.length` read inside loop condition → cache it
- **GAS-003** post-increment `i++` loop counter → `++i`
- **GAS-004** reference-type param in `public` fn copied to memory → `external` + `calldata`
- **GAS-005** literal-initialised state var that could be `constant`/`immutable`

Mantle / L2-aware:
- **MNT-001** `block.number` used for time (unreliable cadence on L2s)
- **MNT-002** native transfer via `.transfer()`/`.send()` (brittle 2300-gas stipend on L2)

## CLI usage

```bash
npm install
npm run build
node dist/cli/index.js path/to/Contract.sol        # human report
node dist/cli/index.js path/to/Contract.sol --json  # machine report
cat Contract.sol | node dist/cli/index.js            # stdin
```

Exit code is non-zero when any HIGH-severity issue is found, so it drops
straight into CI.

## The agent: x402 + ERC-8004 (live now)

Sentinel runs as an HTTP agent (`src/server/`) that sells audits:

```
GET  /.well-known/agent.json   ERC-8004 AgentCard: identity, capabilities, price
POST /audit                    x402-paywalled; { source } -> report + on-chain attestation
```

The payment flow follows the [x402](https://x402.org) "exact" scheme:

1. Unpaid `POST /audit` returns **HTTP 402** with the payment requirements
   (`accepts[]`: scheme, amount, asset, `payTo`, network).
2. The buyer signs an **EIP-3009 `TransferWithAuthorization`** (a gasless USDC
   authorization) and resends it as a base64 `X-PAYMENT` header.
3. Sentinel verifies the signature, **runs the audit**, writes the report hash +
   risk score to the **ERC-8004 Validation Registry**, and only then **settles**
   the payment on-chain. The buyer pays for a delivered, anchored result — never
   for a 402, never for a failed settlement.

Payment verification/settlement is pluggable (`src/x402/verify.ts`):
- `LocalVerifier` — verifies the EIP-712 signature offline and settles via
  `transferWithAuthorization` using a relayer wallet. Self-contained: no external
  facilitator, works against any EVM you control (Anvil, Mantle, …).
- `FacilitatorVerifier` — delegates verify/settle to a hosted x402 facilitator.

### On-chain contracts (`contracts/`)

- **IdentityRegistry** — minimal ERC-8004: each agent gets a unique on-chain id
  resolvable by domain/address. Sentinel registers itself here.
- **ValidationRegistry** — proof-of-task-completion: every paid audit records
  `(auditorAgentId, subjectHash, reportHash, riskScore)`. A buyer can later
  `verify()` that the report they hold is exactly what was anchored, and read the
  agent's full audit track record.

```bash
# run the live agent against a local chain
PATH=$HOME/.foundry/bin:$PATH npx tsx scripts/demo.ts
```

## Test

```bash
npm test                                  # vitest: analyzer + HTTP gateway + e2e
PATH=$HOME/.foundry/bin:$PATH forge test  # Foundry: registry contracts
```

- `test/analyzer.test.ts` — 14 detectors fire on the vulnerable fixture; clean ≥ 90.
- `test/server.test.ts` — 402 challenge, malformed/invalid rejection, paid flow,
  and "settlement failure ⇒ no free audit".
- `test/e2e.chain.test.ts` — boots Anvil, deploys everything, registers the agent,
  funds a buyer, drives a **real signed x402 payment** through the live app, and
  asserts the USDC moved, the report verifies on-chain, and replays are rejected.

## Roadmap to submission (deadline 2026-06-15)

1. ✅ ERC-8004 registries + agent registration (deploy script ready).
2. ✅ x402 pay-per-audit gateway in front of the audit API.
3. ✅ On-chain attestation of each report; full loop proven on a live EVM.
4. ⏳ Deploy to Mantle Sepolia (gas-blocked — `contracts/DEPLOY.md`).
5. ⏳ 2–3 min demo video (driven by `scripts/demo.ts`); submit BUIDL on DoraHacks.

## License

MIT
