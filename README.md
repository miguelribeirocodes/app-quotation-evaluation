# 📊 Quotation Evaluation System

A comprehensive full-stack web application for technical and commercial evaluation of network infrastructure projects.

## 📋 Project Overview

The **Quotation Evaluation System** is a professional web application designed to streamline the evaluation process for network infrastructure projects. It enables evaluators to complete detailed forms about technical specifications, required materials, and timelines, automatically calculating quantities and generating comprehensive reports and PDFs for commercial analysis.

This project demonstrates modern full-stack development practices with a clean separation of concerns, robust authentication, and a user-friendly interface suitable for complex business workflows.

## 🛠️ Technology Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | FastAPI (Python) |
| **API Architecture** | REST API with JWT & OAuth2 |
| **Database** | PostgreSQL + SQLAlchemy ORM |
| **Frontend** | HTML5 + CSS3 + Vanilla JavaScript |
| **Backend Deploy** | Render |
| **Frontend Deploy** | Netlify |

## ✨ Key Features

- ✅ **Multi-Role Authentication** - Three distinct user profiles (Admin, Commercial, Evaluator) with granular access control using JWT & OAuth2 authentication
- ✅ **Dynamic Forms** - Flexible evaluation forms for infrastructure assessment with real-time validation and error handling
- ✅ **Automatic Calculations** - Real-time calculation of quantities and material requirements based on evaluation data
- ✅ **PDF Generation** - Automated generation of professional material lists and quotation reports in PDF format
- ✅ **Local Draft Storage** - Browser-based LocalStorage integration for saving progress and enabling offline work capabilities
- ✅ **Audit & History** - Complete change history tracking with audit logs for compliance and accountability
- ✅ **Responsive Tables** - Advanced filtering and sorting on responsive data tables optimized for mobile devices
- ✅ **Image Management** - Support for uploading and managing images related to evaluations and projects

## 📐 Evaluation Categories

The system supports comprehensive evaluation of network infrastructure across multiple categories:

| Code | Category | Description |
|------|----------|-------------|
| **Q1** | 🔌 UTP Cabling & Patch Panels | Network cabling infrastructure |
| **Q2** | 🔀 Network Switches | Switch equipment specifications |
| **Q3** | 📡 Optical Cabling & DIO | Fiber optic infrastructure |
| **Q4** | 📹 Equipment | Cameras, NVR/DVR systems |
| **Q5** | 🏢 Infrastructure | Ducts, Racks, cable management |
| **Q6** | 🚪 Turnstiles & Barriers | Access control barriers |
| **Q9** | ⚙️ Automation Panel | Automation systems |
| **Q10** | 🔑 Access Control & Doors | Door control and access systems |

## 👥 User Roles & Access Control

The system implements a three-tier role-based access control (RBAC) system:

### 👨‍💼 Administrator (role: "admin")
**Full system access. Can:**
- ✅ Create, edit, delete evaluations
- ✅ Change evaluation status
- ✅ Manage commercial fields (PO, Proposal Number)
- ✅ Create new users
- ✅ Modify user roles
- ✅ Activate/deactivate users
- ✅ Reset user passwords
- ✅ Access audit logs
- ✅ Generate PDFs

### 💼 Commercial (role: "comercial")
**Intermediate access focused on commercial activities. Can:**
- ✅ Create, edit, delete evaluations
- ✅ Change evaluation status
- ✅ Manage commercial fields
- ✅ Generate PDFs
- ❌ Cannot manage users
- ❌ Cannot access audit logs

### 📋 Evaluator (role: "avaliador")
**Basic access for day-to-day operations. Can:**
- ✅ Create evaluations
- ✅ Edit own evaluations
- ✅ View evaluations
- ✅ Use local drafts (LocalStorage)
- ❌ Cannot change status
- ❌ Cannot fill commercial fields
- ❌ Cannot manage users
- ❌ Cannot access audit logs
- ❌ Cannot generate PDFs

## 🚀 Quick Start Guide

### Prerequisites
- Python 3.x installed
- PostgreSQL installed and running
- Git for version control

### Setup Steps

#### 1. Clone the Repository
```bash
git clone https://github.com/miguelribeirocodes/app-quotation-evaluation.git
cd app-quotation-evaluation
```

#### 2. Set Up Python Virtual Environment

**Windows:**
```bash
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

**macOS/Linux:**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

#### 3. Install Dependencies
```bash
pip install -r requirements.txt
pip install "python-jose[cryptography]" passlib[bcrypt]
```

#### 4. Configure PostgreSQL Database

Follow the detailed PostgreSQL setup instructions below (6 steps), or read `readme.txt` for comprehensive guidance.

#### 5. Set Environment Variables

Create a `.env` file in the project root:
```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres
```

#### 6. Run the Application
```bash
uvicorn main:app --reload
```

**Access the app:** http://localhost:8000

**Default credentials:**
- Username: `admin`
- Password: `admin123`

⚠️ **Change default password on first login!**

---

## 🗄️ PostgreSQL Local Setup

### PASSO 1: Install PostgreSQL
- Download from: https://www.postgresql.org/download/
- During installation, set the 'postgres' user password to: `99062535`
- Select default port: `5432`

### PASSO 2: Start PostgreSQL (Windows)
- Open "Services" (Win+R > services.msc)
- Find "postgresql-x64-XX" (where XX is your version)
- Right-click > Properties
- Set "Startup type" to "Automatic"
- Click "Start"

### PASSO 3: Create the Database (via PowerShell)
```bash
psql -U postgres -h localhost
```
Enter password: `99062535`

Then execute:
```sql
CREATE DATABASE postgres;
\q
```

### PASSO 4: Execute Schema (Create Tables)

**Option A - Via DBeaver:**
- Install DBeaver: https://dbeaver.io/
- Create new PostgreSQL connection (localhost:5432, user: postgres, password: 99062535)
- Open `schema_avaliacoes.sql`
- Execute all SQL (Ctrl+Enter or Run button)

**Option B - Via psql:**
```bash
psql -U postgres -h localhost -d postgres -f schema_avaliacoes.sql
```

### PASSO 5: Verify Connection
In your project root, `.env` should contain:
```
DATABASE_URL=postgresql://postgres:99062535@localhost:5432/postgres
```

### PASSO 6: Run the Application
```bash
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload
```

**Access at:** http://localhost:8000

### 💡 Troubleshooting
- ❌ Connection error? Check if PostgreSQL is running (Services)
- ❌ Authentication error? Verify password in .env matches installation
- ⏹️ Stop application: Ctrl+C in terminal

---

## 📁 Project Structure

```
app-quotation-evaluation/
├── main.py                      # FastAPI application entry point
├── requirements.txt             # Python dependencies
├── schema_avaliacoes.sql        # Database schema definition
├── .env                         # Environment variables (not in git)
├── readme.txt                   # Additional documentation
├── README.md                    # This file
│
├── static/                      # Frontend assets
│   ├── index.html              # Main application page
│   ├── app.js                  # Main JavaScript logic (8,898 lines)
│   ├── styles.css              # Styling
│   ├── manifest.webmanifest    # PWA manifest
│   ├── icons/                  # Application icons
│   └── uploads/                # User-uploaded images
│
├── Deploy netlify/             # Production frontend build
│   ├── index.html
│   ├── app.js
│   └── ...
│
└── .gitignore                  # Git ignore rules
```

## 🗄️ Database Schema

The system uses multiple tables for data persistence:

- **usuarios** - User accounts with roles and permissions
- **avaliacoes** - Main evaluation records with status and metadata
- **avaliacoes_imagens** - Associated images for evaluations
- **avaliacoes_equipamentos** - Equipment specifications per evaluation
- **avaliacoes_auditoria** - Change history and audit logs
- **avaliacoes_q1** - Q1 specific evaluation data
- **avaliacoes_q2** - Q2 specific evaluation data
- *...and more specialized tables for each evaluation category*

See `schema_avaliacoes.sql` for complete database schema definition.

## 🌐 Production Deployment

### Backend (Render)
FastAPI backend deployed on Render with automatic deployments on git commits.

### Frontend (Netlify)
Static HTML/CSS/JS frontend deployed on Netlify with automatic builds and live preview functionality.

**Live Application:** [https://quotation-evaluation.netlify.app/](https://quotation-evaluation.netlify.app/)

---

## 📚 Documentation

For detailed information, refer to these resources:

- **readme.txt** - Project overview, setup guide, and troubleshooting
- **schema_avaliacoes.sql** - Complete database schema definition
- **main.py** - FastAPI application with API endpoints documentation
- **static/app.js** - Frontend application logic (8,898 lines of JavaScript)

---

## 🔗 Links

- **GitHub Repository:** [github.com/miguelribeirocodes/app-quotation-evaluation](https://github.com/miguelribeirocodes/app-quotation-evaluation)
- **Live Demo:** [quotation-evaluation.netlify.app](https://quotation-evaluation.netlify.app/)
- **Author:** [Miguel Ribeiro](https://github.com/miguelribeirocodes)

---

## 📝 License

This project is provided as a technical portfolio demonstration.

---

<p align="center">
  <strong>Quotation Evaluation System</strong> - A modern full-stack application demonstrating professional web development practices
</p>
