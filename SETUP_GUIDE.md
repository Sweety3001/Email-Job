# ReachInbox - One-Click Setup

Follow these steps to run the entire ReachInbox project (frontend, backend, database, queue, search) on a new machine using a single command.

## 1. Prerequisites
Make sure the new machine has the following installed:
- **Docker** & **Docker Compose**
- *(You do NOT need Node.js installed on the machine, Docker handles it all!)*

## 2. Copy the Project
Either clone your repository or copy the entire `Subbham` folder to the new machine.

## 3. Setup Credentials
Create a `.env` file inside the `backend` folder and copy your API keys over. It should look like this:

```env
# Your Google OAuth Credentials
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Your Slack OAuth Credentials
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret

# Secrets
JWT_SECRET=reachinbox-demo-secret-change-me-9f8a7b6c5d4e3f2a1b0c

# Settings
PORT=4000
FRONTEND_URL=http://localhost:5173
EMAIL_WORKER_CONCURRENCY=5
MIN_DELAY_MS=2000
MAX_EMAILS_PER_HOUR=200
MAX_EMAILS_PER_HOUR_PER_SENDER=100
RATE_LIMIT_MODE=both
EMAIL_QUEUE_NAME=email-dispatch
```

## 4. Run Everything
Open a terminal in the root folder (`Subbham`) and run:
```bash
docker-compose up --build -d
```

### What this command does:
1. Starts the Postgres Database, Redis Queue, and Elasticsearch.
2. Builds the Backend Docker Image.
3. Automatically sets up the database tables (Prisma).
4. Starts the API Server on port `4000`.
5. Starts the Background Email Worker.
6. Builds the Frontend Docker Image.
7. Starts the Frontend Dashboard on port `5173`.

## 5. You're Done!
Open your browser and navigate to `http://localhost:5173`. 
The entire stack is running seamlessly in the background!

To shut everything down when you are finished, just run:
```bash
docker-compose down
```
