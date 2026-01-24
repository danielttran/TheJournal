# TheJournal

A cross-platform journaling and note-taking application built with Next.js and Electron. Features both journal-style date-based entries and notebook-style hierarchical pages.

## Features

- 📅 **Journal Mode** - Date-based entries with calendar navigation
- 📓 **Notebook Mode** - Hierarchical pages and sections with drag-and-drop
- 🎨 **Rich Text Editor** - Full formatting with Quill.js
- 🌙 **Dark/Light Themes** - System-aware with manual toggle
- 💾 **Auto-Save** - Content saved automatically with crash recovery
- 🔒 **Local Storage** - All data stored locally in SQLite
- 📦 **Import/Export** - Backup and restore your data

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
│   ├── db.ts               # SQLite database connection
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
- **Database**: better-sqlite3 (local SQLite)
- **Desktop**: Electron 35
- **DnD**: @dnd-kit