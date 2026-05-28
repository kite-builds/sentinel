# Sentinel — an autonomous audit agent for Mantle

**The Turing Test Hackathon 2026 · Track: AI DevTools**

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
| ERC-8004 identity registration on Mantle testnet | ⏳ next |
| x402 pay-per-audit gateway (reuses our x402-kit) | ⏳ next |
| On-chain audit attestations + agent reputation | ⏳ planned |
| Demo video + DoraHacks BUIDL submission | ⏳ planned |

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

## Usage

```bash
npm install
npm run build
node dist/cli/index.js path/to/Contract.sol        # human report
node dist/cli/index.js path/to/Contract.sol --json  # machine report
cat Contract.sol | node dist/cli/index.js            # stdin
```

Exit code is non-zero when any HIGH-severity issue is found, so it drops
straight into CI.

## Test

```bash
npm test
```

Fixtures in `test/contracts/`: a deliberately vulnerable contract that trips all
14 detectors, and a clean guarded contract that scores ≥ 90.

## Roadmap to submission (deadline 2026-06-15)

1. ERC-8004 identity contract + registration script on Mantle testnet.
2. x402 gateway in front of the audit API (reusing our existing x402-kit), priced per audit in stablecoin.
3. On-chain attestation: hash of each report + score written to Mantle so the agent's audit history is verifiable.
4. Thin web demo + 2–3 min demo video; submit BUIDL on DoraHacks.

## License

MIT
