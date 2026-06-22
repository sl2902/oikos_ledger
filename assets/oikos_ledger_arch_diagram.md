flowchart LR
    %% Style Declarations
    classDef user fill:#e1f5fe,stroke:#0288d1,stroke-width:2px,color:#000
    classDef client fill:#efebe9,stroke:#5d4037,stroke-width:2px,color:#000
    classDef gateway fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#000
    classDef compute fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#000
    classDef database fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#000
    classDef storage fill:#fce4ec,stroke:#c62828,stroke-width:2px,color:#000

    %% 1. Client Layer
    subgraph UserTier["👤 Client Boundary"]
        User["Browser / Client Canvas"]:::user
    end

    %% 2. Web Hosting & Compute Layer
    subgraph Vercel["⚡ Vercel — Next.js 15 Serverless Platform"]
        NextClient["Next.js UI Engine\n(Login · Transactions · Insights · Recs)"]:::client
        
        subgraph API["Backend API Routes"]
            AuthAPI["/api/auth"]:::compute
            TxnAPI["/api/transactions"]:::compute
            InsightsAPI["/api/insights/query\n(+ Cache Layer)"]:::compute
            SessionAPI["/api/insights/session"]:::compute
            RecsAPI["/api/recommendations"]:::compute
        end
    end

    %% 3. Identity Provider
    subgraph AuthCloud["🔐 Identity Provider"]
        Google["Google OAuth 2.0"]:::gateway
    end

    %% 4. AI Core Model Layer
    subgraph OpenAI["🧠 OpenAI Core API Platform"]
        GPT["GPT-4o-mini\n(NL→SQL · Insights)"]:::gateway
        Embed["text-embedding-3-small\n(Query + Merchant Vectors)"]:::gateway
        Realtime["Realtime API\n(Bidirectional Voice Node)"]:::gateway
    end

    %% 5. Cloud Infrastructure Layer
    subgraph AWS["☁️ AWS Infrastructure (ap-south-1)"]
        S3["Amazon S3\n(Statement Document Store)"]:::storage
        Lambda["AWS Lambda (Python 3.12)\n(Parse → Normalize → Embed)"]:::compute
        
        subgraph Aurora["Aurora PostgreSQL Serverless v2 Cluster"]
            DB["Core Relational Database\n• transactions  • bank_accounts\n• users  • merchants  • uploads\n• query_cache (pgvector 1536d)"]:::database
        end
    end

    %% --- Connection Pathways ---

    %% User / Browser Routing
    User -->|HTTPS| NextClient
    User -->|Direct Upload via Presigned URL| S3
    User <-->|Direct WebSocket Audio Stream| Realtime

    %% Next.js Frontend to Internal Serverless APIs
    NextClient -->|Session Handshake| AuthAPI
    NextClient -->|Fetch Records| TxnAPI
    NextClient -->|Submit Text Prompt| InsightsAPI
    NextClient -->|Request Ephemeral Token| SessionAPI
    NextClient -->|POST Tailored Feeds| RecsAPI

    %% External Identity Hook
    AuthAPI <-->|Token Validation Exchange| Google

    %% Serverless Compute to Core Database
    TxnAPI -->|Read / Write Ledger Data| DB
    InsightsAPI -->|Execute Compiled SQL| DB
    RecsAPI -->|Rolling Baseline Query| DB

    %% Serverless Compute to Model Synthesizers
    InsightsAPI -->|Translate Text to SQL| GPT
    InsightsAPI -->|Generate Query Vector| Embed
    InsightsAPI -->|Vector Semantic Search| DB
    RecsAPI -->|Insight → Impact → Action Analysis| GPT
    SessionAPI -->|Provision Access Token| Realtime

    %% Async Data Ingestion Pipeline (AWS Native)
    S3 -->|S3 Object Created Event Trigger| Lambda
    Lambda -->|Normalize Merchants| GPT
    Lambda -->|Generate Merchant Name Vectors| Embed
    Lambda -->|Atomic Row Insertion| DB

    %% Apply structural container backgrounds
    class Vercel,AWS,AuthCloud,OpenAI compute;