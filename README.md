# 🎮 UNO! Multiplayer Web Game

A modern, interactive, and fully responsive real-time multiplayer UNO card game. Built with a robust Next.js frontend and a Django Channels backend, this project supports seamless lobby orchestration, instant turn synchronization via WebSockets, and complete implementation of classic UNO gameplay rules.

---

## 🚀 Key Features

*   **Lobby Orchestration**: Fast room creation and joining via unique room codes.
*   **Real-time Multiplayer**: Fast, bi-directional game loop synchronization powered by WebSockets.
*   **Complete UNO Game Rules**: 
    *   Dynamic deck mechanics (shuffling, drawing, discarding).
    *   Full support for all action cards: **Skip**, **Reverse**, **Draw Two**, **Wild**, and **Wild Draw Four**.
    *   Valid move verification (matching color/number/symbol).
    *   Turn-based synchronization with active timers and direction indicator (clockwise/counter-clockwise).
*   **Sleek Modern UI**:
    *   Responsive game table layout built using Tailwind CSS v4.
    *   Polished card layouts and hover effects.
    *   Dynamic visual turn indicators, hand size counters, and game state messages.
*   **Guest Session Authentication**: Immediate play capability with automated guest token generation.

---

## 🛠️ Technology Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Frontend** | **Next.js 16 (React 19)** | Fast, server-side rendered application structure using App Router. |
| | **Tailwind CSS v4** | Clean, modern styling using utility classes and PostCSS. |
| | **TypeScript** | Type safety across game actions, socket messages, and components. |
| **Backend** | **Django 6.0** | Scalable REST API framework for session & database orchestration. |
| | **Django Channels 4.3** | Handles real-time WebSockets connections. |
| | **Django REST Framework** | Clean APIs for guest auth and room lifecycle. |
| **Database** | **PostgreSQL** | Persistent room, player, and system state storage. |

---

## 📁 Project Structure

```text
UNO!/
├── backend/                  # Django backend application
│   ├── game/                 # Core game package
│   │   ├── consumers.py      # WebSocket connections & message handshakes
│   │   ├── game_logic.py     # UNO deck, rules, and card verification engine
│   │   ├── models.py         # Room, Player, and Card schemas
│   │   └── state_manager.py  # Game session state synchronization
│   └── uno_project/          # Django server configurations & ASGI/WSGI entrypoints
│
├── frontend/                 # Next.js frontend application
│   ├── app/                  # Web App pages
│   │   ├── room/[code]/      # Real-time game room page
│   │   └── globals.css       # Design system styles and custom animations
│   ├── public/               # Visual assets and icons
│   └── package.json          # Node dependencies
│
└── README.md                 # Project Documentation (this file)
```

---

## ⚙️ Installation & Setup

Follow these steps to run the complete stack locally:

### 1. Prerequisites
Ensure you have the following installed on your machine:
*   Python 3.10+
*   Node.js 18+ & npm
*   PostgreSQL running on port `5433` (or update environment variables accordingly)

---

### 2. Backend Setup
1.  Navigate to the backend directory:
    ```bash
    cd backend
    ```
2.  Create and activate a Python virtual environment:
    ```bash
    python -m venv venv
    # On Windows:
    .\venv\Scripts\activate
    # On macOS/Linux:
    source venv/bin/activate
    ```
3.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```
4.  Configure Environment Variables (`backend/.env`):
    Make sure a `.env` file exists with the following configuration:
    ```ini
    SECRET_KEY=your-django-secret-key
    DEBUG=True
    DB_NAME=uno_db
    DB_USER=postgres
    DB_PASSWORD=your_postgres_password
    DB_HOST=localhost
    DB_PORT=5433
    ```
5.  Create the database in PostgreSQL and run migrations:
    ```bash
    python manage.py migrate
    ```
6.  Start the ASGI Django development server (using Daphne/runserver):
    ```bash
    python manage.py runserver
    ```
    The backend server will run on `http://localhost:8000`.

---

### 3. Frontend Setup
1.  Navigate to the frontend directory:
    ```bash
    cd ../frontend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Configure Environment Variables (`frontend/.env`):
    Ensure the APIs point to your local backend server:
    ```ini
    NEXT_PUBLIC_API_URL=http://localhost:8000
    NEXT_PUBLIC_WS_URL=ws://localhost:8000
    ```
4.  Run the Next.js development server:
    ```bash
    npm run dev
    ```
    Open your browser and navigate to `http://localhost:3000` to start playing!

---

## 🎮 Game Rules & Actions
*   **Colors**: Red, Blue, Green, Yellow.
*   **Action Cards**:
    *   **Skip**: Skips the next player's turn.
    *   **Reverse**: Reverses the direction of play.
    *   **Draw Two (+2)**: Next player draws 2 cards and skips their turn.
    *   **Wild**: Allows the current player to choose the active color.
    *   **Wild Draw Four (+4)**: Allows the player to choose the active color and forces the next player to draw 4 cards and skip their turn.
*   **Winning**: The first player to play all cards from their hand wins the game.
