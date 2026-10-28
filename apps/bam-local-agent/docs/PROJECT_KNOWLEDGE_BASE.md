# Project Architecture & Developer Context Knowledge Base

**Organization:** Zawadie Solutions  
**Client / Brand Context:** Bricks & Minifigs® (Retail Marketing & Operations Automation)  
**Document Version:** 1.0  
**Effective Date:** October 2026  

---

## 1. Executive Summary & Objective

This document serves as the primary technical specification, operational constraint guide, and domain context repository for Claude / AI Developers working on this codebase. 

All features, background workers, database schemas, and external API integrations built within this codebase **must strictly comply** with the hosting environment constraints, database access paradigms, and domain workflows defined herein.

---

## 2. Infrastructure & Hosting Environment Constraints

The system is deployed on a **Hostinger Business / Unlimited Web Hosting (Shared hPanel)** environment. Every code module, script, and feature must be designed within the strict limits of this infrastructure.

### 2.1 Core Stack Specifications
*   **Backend Runtime:** Node.js 20 or 22 LTS (Express.js or Fastify).
*   **Frontend Runtime:** Static build output only (HTML, CSS, Vanilla JS or React + Vite compiled to static assets; Tailwind CSS optional). Served directly as static files.
*   **Database:** MySQL / MariaDB (InnoDB engine), managed via phpMyAdmin/CLI.
*   **Email:** SMTP using `nodemailer` via domain mailboxes.
*   **Scheduled Jobs:** Native hPanel Cron Jobs executing Node.js scripts (`cron.js` pattern).

### 2.2 Hard Technical Limits & Constraints
| System Layer | Constraint / Limit | Architectural Requirement |
| :--- | :--- | :--- |
| **Language Runtime** | **Node.js Only** | **NEVER use Python, Flask, Django, or FastAPI.** |
| **Node.js Instances** | Max 5 sites on account | Ensure single-process microservices or monolithic backend architectures. |
| **Process Limits** | 120 concurrent processes | Keep process lifecycles short; pool connections efficiently. |
| **Request Timeout** | **120 seconds maximum** | HTTP requests lasting > 120s are terminated by the server. Long-running AI generation or data ingestion tasks **MUST** be offloaded to cron jobs or split into micro-batches. |
| **WebSockets & Daemons** | **Not Supported** | No persistent WebSocket connections, socket servers, background daemon workers, or long-polling queues. Use REST polling or Webhook listeners. |
| **Database Access** | MySQL / MariaDB | **No PostgreSQL, MongoDB, or Redis.** Prepared statements using `mysql2` driver with parameterized queries are required. |
| **Environment & Secrets**| Variable Injection | All API keys (OpenAI, Anthropic Claude API) and db credentials **MUST** remain server-side in `.env` and loaded explicitly during script execution. |

### 2.3 Prohibited Technologies
Do **NOT** attempt to install or reference:
*   Python Machine Learning / AI packages locally (PyTorch, TensorFlow, LangChain Python).
*   Docker containers or custom binary installations.
*   SSR-heavy React frameworks requiring node servers (e.g., Next.js SSR server runtime).
*   Background process managers like PM2 in daemon mode (if restart policies are restricted by hPanel).

---

## 3. System Architecture & Component Design

```
                     +----------------------------------------+
                     |         Frontend (Static React/JS)     |
                     +-------------------|--------------------+
                                         | REST / HTTPS
                                         v
                     +----------------------------------------+
                     |    Node.js Express Backend API          |
                     |  (120s max request execution limit)    |
                     +-------|------------------------|-------+
                             |                        |
             External APIs   |                        | DB Queries (mysql2)
      +----------------------+                        v
      |  - Anthropic Claude API             +------------------+
      |  - OpenAI API                       | MySQL / MariaDB  |
      |  - Webhooks (CRM, Sheets)           +------------------+
                                                      ^
                                                      | DB Updates
                     +--------------------------------|-------+
                     |    hPanel Cron Jobs (Node.js)          |
                     |  (Scheduled batch tasks / UTC time)    |
                     +----------------------------------------+
```

### 3.1 AI Feature Execution Flow
1.  **AI Layer:** External API integration only (`@anthropic-ai/sdk` or `openai`).
2.  **Streaming & Buffering:** For long responses, stream content to the client or save intermediate generation state to MySQL.
3.  **Cron Processing:** Batch jobs (such as automated social copy generation, email digest creation, or analytics sync) must be triggered via hPanel cron jobs running a command like:
    ```bash
    /usr/local/bin/node /home/user/public_html/cron/process_ai_queue.js
    ```

---

## 4. Domain & Business Logic Rules (Bricks & Minifigs® Framework)

When developing AI prompts, automated agents, marketing generators, or content schedulers for this application, the AI agents must strictly observe the following brand rules and calendar logic derived from the Q2 2026 Marketing Strategy:

### 4.1 Campaign & Sales Targets
*   **Primary Product Focus:** New-In-Box (NIB) LEGO® Sets, Minifig Maker, BAM Passports, and MOC Wall Clocks.
*   **Key Campaigns:**
    1.  *Spring Break Build / Built for Any Occasion* (Target: ~$42k NIB revenue per store).
    2.  *Built for Any Grad / Built for Any Mom / Built for Any Dad* (Target: ~$14k NIB revenue/month).
    3.  *Time to Build. Time to Win. / BAM Passport Campaign* (Target: 25 Passports sold/gifted per store; total 5,750 franchise-wide).

### 4.2 Legal & Branding Copy Rules (CRITICAL FOR AI PROMPTS)
When generating public-facing content, social copy, or email newsletters via Claude API integrations, the following phrase restrictions **MUST** be programmed into prompt templates:

*   **PROHIBITED STAR WARS TRADEMARK TERMS:**
    *   *Do NOT use:* "Star Wars Day", "May the Fourth be with you", "May the Force be with you", "A long time ago in a galaxy far, far away...", "The Force", "This is the Way", "Dark Side", "Light Side", "Jedi", "Sith", "Padawan", "Droid", or specific character names in promotional copy.
    *   *Permitted reference:* Generic "May the 4th promos", "Space-themed brick sets", or official licensed LEGO® Star Wars™ product names strictly per LEGO E-tailer Guidelines.
*   **Date Conventions:** Use **ISO-8601** (weeks starting on Monday, ending on Sunday) for all automated calendar logic and event schedules.

---

## 5. Pre-Deployment Developer Checklist

Before pushing any code or requesting pull requests, verify:

1. [ ] **Backend Language:** Is all server-side code written purely in Node.js (Express/Fastify)?
2. [ ] **Database Queries:** Are all MySQL queries parameterized using `mysql2`?
3. [ ] **Request Timeouts:** Does any API endpoint take longer than 90 seconds? (If yes, refactor to asynchronous job polling or cron script).
4. [ ] **Security:** Are API keys (Claude/OpenAI) read exclusively from process environment variables?
5. [ ] **Cron Utilities:** Do scheduled scripts explicitly import `.env` configuration (e.g., `dotenv.config()`) at execution startup?
6. [ ] **Static Assets:** Is the frontend compiled into a flat static bundle ready for web server deployment without SSR node dependencies?

---

## 6. Developer Guidance for AI Assistants (e.g., Claude)

When analyzing, modifying, or extending this workspace:
1. **Respect File Limits:** Combine components where necessary if building single-file modules or web applications as specified by the system prompt.
2. **Never suggest Python-based solutions** (e.g., Pandas, Flask, PyTorch, Celery) for backend services in this repo.
3. **Always suggest MySQL-compatible SQL** scripts (InnoDB engine) when providing database migrations.
4. **Enforce serverless-like lightweight HTTP handlers** to protect the 120-process limit of shared hosting.