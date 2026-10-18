# TetraSync Custom Domain Setup Guide: `tetrasync.tech`

This guide walks you through claiming your free **`tetrasync.tech`** domain via the **GitHub Student Developer Pack** and binding it to your live Vercel deployment with automatic SSL certificate issuance.

---

## Step 1: Claim Free `.TECH` Domain via GitHub Student Developer Pack

1. Go to the official GitHub Student Pack .TECH partnership portal:
   👉 **[https://get.tech/github-student-pack](https://get.tech/github-student-pack)**
2. Click **"Authorize with GitHub"** to authenticate using your student GitHub account.
3. In the search box, enter:
   `tetrasync.tech`
4. If `tetrasync.tech` is available, select it and proceed to checkout:
   - Registration Period: **1 Year**
   - The price will automatically discount to **$0.00 / Free**.
5. Complete the checkout form (fill in your standard name and contact details).
6. Access your **.TECH Control Panel / Management Portal** (Radix / get.tech).

---

## Step 2: Add Domain to Vercel

1. Log into your **[Vercel Dashboard](https://vercel.com/dashboard)**.
2. Open your project: **`TetraSync-emp-web-`** (or your current portal project).
3. Navigate to **Settings** (top menu bar) &rarr; **Domains** (left sidebar).
4. In the domain input field, type:
   `tetrasync.tech`
5. Click **Add**.
6. Vercel will ask how you want to configure redirects:
   - Select **Recommended**: Redirect `www.tetrasync.tech` &rarr; `tetrasync.tech` (or direct apex domain).

---

## Step 3: Configure DNS Records at `.TECH` Domain Registrar

In your **.TECH Domain Management Portal / DNS Management Console**:

Add the following **two DNS records**:

| Type | Name / Host | Target / Value | TTL | Note |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `@` (blank / root) | `76.76.21.21` | `Automatic` or `300` | Points apex domain to Vercel's global edge network |
| **CNAME** | `www` | `cname.vercel-dns.com` | `Automatic` or `300` | Enables `www.tetrasync.tech` alias |

*(Optional)* If you would also like a dedicated subdomain for the portal (such as `portal.tetrasync.tech`):
| Type | Name / Host | Target / Value | TTL |
| :--- | :--- | :--- | :--- |
| **CNAME** | `portal` | `cname.vercel-dns.com` | `Automatic` or `300` |

---

## Step 4: Verification & Automatic SSL

1. Return to your **Vercel Dashboard &rarr; Settings &rarr; Domains**.
2. Once the DNS records propagate (typically within 1 to 10 minutes), Vercel will display green checkmarks:
   - `Valid Configuration`
   - `Assigned to production (main)`
   - `SSL Certificate Issued`
3. Vercel automatically generates and renews a free, zero-maintenance Let's Encrypt TLS/SSL certificate.
4. Your application will now be securely live and accessible globally at:
   **`https://tetrasync.tech`**

---

## Step 5: Codebase Automatic Alignment

The backend and email dispatcher are already pre-configured:
- **CORS Protection**: `tetrasync.tech` and `*.tetrasync.tech` are whitelisted for secure cross-origin requests.
- **Gmail Automation Links**: All task assignment emails and milestone completion alerts now link to `https://tetrasync.tech`.
