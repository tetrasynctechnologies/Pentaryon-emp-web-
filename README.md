# Pentaryon Technology - Employee Work Portal & Clearance System

> Internal enterprise operations platform for work assignment, progress tracking, milestone auditing, and employee account clearance.

---

## 🛠 Technology Architecture

- **Runtime**: Node.js (v22+)
- **Backend**: Express.js
- **Database**: Native SQLite (`node:sqlite` DatabaseSync) in Write-Ahead Logging (WAL) mode
- **Security**:
  - Salting & cryptographic key derivation via Node.js native `crypto.scryptSync`
  - Timing-safe authentication comparisons (`crypto.timingSafeEqual`)
  - Content Security Policy (CSP) & HTTP security headers via Helmet
  - HttpOnly & SameSite session cookies
- **Frontend**: Obsidian Executive Design System (Responsive HTML5 / CSS3 / ES6+ SPA)
- **Zero External Compilation**: Zero native C++ build requirements, 100% resilient on Windows

---

## 👥 Pre-Configured Roster & Credentials

### Executive Administrators
| Username | Name | Role |
| :--- | :--- | :--- |
| `joshua` | J. Joshua | CTO / Executive Admin |
| `kishore` | B. Kishore | CEO / Executive Admin |
| `jason` | A. Jason Kister | COO / Executive Admin |
| `akshay` | Akshay Kumar | Co-CTO / Executive Admin |

### Foundational Team Members
| Username | Name | Role / Department | Default Password |
| :--- | :--- | :--- | :--- |
| `prashetha` | Prashetha | Web management | `prashetha@TetraSync!` |
| `chethana` | Chethana | Digital marketing | `chethana@TetraSync!` |
| `surya` | Surya | Cyber Security | `surya@TetraSync!` |
| `harish` | Harish | Designer | `harish@TetraSync!` |

> **Note**: For Employee Access, initial and standard credentials follow the pattern: `<username>@TetraSync!` (e.g. `maya@TetraSync!`). Admins authenticate with `Admin@TetraSync2026!`. Initial credentials can be customized in `.env`.

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v22.0.0 or higher (v24 recommended)
- **npm**: v10.0.0 or higher

### 2. Installation
```bash
npm install
```

### 3. Running the Server
```bash
# Production server
npm start

# Development mode with hot-reloading
npm run dev
```

Visit the portal in your browser:
**`http://localhost:3000`**

---

## 🧪 Automated Testing
Run the comprehensive 10-step end-to-end integration and security test suite:
```bash
npm test
```

Verifies:
1. SQLite WAL mode & database connection
2. Admin authentication across all 4 executive accounts
3. Employee authentication across team members
4. Account registration request workflow (`pending` status)
5. Zero-trust gate: Rejection of login attempts for pending accounts
6. Administrator approval queue & account clearance
7. Post-approval employee login
8. Task assignment by Administrator to team member
9. Employee task viewing, progress update slider (0-100%), and milestone notes
10. Task completion workflow & audit log tracking

---

## 📂 Project Structure
```text
├── server/
│   ├── index.js          # Express entry point, security headers, routing
│   ├── config.js         # Port, secrets, admins & employee configurations
│   ├── db.js             # Native node:sqlite schema, scrypt hashing & auto-seeding
│   ├── auth.js           # Session token generation & role-based middleware
│   └── routes/
│       ├── auth.routes.js   # Registration, login, logout, session profile
│       ├── admin.routes.js  # Clearance queue, approvals, rejections, directory
│       └── tasks.routes.js  # Task creation, assignment, progress updates, logs
│
├── public/
│   ├── index.html        # Single-page interface (Auth gate, Employee & Admin portals)
│   ├── terms.html        # Terms & Conditions legal document
│   ├── privacy.html      # Privacy Policy document
│   ├── site.webmanifest  # Progressive web app manifest
│   ├── css/
│   │   └── styles.css    # Obsidian executive design system stylesheet
│   ├── js/
│   │   └── app.js        # Dynamic SPA controller
│   └── assets/           # Corporate branding, icons, and emblems
│
├── tests/
│   └── portal_test.js    # Automated integration test suite
│
├── data/
│   └── work_portal.db    # SQLite database in WAL mode (gitignored)
│
├── .env                  # Active runtime configuration
├── .env.example          # Environment variables template
├── .gitignore            # Excludes secrets, databases, and dependencies
└── package.json          # Node.js dependencies & scripts
```

---

## 📄 License
© 2026 Pentaryon Technology Pvt. Ltd. All rights reserved.
