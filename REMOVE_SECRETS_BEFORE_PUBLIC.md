# 🚨 CRITICAL: REMOVE SECRETS BEFORE MAKING REPOSITORY PUBLIC 🚨

This repository currently contains **HARDCODED AWS CREDENTIALS** intentionally placed to avoid local environment configurations and resolve team conflicts during the hackathon/active development phase.

## Where are the secrets located?

AWS Access Keys and Session Tokens are currently hardcoded in plain-text inside the following files:

1. `app/api/tts/route.ts` (Lines 6-10) — Used by `PollyClient`
2. `app/api/evaluate/route.ts` (Lines 35-39) — Used by `BedrockAgentRuntimeClient` and `BedrockRuntimeClient`

## How to remove them before making this public:

1. **Delete the hardcoded blocks in the files above.** Replace them with the secure `process.env` setup:
    ```typescript
    const credentialsConfig = process.env.AWS_ACCESS_KEY_ID
      ? {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
          },
        }
      : {};
    ```
2. **Scrub Git History.** Because the keys have been committed, simply removing them from the files is NOT enough. They will still exist in the repository's history and bots will find them within seconds of going public. You **MUST** run a tool like `git filter-repo` to scrub them completely from history:
    ```bash
    git filter-repo --replace-text <(printf 'YOUR_ACCESS_KEY==>***REMOVED***\nYOUR_SECRET_KEY==>***REMOVED***\nYOUR_SESSION_TOKEN==>***REMOVED***') --force
    ```
3. **Delete this file.** After scrubbing the history, delete this `REMOVE_SECRETS_BEFORE_PUBLIC.md` document.
