# Contributing to BioOS Core

Thank you for your interest in contributing to BioOS Core! We welcome contributions that uphold the stability, safety, and deterministic principles of the active inference kernel.

## Code of Conduct

All contributors and participants are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md) (Contributor Covenant v2.1).

---

## Local Development & Environment Setup

BioOS Core runs primarily on Google Apps Script and Node.js (for QA test suites and validation scripts).

### Prerequisites

- **Node.js**: v20 or higher (`node -v`)
- **npm**: v10 or higher
- **Clasp** (optional, for deploying to Google Apps Script): `@google/clasp`

### Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone https://github.com/alonsoalvaradohr/BioOS_Core.git
   cd BioOS_Core
   ```

2. **Environment Configuration (Zero Credentials Policy):**
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Populate local placeholders with your sandbox keys if running manual tests.
   - **CRITICAL**: Never commit `.env` or any real tokens, keys, or IDs. The `.gitignore` is strictly enforced to prevent credential leakage.

3. **Install Dependencies & Validate:**
   ```bash
   npm run check
   npm test
   ```

---

## Commit Guidelines (Conventional Commits)

We enforce semantic commit messages adhering to the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` Introduces a new feature or capability.
- `fix:` Patches a bug or regression.
- `docs:` Documentation-only modifications.
- `refactor:` Code refactoring without changing observable behavior.
- `test:` Adding, updating, or fixing tests.
- `chore:` Maintenance tasks, dependency updates, configuration adjustments.

*Example:* `feat(sensors): add validation filter for biometric noise`

---

## Pull Request Process

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Verify all local checks pass before submitting:
   ```bash
   npm run verify
   ```
3. Open a Pull Request filling out the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md).
