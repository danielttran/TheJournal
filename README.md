# TheJournal

A cross-platform journaling and note-taking application built with Next.js and Electron. Features both journal-style date-based entries and notebook-style hierarchical pages.

## Screenshots

![Secure Login](screenshot/create%20account.png)
*Privacy-first authentication with local-only storage.*

![Notebook Mode](screenshot/notebook.png)
*Organize your thoughts with hierarchical pages and sections.*

## Features

- 📅 **Journal Mode** - Date-based entries with calendar navigation
- 📓 **Notebook Mode** - Hierarchical pages and sections with drag-and-drop
- 🔒 **End-to-End Local Encryption** - Full database encryption via SQLCipher (AES-256)
- 🔑 **Secure Key Derivation** - Argon2id master key derivation for maximum security
- 🎨 **Rich Text Editor** - Full formatting with Quill.js
- 🌙 **Dark/Light Themes** - System-aware with manual toggle
- 💾 **Auto-Save** - Content saved automatically with crash recovery
- 📦 **Import/Export** - Encrypted backups of your entire journal

## Getting Started

### Development (Web)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Development (Electron)

```bash
npm run dev:electron
```

### Production Build

```bash
# Build Next.js
npm run build:electron

# Build installer
npm run build:installer
```

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # REST API endpoints
│   │   ├── backup/         # Import/Export DB
│   │   ├── category/       # Notebook/Journal CRUD
│   │   ├── entry/          # Entry CRUD, by-date, dates
│   │   └── health/         # Health check
│   ├── dashboard/          # Dashboard page
│   ├── journal/[categoryId]/ # Journal/Notebook view
│   ├── login/              # Authentication
│   ├── globals.css         # Theme variables & styles
│   ├── layout.tsx          # Root layout with providers
│   └── providers.tsx       # Theme & Electron IPC setup
│
├── components/
│   ├── journal/
│   │   ├── Editor.tsx      # Rich text editor with auto-save
│   │   ├── EntryGrid.tsx   # Grid view for entries
│   │   ├── Sidebar.tsx     # Navigation (calendar/tree)
│   │   └── TabBar.tsx      # Tab management & menus
│   ├── dashboard/
│   │   └── CategoryCard.tsx
│   └── ThemeToggle.tsx     # Theme switch button
│
├── hooks/                  # Reusable React hooks
│   ├── useClickOutside.ts  # Detect clicks outside element
│   ├── useElectronIPC.ts   # Safe IPC event subscription
│   └── index.ts            # Barrel export
│
├── lib/
│   ├── db.ts               # Encrypted SQLite connection (SQLCipher)
│   ├── auth.ts             # Argon2id key derivation & hashing
│   └── types.ts            # TypeScript interfaces
│
└── electron/               # Electron main process
    ├── main.js             # Window creation & menu
    ├── preload.js          # Context bridge API
    └── settings.js         # User settings persistence
```

## Component Responsibilities

| Component | Description |
|-----------|-------------|
| **TabBar** | Category tabs, drag-to-reorder, File/View menus |
| **Sidebar** | Journal calendar or notebook tree navigation |
| **Editor** | Quill-based rich text with auto-save & recovery |
| **EntryGrid** | Grid display for browsing past entries |

## Database Schema

- **User** - Authentication
- **Category** - Journals and Notebooks
- **Entry** - Individual pages/journal entries

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript
- **Editor**: react-quill-new
- **Styling**: Tailwind CSS with CSS variables
- **Database**: @journeyapps/sqlcipher (AES-256 Encrypted)
- **Key Derivation**: Argon2id
- **Desktop**: Electron 35
- **DnD**: @dnd-kit